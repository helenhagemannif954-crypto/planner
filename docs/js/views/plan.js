// «План»: День / Неделя / Месяц / Год.
import { h, icon, sheet, toast, choose, prompt, pickDate, clear, buzz } from '../ui.js';
import * as st from '../store.js';
import { S } from '../store.js';
import {
  today, addDays, weekStart, monthStart, monthEnd, dow, fmtDay, fmtLong, fmtShort, fmtDur, toMin, fromMin,
  DOW_SHORT, MONTHS_NOM, MONTHS, daysInMonth, mkDate, addMonths, diffDays, parseYmd, plural, ymd,
} from '../dates.js';
import { churchDay, churchYear } from '../church.js';
import { app, taskRow, emptyState, sectionHead, isHidden, deadlineLabel, areaDot, hiddenArea } from './common.js';

const MODES = [['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц'], ['year', 'Год']];

export function renderPlan(root) {
  if (!app.planDate) app.planDate = st.T();
  root.append(h('div.seg', { role: 'group', 'aria-label': 'Масштаб' }, MODES.map(([k, l]) => h('button', {
    'aria-pressed': String(app.planMode === k), onclick: () => { app.planMode = k; app.render(); },
  }, l))));
  if (app.planMode === 'day') renderDay(root, app.planDate);
  else if (app.planMode === 'month') renderMonth(root, app.planDate);
  else if (app.planMode === 'year') renderYear(root, app.planDate);
  else renderWeek(root, app.planDate);
}
const setDate = (d, mode) => { app.planDate = d; if (mode) app.planMode = mode; app.render(); };

function nav(label, prev, next, onTitle) {
  return h('div.daynav',
    h('button.icon-btn', { 'aria-label': 'Назад', onclick: prev }, icon('back')),
    h('button', { style: { flex: 1, fontWeight: 600, minHeight: '3rem' }, onclick: onTitle }, label),
    h('button.icon-btn', { 'aria-label': 'Вперёд', onclick: next }, icon('right')));
}

function churchText(d) {
  const cd = churchDay(d);
  const bits = cd.feasts.filter((f) => f.kind !== 'memorial' || cd.feasts.length === 1).map((f) => f.title);
  if (!bits.length && cd.eveOf.length) bits.push('канун: ' + cd.eveOf[0].title);
  if (cd.periods.length) bits.push(cd.periods.map((p) => p.title).join(', '));
  return bits.join(' · ');
}

function loadBar(d) {
  const l = st.loadOf(d);
  const pct = Math.min(100, l.ratio * 100);
  return { el: h('div.load', { role: 'img', 'aria-label': 'нагрузка ' + fmtDur(l.min) + ' из ' + fmtDur(l.cap) }, h('i.lv-' + l.level, { style: { width: Math.max(pct, l.min ? 4 : 0) + '%' } })), l };
}

// ——— День ———
const PX = 1.1; // пикселей в минуте
function renderDay(root, d) {
  const now = st.clock();
  root.append(nav(fmtLong(d), () => setDate(addDays(d, -1)), () => setDate(addDays(d, 1)), async () => { const p = await pickDate({ now, value: d, allowWeek: false, allowMonth: false, allowNone: false }); if (p && p.date) setDate(p.date); }));
  const ct = churchText(d);
  if (ct) root.append(h('div.church-line', ct));
  const { el, l } = loadBar(d);
  root.append(h('div.muted.small', 'Занято ' + (fmtDur(l.min) || '0') + ' из ' + (fmtDur(l.cap) || '0 ч')), el);
  if (l.level === 'over') root.append(h('p.muted.small', 'День получается плотным — может, что-то перенести?'));

  const blocks = st.blocksOn(d);
  const all = [...S.tasks.values()].filter((t) => !t.deletedAt && t.status !== 'someday' && !t.waitFor && t.date === d && (t.dateKind === 'day' || !t.dateKind));
  const ns = st.nextSteps();
  const timed = all.filter((t) => t.time);
  const untimed = st.sortTasks(all.filter((t) => !t.time && t.status === 'active' && (!t.groupId || t.isAnchor || ns.get(t.groupId) === t || t.date === d)));
  const starts = [...blocks.map((b) => toMin(b.start)), ...timed.map((t) => toMin(t.time))];
  const ends = [...blocks.map((b) => toMin(b.end)), ...timed.map((t) => toMin(t.time) + st.taskMin(t))];
  const from = Math.min(7 * 60, ...starts.map((x) => Math.floor(x / 60) * 60));
  const to = Math.max(22 * 60, ...ends.map((x) => Math.ceil(x / 60) * 60));
  const tl = h('div.timeline', { style: { height: (to - from) * PX + 'px' } });
  for (let m = from; m <= to; m += 60) {
    tl.append(h('div.tl-line', { style: { top: (m - from) * PX + 'px' } }), h('div.tl-hour', { style: { top: (m - from) * PX + 'px' } }, fromMin(m)));
  }
  // раскладка по дорожкам при пересечениях
  const items = [
    ...blocks.map((b) => ({ kind: 'block', a: toMin(b.start), b: toMin(b.end), b0: b })),
    ...timed.map((t) => ({ kind: 'task', a: toMin(t.time), b: toMin(t.time) + st.taskMin(t), t })),
  ].sort((x, y) => x.a - y.a);
  const lanes = [];
  for (const it of items) {
    let i = lanes.findIndex((end) => end <= it.a);
    if (i < 0) { i = lanes.length; lanes.push(0); }
    lanes[i] = it.b;
    it.lane = i;
  }
  const nl = Math.max(1, lanes.length);
  for (const it of items) {
    const style = {
      top: (it.a - from) * PX + 'px', height: Math.max(26, (it.b - it.a) * PX - 2) + 'px',
      left: `calc(.4rem + ${(it.lane / nl) * 100}%)`, right: 'auto', width: `calc(${100 / nl}% - .5rem)`,
    };
    if (it.kind === 'block') {
      const a = st.area(it.b0.areaId);
      tl.append(h('div.tl-item.block', { style }, h('span', it.b0.start + ' ' + (it.b0.title || (a ? a.name : 'Блок')))));
    } else {
      const t = it.t;
      const a = st.area(t.areaId);
      if (a) style.borderLeftColor = a.color;
      tl.append(h('button.tl-item' + (t.isAnchor ? '.anchor' : '') + (t.status === 'done' ? '.done' : ''), {
        style, onclick: () => app.openTask(t.id),
      }, h('span', t.time + ' ' + (isHidden(t) ? '•••' : t.text))));
    }
  }
  // свободные окна
  for (const w of st.freeWindows(d, fromMin(Math.max(from, 7 * 60)), fromMin(Math.min(to, 22 * 60)))) {
    if (w.min < 45) continue;
    const el2 = h('button.tl-free', {
      dataset: { start: w.start },
      style: { top: (toMin(w.start) - from) * PX + 2 + 'px', height: Math.max(24, w.min * PX - 4) + 'px' },
      onclick: () => placeInto(d, w, untimed),
    }, 'свободно ' + fmtDur(w.min));
    tl.append(el2);
  }
  if (d === today(now)) {
    const m = now.getHours() * 60 + now.getMinutes();
    if (m >= from && m <= to) tl.append(h('div.tl-now', { style: { top: (m - from) * PX + 'px' } }));
  }
  root.append(tl);
  tl.dataset.from = String(from);

  root.append(sectionHead('Без времени'));
  if (untimed.length) {
    root.append(h('div.list', untimed.map((t) => {
      const row = taskRow(t, { hideTime: true });
      const handle = h('button.icon-btn', { 'aria-label': 'Перетащить на ленту', style: { touchAction: 'none' } }, icon('drag', 18));
      handle.addEventListener('pointerdown', (e) => dragToTimeline(e, t, tl, from));
      handle.addEventListener('click', (e) => { e.stopPropagation(); placeTask(t, d); });
      row.querySelector('.row-inner').append(handle);
      return row;
    })));
  } else root.append(h('p.muted.small', { style: { margin: '.25rem .5rem' } }, 'Все дела дня — на ленте.'));
}

async function placeInto(d, w, untimed) {
  const cand = untimed.filter((t) => !t.isAnchor);
  if (!cand.length) { toast('Свободно ' + fmtDur(w.min) + ' — можно отдохнуть'); return; }
  const v = await choose('В окно ' + w.start + '–' + w.end, cand.map((t) => ({ label: (isHidden(t) ? '•••' : t.text) + (t.size ? ' · ' + t.size : ''), value: t.id })));
  if (!v) return;
  const r = st.updateTask(v, { time: w.start, part: null });
  toast('Поставлено на ' + w.start, { action: 'Отменить', onAction: () => r.undo() });
}
async function placeTask(t, d) {
  const wins = st.freeWindows(d);
  const v = await choose('Куда поставить', [...wins.map((w) => ({ label: w.start + '–' + w.end + ' · свободно ' + fmtDur(w.min), value: w.start })), { label: 'Выбрать время…', value: '__pick' }]);
  if (!v) return;
  let time = v;
  if (v === '__pick') { const { pickTime } = await import('../ui.js'); const p = await pickTime({}); if (!p || !p.time) return; time = p.time; }
  const r = st.updateTask(t.id, { time, part: null });
  toast('Поставлено на ' + time, { action: 'Отменить', onAction: () => r.undo() });
}

function dragToTimeline(e, t, tl, from) {
  e.preventDefault();
  const ghost = h('div.drag-ghost', isHidden(t) ? '•••' : t.text);
  document.body.append(ghost);
  let time = null;
  const mv = (ev) => {
    ghost.style.left = ev.clientX + 12 + 'px';
    ghost.style.top = ev.clientY - 20 + 'px';
    const r = tl.getBoundingClientRect();
    if (ev.clientY >= r.top && ev.clientY <= r.bottom && ev.clientX >= r.left - 40) {
      const m = Math.round(((ev.clientY - r.top) / PX + from) / 15) * 15;
      time = fromMin(m);
      ghost.textContent = time + ' · ' + (isHidden(t) ? '•••' : t.text);
    } else { time = null; ghost.textContent = isHidden(t) ? '•••' : t.text; }
    // автопрокрутка
    const view = document.getElementById('view');
    if (view) { const vr = view.getBoundingClientRect(); if (ev.clientY < vr.top + 40) view.scrollTop -= 12; if (ev.clientY > vr.bottom - 40) view.scrollTop += 12; }
  };
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    ghost.remove();
    if (time) {
      buzz(10);
      const r = st.updateTask(t.id, { time, part: null });
      toast('Поставлено на ' + time, { action: 'Отменить', onAction: () => r.undo() });
    }
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

// ——— Неделя ———
function renderWeek(root, d) {
  const ws = weekStart(d);
  const T = st.T();
  const now = st.clock();
  root.append(nav(fmtShort(ws) + ' – ' + fmtShort(addDays(ws, 6)), () => setDate(addDays(ws, -7)), () => setDate(addDays(ws, 7)), () => setDate(T)));
  // жёсткие сроки — отдельная лента
  const dls = st.deadlines(45);
  if (dls.length) {
    root.append(sectionHead('Сроки'));
    root.append(h('div.ribbon', dls.map((t) => h('button.dl', { onclick: () => app.openTask(t.id) }, h('b', deadlineLabel(t.deadline)), h('span', isHidden(t) ? '•••' : t.text)))));
  }
  const over = [];
  const ns = st.nextSteps();
  for (let i = 0; i < 7; i++) {
    const day = addDays(ws, i);
    const { el, l } = loadBar(day);
    if (l.level === 'over' && day >= T) over.push(day);
    const cd = churchDay(day);
    const f = cd.feasts.find((x) => x.kind !== 'memorial') || null;
    const items = [];
    for (const b of st.blocksOn(day)) items.push({ tm: b.start, text: b.title || (st.area(b.areaId) || {}).name || 'Блок', block: true });
    const tasks = [...S.tasks.values()].filter((t) => !t.deletedAt && t.status === 'active' && !t.waitFor && t.date === day && t.dateKind === 'day' && (!t.groupId || t.isAnchor || ns.get(t.groupId) === t || t.time));
    for (const t of st.sortTasks(tasks)) items.push({ tm: t.time || '', text: isHidden(t) ? '•••' : t.text, t });
    items.sort((a, b) => (a.tm || '99') < (b.tm || '99') ? -1 : 1);
    const shown = items.slice(0, 6);
    root.append(h('div.week-day' + (day === T ? '.today' : ''),
      h('button.wd-head', { onclick: () => setDate(day, 'day') },
        h('b', DOW_SHORT[i] + ', ' + parseYmd(day).getDate() + ' ' + MONTHS[parseYmd(day).getMonth()]),
        f ? h('span.small', { style: { color: 'var(--gold)' } }, f.title) : cd.eveOf.length ? h('span.small.faint', 'канун праздника') : null,
        h('span.grow'), l.min ? h('span.small.muted', fmtDur(l.min)) : null),
      el,
      shown.map((it) => h('div.wd-item' + (it.block ? '.block' : ''), { onclick: it.t ? () => app.openTask(it.t.id) : null }, h('span.tm', it.tm), h('span', it.text))),
      items.length > shown.length ? h('div.small.muted', 'и ещё ' + (items.length - shown.length)) : null));
  }
  if (over.length) root.append(h('div.card.soft', h('p', { style: { margin: 0 } }, 'Плотно: ' + over.map((x) => fmtDay(x, now)).join(', ') + '. Может, что-то перенести на более свободный день?')));
  const weekTasks = st.activeTasks().filter((t) => t.dateKind === 'week' && t.date === ws && !t.waitFor);
  if (weekTasks.length) { root.append(sectionHead('На неделе, без дня')); root.append(h('div.list', weekTasks.map((t) => taskRow(t)))); }
  root.append(h('div.row-btns', h('button.btn', { onclick: async () => { const { openReview } = await import('./review.js'); openReview(); } }, icon('list', 18), 'Недельный обзор')));
}

// ——— Месяц ———
function renderMonth(root, d) {
  const ms = monthStart(d);
  const [y, m] = ms.split('-').map(Number);
  const T = st.T();
  root.append(nav(MONTHS_NOM[m - 1] + ' ' + y, () => setDate(addMonths(ms, -1)), () => setDate(addMonths(ms, 1)), () => setDate(T)));
  // фокусы месяца
  const key = ms.slice(0, 7);
  const focuses = (st.meta('focuses', {})[key] || []);
  root.append(sectionHead('Фокусы месяца', focuses.length < 3 ? h('button.chip.small', { onclick: () => editFocus('focuses', key, null) }, icon('plus', 14), 'Фокус') : null));
  if (focuses.length) root.append(h('div', focuses.map((f) => focusLine('focuses', key, f, ms, monthEnd(ms)))));
  else root.append(h('p.muted.small', { style: { margin: '.2rem .5rem' } }, 'До трёх главных направлений месяца — по желанию.'));
  // сетка
  const cells = [];
  const first = dow(ms);
  for (let i = 1; i < first; i++) cells.push(h('span'));
  const cy = churchYear(y);
  for (let day = 1; day <= daysInMonth(y, m); day++) {
    const ds = mkDate(y, m, day);
    const cd = churchDay(ds);
    const l = st.loadOf(ds);
    const dl = st.activeTasks().some((t) => t.deadline === ds);
    const fast = cd.periods.some((p) => p.kind === 'fast' || p.kind === 'holy');
    cells.push(h('button.m-cell' + (ds === T ? '.today' : '') + (cd.major ? '.feast' : '') + (fast ? '.fast' : ''), {
      onclick: () => setDate(ds, 'day'), 'aria-label': fmtLong(ds),
    }, h('span.n', String(day)), l.min ? h('span.ld.lv-' + l.level) : null, cd.major ? h('span.fl') : null, dl ? h('span.dlm', '⚑') : null));
  }
  root.append(h('div.month-grid', { style: { marginTop: '.5rem' } }, DOW_SHORT.map((x) => h('span.cal-dow', x)), cells));
  // праздники месяца
  const feasts = [];
  for (const [ds, fs] of cy.days) if (ds.startsWith(key)) for (const f of fs) if (f.kind !== 'memorial') feasts.push([ds, f.title]);
  feasts.sort();
  const periods = cy.periods.filter((p) => p.from <= monthEnd(ms) && p.to >= ms);
  if (feasts.length || periods.length) {
    root.append(sectionHead('Церковный календарь'));
    root.append(h('div.card', periods.map((p) => h('div.small.muted', p.title + ': ' + fmtShort(p.from) + '–' + fmtShort(p.to))),
      feasts.map(([ds, t]) => h('div.small', h('span.muted', fmtShort(ds) + ' '), t))));
  }
  // задачи «в этом месяце»
  const mt = st.activeTasks().filter((t) => t.dateKind === 'month' && t.date === ms);
  if (mt.length) {
    root.append(sectionHead('В этом месяце', h('button.chip.small', { onclick: async () => { const { distributeMonth } = await import('./today.js'); distributeMonth(mt.map((t) => t.id)); } }, 'По неделям')));
    root.append(h('div.list', mt.map((t) => taskRow(t))));
  }
  const dls = st.activeTasks().filter((t) => t.deadline && t.deadline.startsWith(key));
  if (dls.length) { root.append(sectionHead('Сроки')); root.append(h('div.list', dls.map((t) => taskRow(t, { showDate: true })))); }
  const ref = st.meta('reflections', {})[key];
  root.append(h('div.row-btns', h('button.btn', { onclick: () => monthReflection(key) }, ref ? 'Итоги месяца' : 'Подвести итоги месяца')));
}

function focusLine(kind, key, f, from, to) {
  const a = st.area(f.areaId);
  const done = f.areaId ? st.doneBetween(from, to).filter((t) => t.areaId === f.areaId) : [];
  const open = openFocus.has(f.id);
  return h('div',
    h('div.focus',
      a ? h('span.dot', { style: { background: a.color } }) : null,
      h('span.grow', f.text, a ? h('div.muted.small', a.name) : null),
      done.length ? h('button.chip.small', { onclick: () => { open ? openFocus.delete(f.id) : openFocus.add(f.id); app.render(); } }, 'сделано: ' + done.length) : null,
      h('button.icon-btn', { 'aria-label': 'Изменить', onclick: () => editFocus(kind, key, f) }, icon('edit', 18))),
    open ? h('div.list', { style: { margin: '.2rem 0 .5rem 1rem' } }, done.slice(0, 50).map((t) => taskRow(t, { noSelect: true, hideArea: true }))) : null);
}
const openFocus = new Set();

async function editFocus(kind, key, f) {
  const all = st.meta(kind, {});
  const list = [...(all[key] || [])];
  const label = kind === 'focuses' ? 'Фокус месяца' : 'Направление года';
  if (f) {
    const v = await choose(label, [{ label: 'Переименовать', value: 'rename' }, { label: 'Привязать к области', value: 'area' }, { label: 'Убрать', value: 'del', danger: true }]);
    if (!v) return;
    if (v === 'del') { st.change(() => st.setMeta(kind, { ...all, [key]: list.filter((x) => x.id !== f.id) })); return; }
    if (v === 'rename') { const t = await prompt(label, f.text, { max: 80 }); if (t) st.change(() => st.setMeta(kind, { ...all, [key]: list.map((x) => x.id === f.id ? { ...x, text: t } : x) })); return; }
    const { pickArea } = await import('./pickers.js');
    const a = await pickArea(f.areaId);
    if (a !== undefined) st.change(() => st.setMeta(kind, { ...all, [key]: list.map((x) => x.id === f.id ? { ...x, areaId: a } : x) }));
    return;
  }
  if (list.length >= 3) { toast('Не больше трёх'); return; }
  const t = await prompt(label, '', { placeholder: kind === 'focuses' ? 'Например: отчёт по гранту' : 'Просто слова, без цифр', max: 80 });
  if (!t) return;
  const { pickArea } = await import('./pickers.js');
  const a = await pickArea(null, { title: 'Привязать к области?' });
  st.change(() => st.setMeta(kind, { ...all, [key]: [...list, { id: st.uid(), text: t, areaId: a || null }] }));
}

/** Конец месяца: что получилось, что продолжить, что отпустить. */
export function monthReflection(key) {
  const refs = st.meta('reflections', {});
  const cur = refs[key] || {};
  const ms = key + '-01';
  const ans = { good: cur.good || '', cont: cur.cont || '', release: cur.release || '' };
  const toRelease = new Set();
  const s = sheet(() => {
    const q = (k, label, ph) => {
      const ta = h('textarea.input', { value: ans[k], maxlength: 2000, placeholder: ph, 'aria-label': label });
      ta.addEventListener('input', () => { ans[k] = ta.value; });
      return h('div.field', h('label', label), ta);
    };
    const T = st.T();
    const cands = st.activeTasks().filter((t) => !t.groupId && !t.waitFor && ((t.dateKind === 'month' && t.date <= ms) || (t.date && t.date < T && t.date >= ms) || (!t.date && t.inbox)));
    return h('div.form',
      q('good', 'Что получилось?', 'Даже маленькое'),
      q('cont', 'Что продолжить?', ''),
      q('release', 'Что отпустить?', 'Можно без слов'),
      cands.length ? h('div', h('div.lbl', 'Отметьте, что отпустить — уйдёт без следов:'),
        cands.map((t) => h('button.line-btn', { role: 'checkbox', 'aria-checked': String(toRelease.has(t.id)), onclick: () => { toRelease.has(t.id) ? toRelease.delete(t.id) : toRelease.add(t.id); s.refresh(); } },
          h('span.check' + (toRelease.has(t.id) ? '.done' : ''), h('span.box', icon('check'))), h('span.grow', isHidden(t) ? '•••' : t.text)))) : null,
      h('div.row-btns', h('button.btn.primary', {
        onclick: () => {
          st.change(() => {
            st.setMeta('reflections', { ...st.meta('reflections', {}), [key]: { good: ans.good, cont: ans.cont, release: '', at: st.clock().toISOString() } });
            for (const id of toRelease) { const t = S.tasks.get(id); if (t) st.put('tasks', { ...t, deletedAt: st.clock().toISOString(), released: true }); }
          });
          s.close();
          toast(toRelease.size ? 'Отпущено. Итоги сохранены.' : 'Итоги сохранены');
        },
      }, 'Сохранить')));
  }, { title: 'Итоги: ' + MONTHS_NOM[Number(key.slice(5, 7)) - 1] });
}

// ——— Год ———
function yearBounds(d) {
  const ys = st.settings().yearStart === 1 ? 1 : 9;
  let y = Number(d.slice(0, 4));
  if (ys === 9 && Number(d.slice(5, 7)) < 9) y--;
  const start = mkDate(y, ys, 1);
  return { start, end: addDays(addMonths(start, 12), -1), key: String(y), label: ys === 9 ? y + '/' + String((y + 1) % 100).padStart(2, '0') : String(y) };
}

function renderYear(root, d) {
  const T = st.T();
  const yb = yearBounds(d);
  root.append(nav(yb.label, () => setDate(addMonths(yb.start, -12)), () => setDate(addMonths(yb.start, 12)), () => setDate(T)));
  const dirs = st.meta('directions', {})[yb.key] || [];
  root.append(sectionHead('Направления года', dirs.length < 3 ? h('button.chip.small', { onclick: () => editFocus('directions', yb.key, null) }, icon('plus', 14), 'Направление') : null));
  if (dirs.length) root.append(h('div', dirs.map((f) => focusLine('directions', yb.key, f, yb.start, yb.end))));
  else root.append(h('p.muted.small', { style: { margin: '.2rem .5rem' } }, 'До трёх — просто слова, без цифр.'));
  for (let i = 0; i < 12; i++) {
    const ms = addMonths(yb.start, i);
    const me = monthEnd(ms);
    const y = Number(ms.slice(0, 4));
    const cy = churchYear(y);
    const key = ms.slice(0, 7);
    const lines = [];
    for (const p of cy.periods) if (p.from <= me && p.to >= ms && p.from >= ms) lines.push(p.title + ' с ' + fmtShort(p.from));
    const fs = [];
    for (const [ds, arr] of cy.days) if (ds.startsWith(key)) for (const f of arr) if (f.kind === 'pascha' || f.kind === 'great12') fs.push([ds, f.title]);
    fs.sort();
    for (const [ds, t] of fs) lines.push(fmtShort(ds) + ' ' + t);
    const dls = st.activeTasks().filter((t) => t.deadline && t.deadline.startsWith(key));
    const mt = st.activeTasks().filter((t) => t.dateKind === 'month' && t.date === ms);
    const foc = st.meta('focuses', {})[key] || [];
    root.append(h('button.year-m' + (T >= ms && T <= me ? '.cur' : ''), { style: { display: 'block', width: '100%', textAlign: 'left' }, onclick: () => setDate(ms, 'month') },
      h('h3', MONTHS_NOM[Number(ms.slice(5, 7)) - 1] + (ms.slice(0, 4) !== yb.start.slice(0, 4) || i === 0 ? ' ' + ms.slice(0, 4) : '')),
      foc.length ? h('div.small', foc.map((f) => f.text).join(' · ')) : null,
      lines.length || dls.length || mt.length ? h('ul', lines.map((l) => h('li', l)), dls.map((t) => h('li', { style: { color: 'var(--text)' } }, '⚑ ' + fmtShort(t.deadline) + ' ' + (isHidden(t) ? '•••' : t.text))), mt.length ? h('li', 'задач на месяц: ' + mt.length) : null) : null));
  }
}

export { yearBounds };
