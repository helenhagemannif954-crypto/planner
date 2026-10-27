// Молитвослов Древней Церкви — запуск, экраны, переходы.

import { h, now, dayKey } from './util.js';
import * as store from './store.js';
import { C, loadContent, verseText, psalmVerses } from './content.js';
import { dayInfo, dateTitle, officeForTime, officesOfDay, weekTheme } from './calendar.js';
import { buildOffice, peekReading } from './office.js';
import { renderOffice, renderBlock } from './render.js';
import { downloadReminders } from './ics.js';
import { showTour } from './tour.js';

const app = document.getElementById('app');
const VERSION = '1.0.0';

// ——— оформление по настройкам ———
function applySettings() {
  const st = store.settings();
  const root = document.documentElement;
  root.style.setProperty('--fs', st.fontSize + 'px');
  if (st.theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = st.theme;
  const dark = st.theme === 'dark' || (st.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', dark ? '#151311' : '#f4ede1');
}

// ——— service worker ———
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js', { scope: './' }).then(
    (r) => console.log('[офлайн] service worker:', r && r.scope),
    (e) => console.warn('[офлайн] не зарегистрирован', e),
  );
}

let installEvent = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });

// ——— навигация ———
const TABS = [
  ['now', 'Сейчас'],
  ['orders', 'Чины'],
  ['themes', 'Темы'],
  ['fav', 'Избранное'],
  ['names', 'Помянник'],
];

function route() {
  const [name, ...rest] = (location.hash.slice(1) || 'now').split('/').map(decodeURIComponent);
  return { name, rest };
}

function go(hash, replace = false) {
  if (replace) history.replaceState(null, '', '#' + hash);
  else history.pushState(null, '', '#' + hash);
  render();
}

function topbar(title, { back = false, settings = true } = {}) {
  return h('header', { class: 'top' },
    back ? h('button', { type: 'button', class: 'icon', 'aria-label': 'Назад', onclick: () => history.back() }, '‹') : null,
    h('h1', {}, title),
    settings ? h('button', { type: 'button', class: 'icon', 'aria-label': 'Настройки', onclick: () => go('settings') }, h('span', { 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>' })) : null);
}

function navbar(active) {
  return h('nav', { class: 'tabs', 'aria-label': 'Разделы' },
    TABS.map(([id, label]) => h('button', { type: 'button', class: id === active ? 'on' : '', 'aria-current': id === active ? 'page' : null, onclick: () => go(id, true) }, label)));
}

function page(name, title, body, opts) {
  app.replaceChildren(h('div', { class: 'screen ' + name }, topbar(title, opts), h('main', { class: 'content' }, body), opts?.nav === false ? null : navbar(name)));
}

// ——— «Сейчас» ———
const OFFICE_NAMES = () => Object.fromEntries(C.orders.offices.map((o) => [o.id, o.title]));

function stateButtons(officeId, { big = true } = {}) {
  const off = C.office[officeId];
  // свой список вариантов (правило ко Причащению: «Полное» и «Краткое»)
  if (Array.isArray(off.states)) return h('div', { class: 'states' }, off.states.map((s, i) =>
    h('button', { type: 'button', class: 'btn' + (i === 0 ? ' primary' : '') + (big ? '' : ' small'), onclick: () => openOffice(officeId, s) }, off.stateLabels?.[s] || s)));
  if (off.states === false) return h('div', { class: 'states' }, h('button', { type: 'button', class: 'btn primary', onclick: () => openOffice(officeId, 'normal') }, 'Начать'));
  return h('div', { class: 'states' },
    h('button', { type: 'button', class: 'btn primary' + (big ? '' : ' small'), onclick: () => openOffice(officeId, 'normal') }, 'Начать'),
    h('button', { type: 'button', class: 'btn', onclick: () => openOffice(officeId, 'weary') }, 'Нет сил'),
    h('button', { type: 'button', class: 'btn', onclick: () => openOffice(officeId, 'hard') }, 'Тяжело'));
}

function screenNow() {
  const d = now();
  const st = store.settings();
  const info = dayInfo(d);
  const themeId = weekTheme(d, C.themes);
  const theme = themeId && C.theme[themeId];
  const cur = officeForTime(d, st);
  const off = C.office[cur];
  const body = [];
  body.push(h('p', { class: 'date' }, dateTitle(d)));
  if (info.label) body.push(h('p', { class: 'season' }, info.label));
  if (theme) {
    const v = verseText(theme.verse);
    // тема седмицы — кнопкой того же вида, что «Нет сил» и «Тяжело»: сразу молитва с чтением по теме
    body.push(h('section', { class: 'themecard', 'aria-label': 'Тема седмицы' },
      h('p', { class: 'kicker' }, 'Седмица'),
      h('p', { class: 'ttl' }, theme.title),
      v ? h('p', { class: 'tverse' }, v.lines.join(' '), ' ', h('span', { class: 'ref' }, theme.verse)) : null,
      h('div', { class: 'states' }, h('button', { type: 'button', class: 'btn themebtn', onclick: () => openOffice('theme', 'normal', { themeId: theme.id }) }, `Молиться по теме «${theme.title}»`))));
  }
  let sub = off.subtitle || '';
  if (cur === 'morning') {
    const p = peekReading(d);
    if (p) sub += ` · ${p.ref}`;
  }
  body.push(h('section', { class: 'maincard', 'aria-label': 'Предложенный чин' },
    h('p', { class: 'kicker' }, 'Сейчас'),
    h('h2', {}, off.title),
    sub ? h('p', { class: 'subtitle' }, sub) : null,
    stateButtons(cur)));
  const names = OFFICE_NAMES();
  const others = officesOfDay(st).filter((x) => x !== cur);
  body.push(h('h3', { class: 'sect' }, 'Сегодня'),
    h('ul', { class: 'list' }, others.map((id) => h('li', {}, h('button', { type: 'button', class: 'row', onclick: () => openOffice(id, 'normal') }, h('span', { class: 'rt' }, names[id]), h('span', { class: 'rs' }, C.office[id].when || ''))))));
  body.push(h('div', { class: 'quick' },
    h('button', { type: 'button', class: 'btn', onclick: () => openOffice('meal-before', 'normal') }, 'Перед едой'),
    h('button', { type: 'button', class: 'btn', onclick: () => openOffice('meal-after', 'normal') }, 'После еды'),
    h('button', { type: 'button', class: 'btn', onclick: () => openOffice('children', 'normal') }, 'С детьми')));
  page('now', 'Молитвослов', body);
}

// ——— «Чины» ———
const GROUPS = {
  communion: { title: 'Ко Причащению', line: 'Накануне вечером, утром перед Литургией и после Причащения — по молитвам Церкви первых веков.' },
};

function screenOrders() {
  const st = store.settings();
  const list = C.orders.offices.filter((o) => !o.hidden);
  const body = [];
  let group = null;
  for (const o of list) {
    if ((o.group || null) !== group) {
      group = o.group || null;
      const g = GROUPS[group];
      if (g) body.push(h('h3', { class: 'sect' }, g.title), h('p', { class: 'muted' }, g.line));
    }
    body.push(h('section', { class: 'card' },
      h('h2', {}, o.title), o.when ? h('p', { class: 'when' }, o.when) : null,
      o.subtitle ? h('p', { class: 'subtitle' }, o.subtitle) : null,
      stateButtons(o.id, { big: false })));
  }
  page('orders', 'Чины', body);
}

// ——— «Темы» ———
function screenThemes() {
  const d = now();
  const cur = weekTheme(d, C.themes);
  page('themes', 'Темы', [
    h('ul', { class: 'list themes' }, C.themes.themes.map((t) => h('li', {}, h('button', { type: 'button', class: 'row', onclick: () => go('theme/' + t.id) },
      h('span', { class: 'rt' }, t.title, t.id === cur ? h('span', { class: 'badge' }, 'эта седмица') : null),
      h('span', { class: 'rs' }, t.line))))),
  ]);
}

function screenTheme(id) {
  const t = C.theme[id];
  if (!t) return go('themes', true);
  const v = verseText(t.verse);
  const prayers = (C.prayers.pool || []).filter((p) => p.kind !== 'word' && (p.themes || []).some((x) => (t.prayerThemes || []).includes(x)));
  page('themes', t.title, [
    h('p', { class: 'lead' }, t.line),
    v ? h('blockquote', { class: 'tverse big' }, v.lines.join(' '), h('span', { class: 'ref' }, ' ' + t.verse)) : null,
    h('div', { class: 'states' }, h('button', { type: 'button', class: 'btn primary', onclick: () => openOffice('theme', 'normal', { themeId: id }) }, 'Помолиться · 5 минут')),
    t.psalms?.length ? h('h3', { class: 'sect' }, 'Псалмы') : null,
    h('ul', { class: 'list' }, (t.psalms || []).map((n) => h('li', {}, h('button', { type: 'button', class: 'row', onclick: () => go(`read/psalm/${n}`) }, h('span', { class: 'rt' }, `Псалом ${n}`), h('span', { class: 'rs' }, firstLine(n)))))),
    prayers.length ? h('h3', { class: 'sect' }, 'Молитвы') : null,
    h('ul', { class: 'list' }, prayers.map((p) => h('li', {}, h('button', { type: 'button', class: 'row', onclick: () => go(`read/text/${p.id}`) }, h('span', { class: 'rt' }, p.title), h('span', { class: 'rs' }, p.source))))),
  ], { back: true });
}

function firstLine(n) {
  const v = C.psalm[n]?.verses?.[0];
  return v ? v.l[0] : '';
}

// ——— «Избранное» ———
function screenFav() {
  const fav = store.get().favorites;
  if (!fav.length) {
    page('fav', 'Избранное', [h('p', { class: 'empty' }, 'Здесь будут сохранённые молитвы, псалмы и стихи. Коснитесь текста во время молитвы — под ним появится «☆ В избранное».')]);
    return;
  }
  page('fav', 'Избранное', h('ul', { class: 'list' }, fav.map((f) => h('li', {}, h('button', { type: 'button', class: 'row', onclick: () => go(`read/${f.kind}/${f.id}`) },
    h('span', { class: 'rt' }, f.title || f.id), h('span', { class: 'rs' }, preview(f)))))));
}

function preview(f) {
  if (f.kind === 'verse') return (verseText(f.id)?.lines || []).join(' ').slice(0, 90);
  if (f.kind === 'psalm') return firstLine(f.id);
  if (f.kind === 'text') return (C.text[f.id]?.text || []).find(Boolean) || '';
  if (f.kind === 'ode') return C.ode[f.id]?.verses?.[0]?.l?.[0] || '';
  if (f.kind === 'reading') return 'Чтение';
  return '';
}

// ——— чтение одного текста ———
function blockFor(kind, id) {
  if (kind === 'psalm') {
    const p = C.psalm[id];
    if (!p) return null;
    return { t: 'psalm', rubric: `Псалом ${p.n}`, title: p.title, verses: p.verses, meta: { source: `Пс ${p.n}`, century: 'Псалтирь; перевод с греческого (Септуагинта)', note: p.translation_note || '' }, fav: { kind: 'psalm', id: String(p.n), title: `Псалом ${p.n}` } };
  }
  if (kind === 'ode') {
    const o = C.ode[id];
    if (!o) return null;
    return { t: 'psalm', rubric: o.title, sub: o.ref, verses: o.verses, meta: { source: o.source, century: o.century, note: o.translation_note }, fav: { kind: 'ode', id, title: o.title } };
  }
  if (kind === 'text') {
    const t = C.text[id];
    if (!t) return null;
    return { t: 'text', rubric: t.title, lines: t.text, meta: { source: t.source, century: t.century, note: t.translation_note }, fav: { kind: 'text', id, title: t.title } };
  }
  if (kind === 'verse') {
    const v = verseText(id);
    if (!v) return null;
    return { t: 'verse', rubric: '', ref: id, lines: v.lines, fav: { kind: 'verse', id, title: id } };
  }
  if (kind === 'reading') {
    const p = Object.values(C.passage).find((x) => x.ref === id);
    if (!p) return null;
    return { t: 'reading', passage: p, special: true, double: false, questions: [], silence: 0, plain: true };
  }
  return null;
}

function screenRead(kind, id) {
  const b = blockFor(kind, id);
  if (!b) return go('fav', true);
  const root = h('article', { class: 'office reader' });
  const el = renderBlock(b, { plain: true, observe() {}, swap() {} });
  if (el) root.append(el);
  page('read', '', root, { back: true, nav: false });
}

// ——— «Помянник» ———
function screenNames() {
  const S = store.get();
  const L = C.prayers.lines.names;
  const part = (list, title, hint) => {
    const names = S.names[list];
    const inp = h('input', { type: 'text', 'aria-label': title + ': новое имя', placeholder: 'Имя', autocomplete: 'off', enterkeyhint: 'done' });
    const form = h('form', { class: 'addform', onsubmit: (e) => { e.preventDefault(); if (store.addName(list, inp.value)) screenNames(); } }, inp, h('button', { type: 'submit', class: 'btn' }, 'Добавить'));
    return h('section', { class: 'card names-card' }, h('h2', {}, title), h('p', { class: 'muted' }, hint),
      h('ul', { class: 'namelist-edit' }, names.map((n, i) => h('li', {},
        h('span', { class: 'nm' }, n),
        h('button', { type: 'button', class: 'icon small', 'aria-label': `Выше: ${n}`, disabled: i === 0, onclick: () => { store.moveName(list, i, -1); screenNames(); } }, '↑'),
        h('button', { type: 'button', class: 'icon small', 'aria-label': `Убрать: ${n}`, onclick: () => { store.removeName(list, i); screenNames(); } }, '×')))),
      form);
  };
  page('names', 'Помянник', [
    part('living', L.livingTitle, 'Имена звучат в прошениях утром и в полном вечернем чине.'),
    part('departed', L.departedTitle, 'Пишите так, как вам привычно произносить.'),
  ]);
}

// ——— «Настройки» ———
function seg(label, key, options) {
  const st = store.settings();
  return h('div', { class: 'setting' }, h('p', { class: 'sl' }, label),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, options.map(([v, t]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': st[key] === v ? 'true' : 'false', class: st[key] === v ? 'on' : '',
      onclick: () => { store.setSetting(key, v); applySettings(); screenSettings(); },
    }, t))));
}

function toggle(label, key, hint) {
  const st = store.settings();
  const id = 'sw-' + key;
  return h('div', { class: 'setting row-set' },
    h('label', { for: id, class: 'sl' }, label, hint ? h('span', { class: 'hint' }, hint) : null),
    h('input', { type: 'checkbox', role: 'switch', id, checked: !!st[key], onchange: (e) => { store.setSetting(key, e.target.checked); screenSettings(); } }));
}

function screenSettings() {
  const st = store.settings();
  const fsLabel = h('span', { class: 'val' }, st.fontSize + ' px');
  const body = [
    h('div', { class: 'setting' }, h('label', { class: 'sl', for: 'fs' }, 'Размер шрифта ', fsLabel),
      h('input', { type: 'range', id: 'fs', min: 16, max: 30, step: 1, value: st.fontSize, oninput: (e) => { store.setSetting('fontSize', +e.target.value); fsLabel.textContent = e.target.value + ' px'; applySettings(); } }),
      h('p', { class: 'sample' }, 'Боже, Боже мой, к Тебе я пробуждаюсь до рассвета.')),
    seg('Тема', 'theme', [['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']]),
    seg('Объём правила', 'volume', [['short', 'Краткое'], ['normal', 'Обычное'], ['full', 'Полное']]),
    seg('Режим чтения', 'readMode', [['normal', 'Обычный'], ['slow', 'Медленный'], ['plain', 'Только тексты']]),
    h('p', { class: 'muted' }, 'Медленный — чтение Писания по одной фразе за касание. «Только тексты» — без вопросов, тишины и пауз.'),
    seg('Тишина', 'silence', [[30, '30 с'], [60, '1 мин'], [120, '2 мин'], [180, '3 мин'], [300, '5 мин']]),
    seg('Молитва не повторяется', 'noRepeatDays', [[7, '7 дней'], [14, '14 дней'], [21, '21 день'], [30, '30 дней']]),
    toggle('Псалмы часа', 'pinPsalms', 'Пс 62 утром и Пс 140 вечером. Если выключить — только Псалтирь по порядку.'),
    toggle('Дневные часы', 'hours', 'Третий, шестой и девятый — по 1–2 минуты.'),
    toggle('Не гасить экран во время молитвы', 'wakeLock'),
    toggle('Мягкий звук в конце тишины', 'silenceSound'),
    toggle('Лёгкая вибрация в конце тишины', 'silenceVibrate'),
    h('h3', { class: 'sect' }, 'Напоминания о часах'),
    h('p', { class: 'muted' }, 'Выключены. Можно добавить часы молитвы в календарь телефона — тихими ежедневными событиями, без текста. Управлять и удалить их можно там же.'),
    reminderTimes(),
    h('div', { class: 'states' }, h('button', { type: 'button', class: 'btn', onclick: () => downloadReminders(store.settings(), C.orders.offices) }, 'Добавить в календарь (.ics)')),
    h('h3', { class: 'sect' }, 'Данные'),
    h('p', { class: 'muted' }, 'Всё хранится только на этом телефоне. Без аккаунтов, без сервера, без статистики.'),
    h('div', { class: 'states' },
      h('button', { type: 'button', class: 'btn', onclick: exportFile }, 'Сохранить копию'),
      h('button', { type: 'button', class: 'btn', onclick: importFile }, 'Восстановить из копии')),
    installEvent ? h('div', { class: 'states' }, h('button', { type: 'button', class: 'btn primary', onclick: async () => { installEvent.prompt(); installEvent = null; } }, 'Установить на телефон')) : null,
    h('h3', { class: 'sect' }, 'О молитвослове'),
    h('p', { class: 'muted' }, 'Молитвенный чин Церкви первых четырёх веков. Псалмы, песни и молитвы — в новом переводе; чтения — по Синодальному переводу. Источник каждого текста — мелко под ним, по касанию.'),
    h('div', { class: 'states' }, h('button', { type: 'button', class: 'btn', onclick: () => showTour({ onStart: startNow }) }, 'Как пользоваться')),
    h('p', { class: 'muted' }, 'Версия ' + VERSION),
  ];
  page('settings', 'Настройки', body, { back: true, settings: false });
}

function reminderTimes() {
  const st = store.settings();
  const ids = ['morning', ...(st.hours ? ['third', 'sixth', 'ninth'] : []), 'evening', 'sleep'];
  return h('div', { class: 'times' }, ids.map((id) => h('label', { class: 'time' }, h('span', {}, C.office[id].title),
    h('input', { type: 'time', value: st.reminders[id] || '', onchange: (e) => { st.reminders[id] = e.target.value; store.save(); } }))));
}

function exportFile() {
  const blob = new Blob([store.exportData()], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `molitvoslov-${dayKey(new Date())}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function importFile() {
  const inp = h('input', { type: 'file', accept: 'application/json,.json' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      store.importData(await f.text());
      applySettings();
      screenSettings();
      toast('Восстановлено');
    } catch (e) {
      toast('Не получилось: ' + e.message);
    }
  });
  inp.click();
}

function toast(text) {
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ——— молитва ———
let wake = null;
async function keepAwake(on) {
  try {
    if (on && store.settings().wakeLock && 'wakeLock' in navigator) wake = await navigator.wakeLock.request('screen');
    else if (!on && wake) { await wake.release(); wake = null; }
  } catch { wake = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && document.querySelector('.pray')) keepAwake(true);
});

const STATE_LABEL = { normal: '', weary: 'Нет сил', hard: 'Тяжело' };

/** «Начать молитву» из знакомства: чин, который «Сейчас» предлагает по времени */
function startNow() {
  openOffice(officeForTime(now(), store.settings()), 'normal');
}

function openOffice(id, state, opts = {}) {
  const extra = opts.themeId ? '/' + opts.themeId : '';
  go(`pray/${id}/${state}${extra}`);
}

function screenPray(id, state, themeId) {
  const off = C.office[id];
  if (!off) return go('now', true);
  const d = now();
  const office = buildOffice(id, state || 'normal', d, themeId ? { themeId } : {});
  const art = h('article', { class: 'office' });
  const title = themeId ? `${off.title}: ${C.theme[themeId]?.title || ''}` : off.title;
  art.append(h('header', { class: 'office-head' },
    h('h1', {}, title),
    h('p', { class: 'odate' }, [dateTitle(d), (off.stateLabels || STATE_LABEL)[office.state]].filter(Boolean).join(' · '))));
  const wrap = h('div', { class: 'pray', role: 'dialog', 'aria-label': title });
  const close = () => { keepAwake(false); history.length > 1 ? history.back() : go('now', true); };
  const bar = h('div', { class: 'praybar' }, h('button', { type: 'button', class: 'icon', 'aria-label': 'Закрыть молитву', onclick: close }, '×'));
  wrap.append(bar, art);
  app.replaceChildren(wrap);
  const cleanup = renderOffice(office, art, { onClose: close });
  wrap._cleanup = cleanup;
  keepAwake(true);
  // строка «закрыть» прячется, пока читаешь вниз, и появляется при движении вверх
  let lastY = 0;
  wrap.addEventListener('scroll', () => {
    const y = wrap.scrollTop;
    bar.classList.toggle('hide', y > 80 && y > lastY);
    lastY = y;
  }, { passive: true });
  window.scrollTo(0, 0);
}

// ——— главный цикл ———
function render() {
  const old = app.querySelector('.pray');
  if (old && old._cleanup) old._cleanup();
  const { name, rest } = route();
  if (name !== 'pray') keepAwake(false);
  document.body.classList.toggle('praying', name === 'pray');
  switch (name) {
    case 'now': return screenNow();
    case 'orders': return screenOrders();
    case 'themes': return screenThemes();
    case 'theme': return screenTheme(rest[0]);
    case 'fav': return screenFav();
    case 'names': return screenNames();
    case 'settings': return screenSettings();
    case 'read': return screenRead(rest[0], rest.slice(1).join('/'));
    case 'pray': return screenPray(rest[0], rest[1], rest[2]);
    default: return screenNow();
  }
}

addEventListener('popstate', render);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applySettings);

async function boot() {
  store.load();
  applySettings();
  registerSW();
  try {
    await loadContent();
  } catch (e) {
    app.replaceChildren(h('p', { class: 'empty' }, 'Не удалось открыть тексты. Проверьте соединение при первом запуске.'));
    console.error(e);
    return;
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  render();
  // знакомство — один раз, при первом открытии (отмечается сразу: закрыть приложение посреди
  // знакомства тоже значит «уже видел»; снова — «Как пользоваться» в настройках)
  if (!store.get().tourSeen) {
    store.get().tourSeen = true;
    store.save();
    showTour({ onStart: startNow });
  }
  window.__ready = true;
}

boot();
