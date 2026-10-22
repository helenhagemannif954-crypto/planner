// Сборка чина: описание из orders.json + день + настройки → конкретные тексты на сегодня.
// Здесь живёт вся «механика неповторяемости»: круг Псалтири, чтения по порядку,
// молитвы без повторов за N дней, особенности седмицы и церковного года.

import { C, psalmVerses, verseText } from './content.js';
import * as store from './store.js';
import { dayInfo, weekTheme } from './calendar.js';
import { dayKey, addDays, hash, now } from './util.js';

const COMPOSED = 'составлено для приложения';

// ——— условия в описании чина ———
const COND = {
  penitent: (c) => (c.day.fast || c.day.lentWeekday) && !c.day.noPenitence,
  fast: (c) => c.day.fast && !c.day.noPenitence,
  lent: (c) => c.day.season === 'lent',
  lentWeekday: (c) => c.day.lentWeekday,
  holyweek: (c) => c.day.season === 'holyweek',
  sunday: (c) => c.day.sunday,
  saturday: (c) => c.day.saturday,
  paschal: (c) => c.day.paschal,
  pinned: (c) => c.st.pinPsalms,
  unpinned: (c) => !c.st.pinPsalms,
  am: (c) => c.date.getHours() >= 4 && c.date.getHours() < 14,
  pm: (c) => !(c.date.getHours() >= 4 && c.date.getHours() < 14),
  plain: (c) => c.st.readMode === 'plain',
};

function holds(name, c) {
  const neg = name.startsWith('!');
  const f = COND[neg ? name.slice(1) : name];
  if (!f) { console.warn('[чин] неизвестное условие', name); return false; }
  return neg ? !f(c) : f(c);
}

function applies(b, c) {
  if (b.vol && !b.vol.includes(c.vol)) return false;
  const ifs = b.if == null ? [] : [].concat(b.if);
  return ifs.every((n) => holds(n, c));
}

// ——— контекст ———
export function makeContext(officeId, state = 'normal', date = now(), opts = {}) {
  const st = store.settings();
  const S = store.get();
  const day = dayInfo(date);
  const themeId = opts.themeId || weekTheme(date, C.themes);
  const theme = themeId ? C.theme[themeId] : null;
  const vol = state === 'normal' ? st.volume : state;
  const pickKey = `${day.key}:${officeId}${opts.themeId ? '-' + opts.themeId : ''}:${state}`;
  if (!S.picks[pickKey]) S.picks[pickKey] = {};
  return { officeId, state, date, day, theme, st, vol, S, picks: S.picks[pickKey], hour: date.getHours() };
}

function meta(obj) {
  if (!obj) return null;
  return { id: obj.id, source: obj.source || COMPOSED, century: obj.century || '', note: obj.translation_note || '' };
}

function line(set, c, salt = '') {
  const arr = typeof set === 'string' ? deep(C.prayers.lines, set) : set;
  if (!arr || !arr.length) return '';
  return arr[hash(c.day.key + salt + c.officeId) % arr.length];
}

function deep(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

// ——— выбор без повторов ———
function recentCut(c) {
  return dayKey(addDays(c.date, -Math.max(1, c.st.noRepeatDays)));
}

/** Выбрать id из кандидатов: давно не звучавший, с предпочтением тем; детерминированно на день */
function choose(c, salt, candidates, prefer = [], exclude = []) {
  const list = candidates.filter((x) => !exclude.includes(x.id));
  if (!list.length) return null;
  const hist = c.S.history;
  const cut = recentCut(c);
  const fresh = list.filter((x) => !hist[x.id] || hist[x.id] <= cut);
  let pool = fresh;
  if (!pool.length) {
    // всё звучало недавно — берём самое давнее
    const sorted = [...list].sort((a, b) => (hist[a.id] || '').localeCompare(hist[b.id] || ''));
    pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
  }
  const pref = (x) => (prefer.length && (x.themes || []).some((t) => prefer.includes(t)) ? 0 : 1);
  pool.sort((a, b) => pref(a) - pref(b) || (hash(c.day.key + salt + a.id) - hash(c.day.key + salt + b.id)));
  return pool[0];
}

function remember(c, id) {
  c.S.history[id] = c.day.key;
}

/** Закреплённый за этим чином выбор; при первом обращении — выбрать и запомнить */
function pickFor(c, bkey, candidates, prefer) {
  const had = c.picks[bkey];
  if (had && candidates.some((x) => x.id === had)) return candidates.find((x) => x.id === had);
  const x = choose(c, bkey, candidates, prefer);
  if (!x) return null;
  c.picks[bkey] = x.id;
  remember(c, x.id);
  return x;
}

// ——— предпочтения тем по дню ———
function preferThemes(c) {
  const p = [];
  if (c.theme && c.theme.prayerThemes) p.push(...c.theme.prayerThemes);
  if (c.day.sunday || c.day.paschal) p.push('resurrection', 'praise');
  if (c.day.saturday) p.push('creation');
  if ((c.day.fast || c.day.lentWeekday) && !c.day.noPenitence) p.unshift('repentance');
  return p;
}

function prayerCandidates(c, b) {
  const moment = b.moment;
  const state = b.state === null ? null : (b.state || c.state);
  return (C.prayers.pool || []).filter((p) => {
    if (b.kind && p.kind !== b.kind) return false;
    if (!b.kind && p.kind === 'word') return false;
    if (moment && !(p.moments || []).includes(moment)) return false;
    if (state && p.states && !p.states.includes(state)) return false;
    if (b.theme && !(p.themes || []).includes(b.theme)) return false;
    if (b.themeOnly && !(p.themes || []).some((t) => (c.theme?.prayerThemes || []).includes(t))) return false;
    if (c.day.noPenitence && (p.themes || []).includes('repentance')) return false;
    if (p.seasons && !p.seasons.includes(c.day.season)) return false;
    if (p.days && !p.days.includes(c.day.weekday)) return false;
    return true;
  });
}

// ——— чтение Писания ———
function specialReading(day) {
  const sp = C.scripture.special || {};
  for (const p of sp.byPascha || []) if (p.when === day.fromPascha) return p;
  for (const p of sp.feasts || []) if (p.feast === day.feast) return p;
  return null;
}

export function todaysReading(c, { assign = true } = {}) {
  const sp = specialReading(c.day);
  if (sp) return { passage: sp, special: true };
  const plan = C.scripture.plan;
  if (!plan.length) return null;
  const R = c.S.reading;
  if (R.day !== c.day.key) {
    if (!assign) return null;
    if (R.day && R.shown) R.pos = (R.pos + 1) % plan.length;
    R.day = c.day.key;
    R.shown = false;
  }
  return { passage: plan[R.pos % plan.length], special: false };
}

export function markReadingShown(special) {
  if (special) return;
  const R = store.get().reading;
  if (!R.shown) { R.shown = true; store.save(); }
}

/** Ключевой стих отрывка: key = «гл:ст» или номер стиха в первой главе */
export function keyVerse(p) {
  const vs = p.verses || [];
  if (!vs.length) return null;
  const k = String(p.key || '');
  const [kc, kn] = k.includes(':') ? k.split(':').map(Number) : [vs[0][0], Number(k)];
  return vs.find((x) => x[0] === kc && x[1] === kn) || vs[0];
}

// ——— круг Псалтири ———
function circleSlot(c, bkey) {
  const key = `${c.day.key}:${c.officeId}:${bkey}`;
  const circ = c.S.circle;
  if (!circ.slots[key]) circ.slots[key] = { pos: circ.pos % C.portions.length, shown: false };
  return { key, ...circ.slots[key] };
}

export function markCircleShown(key) {
  const circ = store.get().circle;
  const s = circ.slots[key];
  if (!s || s.shown) return;
  s.shown = true;
  // двигаемся дальше, только если показан именно ожидаемый отрывок
  if (circ.pos % C.portions.length === s.pos) circ.pos = (s.pos + 1) % C.portions.length;
  store.save();
}

// ——— отдельные блоки ———
function psalmBlock(n, from, to, extra = {}) {
  const p = C.psalm[n];
  if (!p) return null;
  const verses = psalmVerses(n, from, to);
  const whole = from == null || (from <= p.verses[0].n && to >= p.verses[p.verses.length - 1].n);
  return {
    t: 'psalm',
    rubric: `Псалом ${n}`,
    sub: extra.part ? `часть ${extra.part} из ${extra.parts}` : '',
    title: whole || (from != null && from <= p.verses[0].n) ? p.title : '',
    verses,
    meta: { source: `Пс ${n}${p.heb && p.heb !== n ? ` (по еврейскому счёту ${p.heb})` : ''}${whole ? '' : `:${from}–${to}`}`, century: 'Псалтирь; перевод с греческого (Септуагинта)', note: p.translation_note || C.psalms.translation_note || '' },
    fav: { kind: 'psalm', id: String(n), title: `Псалом ${n}` },
    ...extra,
  };
}

function odeBlock(id, extra = {}) {
  const o = C.ode[id];
  if (!o) return null;
  return {
    t: 'psalm',
    rubric: o.title,
    sub: o.ref,
    title: '',
    verses: o.verses,
    meta: meta(o),
    fav: { kind: 'ode', id, title: o.title },
    ...extra,
  };
}

function textBlock(obj, extra = {}) {
  if (!obj) return null;
  return {
    t: 'text',
    rubric: obj.rubric === undefined ? obj.title : obj.rubric,
    lines: obj.text,
    meta: meta(obj),
    fav: obj.kind === 'composed' ? null : { kind: 'text', id: obj.id, title: obj.title },
    ...extra,
  };
}

function odeOfDay(c) {
  const week = C.odes.week[String(c.day.weekday)] || [];
  if (!week.length) return null;
  // где на день две песни — чередуем по неделям
  const n = Math.floor((c.day.date.getTime() / 86400000 + 4) / 7);
  return week[n % week.length];
}

function resolveText(b, c) {
  let id = b.id;
  for (const alt of b.alt || []) if ([].concat(alt.if).every((n) => holds(n, c))) { id = alt.id; break; }
  return C.text[id];
}

const R = {
  text(b, c) {
    return textBlock(resolveText(b, c), b.rubric !== undefined ? { rubric: b.rubric } : {});
  },

  theme(b, c) {
    if (!c.theme) return null;
    return { t: 'theme', theme: c.theme, label: c.day.label };
  },

  psalm(b, c, bkey) {
    if (b.n) {
      const n = c.day.paschal && b.paschal ? b.paschal : b.n;
      return psalmBlock(n, b.from, b.to);
    }
    if (b.circle) {
      const slot = circleSlot(c, bkey);
      const part = C.portions[slot.pos];
      return psalmBlock(part.ps, part.from, part.to, { part: part.parts > 1 ? part.part : 0, parts: part.parts, circleKey: slot.key, rubricNote: 'Псалтирь по порядку' });
    }
    if (b.pool || b.fromTheme) {
      const src = b.fromTheme ? (c.theme?.psalms || []) : (C.orders.pools[b.pool] || []);
      const list = src.map((x) => ({ id: typeof x === 'number' ? `ps:${x}` : x }));
      const x = pickFor(c, bkey, list);
      if (!x) return null;
      const blk = x.id.startsWith('ps:') ? psalmBlock(+x.id.slice(3)) : odeBlock(x.id.replace(/^ode:/, ''));
      if (blk) blk.swap = { kind: 'pool', pool: b.pool, fromTheme: !!b.fromTheme, bkey };
      return blk;
    }
    return null;
  },

  ode(b, c) {
    return odeBlock(b.id || odeOfDay(c));
  },

  prayer(b, c, bkey) {
    const cands = prayerCandidates(c, b);
    const x = pickFor(c, bkey, cands, b.prefer || preferThemes(c));
    if (!x) return null;
    return textBlock(x, { swap: { kind: 'prayer', spec: b, bkey }, rubric: b.rubric || x.title });
  },

  reading(b, c) {
    if (b.pool) {
      const list = C.scripture.readingPools?.[b.pool] || [];
      const x = pickFor(c, 'reading:' + b.pool, list);
      if (!x) return null;
      return { t: 'reading', passage: x, special: true, double: !!b.double, questions: (x.q || []).slice(0, b.questions ?? 1), silence: Math.round(c.st.silence * (b.k || 1)), after: line('afterReading', c, 'h'), plain: c.st.readMode === 'plain' };
    }
    const r = todaysReading(c);
    if (!r) return null;
    const qs = (r.passage.q || []).slice(0, c.vol === 'short' ? 2 : 3);
    // третий вопрос — от темы седмицы, если у отрывка их всего два
    if (qs.length < 3 && c.vol !== 'short' && c.theme?.questions?.length) {
      qs.push(c.theme.questions[hash(c.day.key) % c.theme.questions.length]);
    }
    return {
      t: 'reading',
      passage: r.passage,
      special: r.special,
      double: b.double !== false,
      questions: qs,
      silence: Math.round(c.st.silence * (b.k || 1)),
      after: line('afterReading', c),
      plain: c.st.readMode === 'plain',
      slow: c.st.readMode === 'slow',
    };
  },

  intercession(b, c, bkey) {
    const cands = prayerCandidates(c, { moment: 'intercession', state: null });
    const x = b.prayer === false ? null : pickFor(c, bkey, cands, preferThemes(c));
    return {
      t: 'intercession',
      prayer: x ? textBlock(x, { swap: { kind: 'prayer', spec: { moment: 'intercession', state: null }, bkey }, rubric: x.title }) : null,
      names: store.get().names,
      lines: C.prayers.lines.names,
      departed: b.departed !== false,
      silence: Math.round(c.st.silence / 3),
    };
  },

  own(b, c) {
    const set = c.day.sunday && deep(C.prayers.lines.own, 'sunday') && b.set === 'morning' ? 'sunday' : b.set;
    const fromTheme = b.set === 'theme' && c.theme?.own;
    return { t: 'own', line: fromTheme || line('own.' + set, c, 'own'), seconds: Math.round(c.st.silence * (b.k || 1)) };
  },

  silence(b, c) {
    return { t: 'silence', seconds: Math.round(c.st.silence * (b.k || 1)) };
  },

  lord(b, c) {
    return textBlock(C.text.lord, { rubric: 'Отче наш' });
  },

  word(b, c) {
    const r = todaysReading(c, { assign: false });
    if (!r) return null;
    if (b.when === 'evening') {
      const R = c.S.reading;
      if (!r.special && !(R.day === c.day.key && R.shown)) return null;
    }
    const v = keyVerse(r.passage);
    if (!v) return null;
    return { t: 'word', rubric: b.when === 'evening' ? 'Утреннее слово' : 'Слово на день', ref: `${r.passage.book} ${v[0]}:${v[1]}`, lines: [v[2]] };
  },

  dismissal(b, c) {
    const blessRef = line(C.scripture.pools?.blessings || [], c, 'bless' + b.set);
    const bless = blessRef ? verseText(blessRef) : null;
    return { t: 'dismissal', line: line('dismissal.' + b.set, c, 'dis'), bless: bless && b.blessing !== false ? bless : null };
  },

  review(b, c) {
    const set = C.prayers.lines.review[b.set || 'evening'];
    let steps = set.steps;
    if (c.day.noPenitence && set.sundaySteps) steps = set.sundaySteps;
    return { t: 'review', rubric: set.title, steps: steps.map((s) => ({ ...s, seconds: Math.round(c.st.silence * (s.k || 0.5)) })) };
  },

  verse(b, c, bkey) {
    const pool = deep(C.scripture.pools, b.pool) || [];
    const list = pool.map((ref) => ({ id: 'v:' + ref, ref }));
    const x = pickFor(c, bkey, list);
    if (!x) return null;
    const v = verseText(x.ref);
    if (!v) return null;
    return { t: 'verse', rubric: b.rubric || '', ref: x.ref, lines: v.lines, fav: { kind: 'verse', id: x.ref, title: x.ref } };
  },

  remembrance(b, c, bkey) {
    const head = C.prayers.lines.hours[String(b.hour)];
    const cands = prayerCandidates(c, { kind: 'word', moment: 'hour' + b.hour, state: null });
    const x = c.vol === 'short' ? null : pickFor(c, bkey, cands);
    return { t: 'remembrance', rubric: head.title, line: head.line, quote: x ? textBlock(x, { rubric: '', swap: { kind: 'prayer', spec: { kind: 'word', moment: 'hour' + b.hour, state: null }, bkey } }) : null };
  },

  line(b, c) {
    return { t: 'line', rubric: b.rubric || '', line: line(b.set, c, b.set) };
  },

  question(b, c) {
    const arr = b.set === 'theme' ? (c.theme?.questions || []) : b.set;
    const q = line(arr, c, 'q');
    if (!q) return null;
    return { t: 'question', line: q, seconds: Math.round(c.st.silence * (b.k || 0.5)) };
  },

  themeverse(b, c) {
    if (!c.theme) return null;
    const v = verseText(c.theme.verse);
    if (!v) return null;
    return { t: 'verse', rubric: c.theme.title, ref: c.theme.verse, lines: v.lines, fav: { kind: 'verse', id: c.theme.verse, title: c.theme.verse } };
  },
};

/** Собрать чин */
export function buildOffice(officeId, state = 'normal', date = now(), opts = {}) {
  const off = C.office[officeId];
  if (!off) throw new Error('Нет чина ' + officeId);
  const c = makeContext(officeId, off.states === false ? 'normal' : state, date, opts);
  if (off.states === false) c.vol = 'normal';
  const plan = off.plans[c.state] || off.plans.normal;
  const blocks = [];
  plan.forEach((b, i) => {
    if (!applies(b, c)) return;
    const f = R[b.t];
    if (!f) { console.warn('[чин] неизвестный блок', b.t); return; }
    const bkey = b.key || `${b.t}${i}`;
    const r = f(b, c, bkey);
    if (r) blocks.push({ ...r, bkey });
  });
  store.save();
  return { id: officeId, title: off.title, state: c.state, ctx: c, blocks };
}

/** «Другая»: заменить молитву/псалом на следующий из того же пула */
export function swapBlock(office, block) {
  const c = office.ctx;
  const sw = block.swap;
  if (!sw) return null;
  const seen = (block._seen || []).concat(currentId(block));
  let list;
  if (sw.kind === 'prayer') list = prayerCandidates(c, sw.spec);
  else list = (sw.fromTheme ? (c.theme?.psalms || []) : (C.orders.pools[sw.pool] || [])).map((x) => ({ id: typeof x === 'number' ? `ps:${x}` : x }));
  let x = choose(c, sw.bkey + seen.length, list, preferThemes(c), seen);
  if (!x) x = choose(c, sw.bkey, list, [], [currentId(block)]); // круг пройден — начинаем снова
  if (!x) return null;
  c.picks[sw.bkey] = x.id;
  remember(c, x.id);
  store.save();
  let nb;
  if (sw.kind === 'prayer') nb = textBlock(x, { swap: sw, rubric: block.rubric === '' ? '' : (sw.spec.rubric || x.title) });
  else nb = x.id.startsWith('ps:') ? psalmBlock(+x.id.slice(3)) : odeBlock(x.id.replace(/^ode:/, ''));
  nb.swap = sw;
  nb.bkey = block.bkey;
  nb._seen = seen.length >= list.length - 1 ? [] : seen;
  return nb;
}

function currentId(block) {
  if (block.fav?.kind === 'psalm') return 'ps:' + block.fav.id;
  if (block.fav?.kind === 'ode') return 'ode:' + block.fav.id;
  return block.fav?.id || block.meta?.id;
}

/** Какое чтение будет сегодня — без записи (для экрана «Сейчас») */
export function peekReading(date = now()) {
  const day = dayInfo(date);
  const sp = specialReading(day);
  if (sp) return sp;
  const plan = C.scripture.plan;
  if (!plan.length) return null;
  const R = store.get().reading;
  let pos = R.pos;
  if (R.day !== day.key && R.day && R.shown) pos += 1;
  return plan[pos % plan.length];
}

/** Краткое описание чина для экрана «Сейчас» */
export function preview(officeId, date = now()) {
  const off = C.office[officeId];
  if (!off) return '';
  return off.subtitle || '';
}
