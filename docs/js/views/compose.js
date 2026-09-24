// Быстрый ввод: разбор на лету, фишки, голос, запуск цепочек.
import { h, icon, toast, hideToast, choose, prompt, pickDate, pickTime, quickDays, buzz, clear } from '../ui.js';
import * as st from '../store.js';
import { S } from '../store.js';
import { parse, dateLabel, partLabel } from '../parse.js';
import { fmtDay, addDays, weekStart } from '../dates.js';
import { describe as describeRepeat } from '../recur.js';
import { pickArea, pickPerson, pickRepeat, pickContext, pickSize, pickTemplate } from './pickers.js';
import { findCode, decode } from '../share.js';

export function parseCtx() {
  return {
    now: st.clock(),
    areas: st.areasList(),
    templates: st.templatesList(),
    people: [...S.people.values()].filter((p) => p.status !== 'archived'),
    contexts: st.contexts(),
  };
}

/** Итог: разбор + ручные правки. */
function merged(state) {
  const r = parse(state.text, parseCtx());
  const o = state.over;
  const m = { ...r };
  for (const k of Object.keys(o)) m[k] = o[k];
  if (o.time !== undefined && o.time) m.part = null;
  if (o.date !== undefined && !o.date) { m.date = null; m.dateKind = null; }
  if (state.done) m.done = true;
  if (!m.templateId) m.newPerson = null;
  if (m.personId && o.personId !== undefined) m.newPerson = null;
  if ((m.star || m.time || m.part) && !m.date) { m.date = st.T(); m.dateKind = 'day'; }
  return m;
}

const PARTS = { morning: 'Утро', day: 'День', evening: 'Вечер' };

/** Создаёт компонент ввода. mode: 'inline' | 'full'. */
export function composer(mode = 'inline', opts = {}) {
  const state = { text: '', over: {}, done: false, open: mode === 'full', listening: false };
  const root = h('div.composer' + (mode === 'full' ? '.full-mode' : ''));
  const extra = h('div.comp-extra');
  const input = h('textarea.comp-input', {
    rows: 1, placeholder: mode === 'full' ? 'Что нужно сделать?' : 'Добавить…', 'aria-label': 'Новая задача',
    enterkeyhint: 'done', maxlength: 1000, autocomplete: 'off',
  });
  const mic = h('button.round.soft', { 'aria-label': 'Голосом', onclick: () => listen() }, icon('mic'));
  const save = h('button.round.accent', { 'aria-label': 'Добавить', onclick: () => submit() }, icon(mode === 'full' ? 'check' : 'plus'));
  root.append(extra, h('div.comp-row', input, mic, save));

  input.addEventListener('input', () => {
    state.text = input.value;
    autosize();
    renderExtra();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && mode === 'inline') { input.blur(); collapse(); }
  });
  input.addEventListener('focus', () => { if (mode === 'inline') hideToast(); if (!state.open) { state.open = true; root.classList.add('open'); renderExtra(); } });
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; }
  function collapse() {
    if (mode !== 'inline' || state.text) return;
    state.open = false; state.over = {}; state.done = false;
    root.classList.remove('open');
    clear(extra);
  }
  document.addEventListener('pointerdown', (e) => {
    if (mode === 'inline' && state.open && !root.contains(e.target) && !e.target.closest('.overlay') && !state.text) collapse();
  });

  function chipBtn(label, onTap, onRemove, cls = '', extraKid = null) {
    return h('button.chip' + cls, { onclick: onTap }, extraKid, label, onRemove ? h('span.x', {
      'aria-label': 'Убрать', role: 'button',
      onclick: (e) => { e.stopPropagation(); onRemove(); },
    }, '×') : null);
  }

  function renderExtra() {
    if (!state.open) return;
    clear(extra);
    const m = merged(state);
    const o = state.over;
    const set = (patch) => { Object.assign(o, patch); renderExtra(); input.focus({ preventScroll: true }); };
    const parsed = [];
    if (state.text.trim()) {
      for (const c of m.chips.length || Object.keys(o).length ? chipsFor(m) : []) {
        parsed.push(chipBtn(c.label, () => edit(c.key, m, set), () => remove(c.key, set), '.parsed', c.color ? h('span.dot', { style: { background: c.color } }) : null));
      }
    }
    if (parsed.length) extra.append(h('div.chips', { 'aria-label': 'Распознано' }, parsed));
    // ручной выбор за 2 касания
    const quick = [];
    const now = st.clock();
    for (const q of quickDays(now).slice(0, 4)) {
      quick.push(h('button.chip.small' + (m.date === q.date && m.dateKind === 'day' ? '.on' : ''), { onclick: () => set({ date: m.date === q.date ? null : q.date, dateKind: 'day' }) }, q.label));
    }
    const ws = weekStart(st.T());
    quick.push(h('button.chip.small' + (m.date === ws && m.dateKind === 'week' ? '.on' : ''), { onclick: () => set(m.date === ws && m.dateKind === 'week' ? { date: null, dateKind: null } : { date: ws, dateKind: 'week' }) }, 'Эта неделя'));
    quick.push(h('button.chip.small', { onclick: async () => { const p = await pickDate({ now, value: m.date }); if (p) set({ date: p.date, dateKind: p.dateKind }); } }, 'Выбрать…'));
    for (const [p, l] of Object.entries(PARTS)) quick.push(h('button.chip.small' + (m.part === p && !m.time ? '.on' : ''), { onclick: () => set({ part: m.part === p ? null : p, time: null }) }, l));
    quick.push(h('button.chip.small', { onclick: async () => { const t = await pickTime({ value: m.time, withDur: true, dur: m.dur }); if (t) set({ time: t.time, part: t.part, dur: t.dur || m.dur }); } }, 'Время…'));
    quick.push(h('button.chip.small' + (m.star ? '.on' : ''), { onclick: () => set({ star: !m.star }) }, '★ Главное'));
    quick.push(h('button.chip.small', { onclick: async () => { const a = await pickArea(m.areaId); if (a !== undefined) set({ areaId: a }); } }, 'Область…'));
    quick.push(h('button.chip.small' + (state.done ? '.on' : ''), { onclick: () => { state.done = !state.done; renderExtra(); } }, '✓ Уже сделал'));
    if (st.templatesList().length) quick.push(h('button.chip.small', { onclick: async () => { const t = await pickTemplate(); if (t) set({ templateId: t }); } }, 'Цепочка…'));
    extra.append(h('div.chips', quick));
    if (state.hint) extra.append(h('div.comp-hint', state.hint));
  }

  async function edit(key, m, set) {
    const now = st.clock();
    switch (key) {
      case 'date': { const p = await pickDate({ now, value: m.date }); if (p) set({ date: p.date, dateKind: p.dateKind }); break; }
      case 'time': { const t = await pickTime({ value: m.time, part: m.part, withDur: true, dur: m.dur }); if (t) set({ time: t.time, part: t.part, dur: t.dur || null }); break; }
      case 'deadline': { const p = await pickDate({ now, value: m.deadline, title: 'Жёсткий срок', allowWeek: false, allowMonth: false, noneLabel: 'Без срока' }); if (p) set({ deadline: p.date }); break; }
      case 'area': { const a = await pickArea(m.areaId); if (a !== undefined) set({ areaId: a }); break; }
      case 'repeat': { const r = await pickRepeat(m.repeat, m.date); if (r !== undefined) set({ repeat: r }); break; }
      case 'ctx': { const c = await pickContext(m.ctx); if (c !== undefined) set({ ctx: c }); break; }
      case 'size': { const z = await pickSize(m.size); if (z !== undefined) set({ size: z }); break; }
      case 'star': set({ star: !m.star }); break;
      case 'person': { const p = await pickPerson(m.personId, m.areaId); if (p !== undefined) set({ personId: p, newPerson: null }); break; }
      case 'template': { const t = await pickTemplate(); if (t) set({ templateId: t }); break; }
      case 'done': state.done = !state.done; renderExtra(); break;
    }
  }
  function remove(key, set) {
    const map = {
      date: { date: null, dateKind: null }, time: { time: null, part: null, dur: null }, deadline: { deadline: null },
      area: { areaId: null }, repeat: { repeat: null }, ctx: { ctx: null }, size: { size: null, dur: null }, star: { star: false },
      person: { personId: null, newPerson: null }, template: { templateId: null, newPerson: null },
    };
    if (key === 'done') { state.done = false; renderExtra(); return; }
    set(map[key] || {});
  }

  // ——— голос ———
  let rec = null;
  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      state.hint = 'Распознавание речи здесь недоступно — нажмите микрофон на клавиатуре и продиктуйте.';
      state.open = true; root.classList.add('open');
      renderExtra();
      input.focus();
      return;
    }
    if (state.listening && rec) { rec.stop(); return; }
    try {
      rec = new SR();
      rec.lang = 'ru-RU';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      const base = input.value ? input.value.trim() + ' ' : '';
      rec.onresult = (e) => {
        let txt = '';
        for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        input.value = (base + txt).slice(0, 1000);
        state.text = input.value;
        autosize();
        renderExtra();
      };
      rec.onerror = (e) => {
        state.hint = e.error === 'not-allowed' ? 'Нет доступа к микрофону. Можно диктовать с клавиатуры.' : e.error === 'network' ? 'Для голоса нужен интернет. Можно диктовать с клавиатуры.' : 'Не расслышал. Попробуйте ещё раз.';
        renderExtra();
      };
      rec.onend = () => { state.listening = false; mic.classList.remove('listening'); };
      rec.start();
      buzz(10);
      state.listening = true; mic.classList.add('listening');
      state.open = true; root.classList.add('open'); state.hint = 'Говорите…'; renderExtra();
      setTimeout(() => { if (state.hint === 'Говорите…') { state.hint = ''; } }, 4000);
    } catch {
      state.hint = 'Голос не запустился — нажмите микрофон на клавиатуре.';
      renderExtra();
    }
  }

  // ——— сохранение ———
  async function submit() {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const code = findCode(text);
    if (code) {
      const obj = decode(code);
      const { acceptShared } = await import('./share.js');
      if (obj) { reset(); acceptShared(obj); return; }
    }
    const m = merged(state);
    if (!m.text && !m.templateId) m.text = text;
    let result;
    if (m.templateId) result = await launchFromParse(m);
    else result = await createFromParse(m);
    if (!result) return;
    reset();
    if (opts.onAdded) opts.onAdded(result);
  }
  function reset() {
    input.value = ''; state.text = ''; state.over = {}; state.done = false; state.hint = '';
    autosize();
    renderExtra();
    if (mode === 'inline') { input.blur(); collapse(); }
  }

  root.focusInput = () => { input.focus(); };
  root.listen = listen;
  root.setText = (t) => { input.value = t; state.text = t; autosize(); state.open = true; root.classList.add('open'); renderExtra(); };
  if (mode === 'full') setTimeout(renderExtra, 0);
  return root;
}

function chipsFor(m) {
  // пересобираем подписи с учётом правок
  const now = st.clock();
  const c = [];
  if (m.done) c.push({ key: 'done', label: '✓ уже сделано' });
  if (m.templateId) { const t = S.templates.get(m.templateId); c.push({ key: 'template', label: 'цепочка: ' + (t ? t.name : '') }); }
  if (m.personId) { const p = S.people.get(m.personId); c.push({ key: 'person', label: p ? p.code : '' }); }
  else if (m.newPerson) c.push({ key: 'person', label: m.newPerson + ' (новый)' });
  if (m.date) c.push({ key: 'date', label: dateLabel(m.date, m.dateKind, now) });
  if (m.time) c.push({ key: 'time', label: m.time + (m.dur ? ' · ' + (m.dur >= 60 ? m.dur / 60 + ' ч' : m.dur + ' мин') : '') });
  else if (m.part) c.push({ key: 'time', label: partLabel(m.part) });
  if (m.deadline) c.push({ key: 'deadline', label: 'срок ' + fmtDay(m.deadline, now) });
  if (m.repeat) c.push({ key: 'repeat', label: describeRepeat(m.repeat) });
  if (m.star) c.push({ key: 'star', label: '★ главное' });
  if (m.areaId) { const a = st.area(m.areaId); if (a) c.push({ key: 'area', label: a.name, color: a.color }); }
  if (m.ctx) { const x = st.contexts().find((y) => y.id === m.ctx); if (x) c.push({ key: 'ctx', label: x.name }); }
  if (m.size && !m.time) c.push({ key: 'size', label: { S: 'быстро', M: 'около часа', L: 'большое' }[m.size] });
  if (!c.length || (!m.date && !m.areaId && !m.deadline && !m.templateId && !m.done)) c.push({ key: 'inbox', label: '→ во «Входящие»' });
  return c;
}

/** Создать задачу из разобранного ввода. */
export async function createFromParse(m) {
  const fields = {
    text: m.text, date: m.date, dateKind: m.date ? m.dateKind || 'day' : null, time: m.time, part: m.time ? null : m.part,
    dur: m.dur, deadline: m.deadline, size: m.size, repeat: m.repeat, ctx: m.ctx, areaId: m.areaId, personId: m.personId || null,
  };
  if (m.star) fields.star = m.date || st.T();
  if (m.done) {
    fields.status = 'done';
    fields.doneAt = st.clock().toISOString();
    fields.star = null;
    if (!fields.date) { fields.date = st.T(); fields.dateKind = 'day'; }
  }
  fields.inbox = !m.done && !fields.date && !fields.areaId && !fields.deadline && !fields.personId;
  if (fields.star) {
    const cur = st.mainOf(fields.star);
    if (cur.length >= 3) {
      const v = await choose('Уже три главных', [
        ...cur.map((t) => ({ label: 'Убрать: ' + (t.text), value: t.id })),
        { label: 'Добавить не главным', value: '__plain', primary: true },
      ], { text: 'Четвёртое главное — только вместо одного из трёх.' });
      if (v === null) return null;
      if (v === '__plain') fields.star = null;
      else st.setStar(v, false);
    }
  }
  if (fields.size === 'L' && !m.done) {
    const step = await prompt('Большая задача', '', { text: 'Какой первый маленький шаг? (можно пропустить)', placeholder: 'Например: набросать план', ok: 'Готово' });
    if (step) fields.checklist = [{ id: st.uid(), text: step, done: false }];
  }
  const r = st.addTask(fields);
  const t = r.result;
  const now = st.clock();
  let where = m.done ? 'Записано в сделанное' : t.inbox ? 'Во «Входящие»' : t.date ? 'Добавлено: ' + dateLabel(t.date, t.dateKind, now) : 'Добавлено';
  toast(where, { action: 'Отменить', onAction: () => r.undo() });
  buzz(8);
  return { task: t, undo: r.undo, message: where, saved: r.saved };
}

/** Запуск цепочки из разобранной фразы. */
export async function launchFromParse(m) {
  const tpl = S.templates.get(m.templateId);
  if (!tpl) return null;
  let personId = m.personId || null;
  if (!personId && m.newPerson) {
    const areaId = tpl.areaId || m.areaId || null;
    const a = st.area(areaId);
    const v = await choose('Новый человек: ' + m.newPerson, [
      { label: 'Создать ' + m.newPerson + (a ? ' в «' + a.name + '»' : ''), value: 'create', primary: true },
      { label: 'Запустить без человека', value: 'none' },
    ], { text: a && a.private && !st.meta('clientHintShown') ? 'Для клиентов — только код или инициалы, без имён. Имена людей закрытой области скрыты на экране.' : null });
    if (!v) return null;
    if (v === 'create') {
      const p = st.newPerson({ code: m.newPerson, areaId, templateId: tpl.id });
      st.change(() => { st.put('people', p); st.setMeta('clientHintShown', true); });
      personId = p.id;
    }
  }
  let anchor = null;
  if (tpl.anchor) {
    let date = m.date && m.dateKind === 'day' ? m.date : null;
    let time = m.time;
    const p = st.person(personId);
    if (!date) {
      const d = await pickDate({ now: st.clock(), title: (tpl.anchor.label || 'Якорь') + ': когда?', allowWeek: false, allowMonth: false, allowNone: false });
      if (!d || !d.date) return null;
      date = d.date;
    }
    if (!time && p && p.schedule && p.schedule.time) time = p.schedule.time;
    if (!time) {
      const t = await pickTime({ title: (tpl.anchor.label || 'Якорь') + ': во сколько?' });
      if (t === null) return null;
      time = t.time;
    }
    anchor = { date, time, dur: m.dur || tpl.anchor.dur };
  }
  const detail = m.text && m.text.length > 1 ? m.text : '';
  const r = st.launchTemplate(tpl.id, { anchor, personId, detail, start: anchor ? null : m.date || st.T() });
  if (!r) return null;
  const days = [...new Set(r.tasks.filter((t) => t.date && st.loadOf(t.date).level === 'over').map((t) => t.date))].sort();
  if (days.length) {
    const v = await choose('Плотно', [
      { label: 'Оставить как есть', value: 'keep', primary: true },
      { label: 'Отменить запуск', value: 'undo' },
    ], { text: 'Получается перегруз: ' + days.map((d) => fmtDay(d, st.clock())).join(', ') + '. Можно оставить — просто имейте в виду.' });
    if (v === 'undo') { await r.undo(); return null; }
  }
  const msg = 'Цепочка: ' + (st.isPrivate({ areaId: r.group.areaId }) ? tpl.name : r.group.title);
  toast(msg, { action: 'Отменить', onAction: () => r.undo() });
  buzz(8);
  return { group: r.group, undo: r.undo, message: msg, saved: r.saved };
}

export { addDays };
