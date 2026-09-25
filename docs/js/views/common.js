// Общие части интерфейса: строка задачи, закрытие, перенос, скрытие закрытых областей.
import { h, icon, buzz, toast, choose, pickDate, pickTime, swipeable, reducedMotion, quickDays, sheet, clear } from '../ui.js';
import * as st from '../store.js';
import { S } from '../store.js';
import { fmtDay, fmtShort, diffDays, plural, addDays, weekStart, dow, DOW_SHORT } from '../dates.js';
import { dateLabel, partLabel } from '../parse.js';
import { describe as describeRepeat } from '../recur.js';

export const app = {
  screen: 'today', planMode: 'week', planDate: null, areaId: null,
  selection: null, // Set id при множественном выборе
  revealed: new Set(), // раскрытые касанием задачи закрытых областей
  unlocked: new Set(), // области, открытые по PIN/касанию в этой сессии
  render: () => {},
  go: () => {},
  openTask: () => {},
};

// ——— приватность ———
export function hiddenArea(areaId) {
  const a = st.area(areaId);
  return !!(a && a.private && !app.unlocked.has(a.id));
}
export function isHidden(t) {
  return hiddenArea(t.areaId) && !app.revealed.has(t.id);
}
export function personLabel(p, areaIdForPrivacy) {
  if (!p) return '';
  if (hiddenArea(areaIdForPrivacy || p.areaId)) return '•••';
  return p.code;
}
export async function unlockArea(areaId) {
  const a = st.area(areaId);
  if (!a || !a.private) return true;
  if (app.unlocked.has(a.id)) return true;
  if (a.pinLock && st.settings().pinHash) {
    const ok = await askPin('Открыть «' + a.name + '»');
    if (!ok) return false;
  }
  app.unlocked.add(a.id);
  return true;
}
/** Раскрыть одну задачу: для области с PIN — вся область по PIN. */
export async function reveal(t) {
  const a = st.area(t.areaId);
  if (a && a.pinLock && st.settings().pinHash) {
    if (await unlockArea(a.id)) app.render();
    return;
  }
  app.revealed.add(t.id);
  app.render();
}
export function askPin(title) {
  return new Promise((resolve) => {
    let pin = '', done = false, err = false;
    const s = sheet(() => {
      const dots = h('div.pin-dots', [0, 1, 2, 3].map((i) => h('i' + (i < pin.length ? '.on' : ''))));
      const press = async (d) => {
        if (d === '⌫') pin = pin.slice(0, -1);
        else if (pin.length < 4) pin += d;
        err = false;
        s.refresh();
        if (pin.length === 4) {
          if (await st.checkPin(pin)) { done = true; s.close(); resolve(true); }
          else { err = true; pin = ''; buzz(60); s.refresh(); }
        }
      };
      return h('div',
        h('p.muted', { style: { textAlign: 'center' } }, err ? 'Неверный PIN' : 'Введите PIN'),
        dots,
        h('div.pinpad', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d) => d ? h('button', { onclick: () => press(d), 'aria-label': d === '⌫' ? 'Стереть' : d }, d) : h('span'))));
    }, { title, onClose: () => { if (!done) resolve(false); } });
  });
}

export function taskTitle(t) {
  if (isHidden(t)) return null;
  if (st.isProject(t) && t.status === 'active') {
    const n = st.nextItem(t);
    if (n) return n.text;
  }
  return t.text;
}

export function areaDot(areaId) {
  const a = st.area(areaId);
  return a ? h('span.dot', { style: { background: a.color }, title: a.name }) : null;
}

// ——— строка задачи ———
export function taskRow(t, opts = {}) {
  const hidden = isHidden(t);
  const done = t.status === 'done';
  const p = st.person(t.personId);
  const g = t.groupId ? S.groups.get(t.groupId) : null;
  const meta = [];
  const now = st.clock();
  const T = st.T();
  if (opts.showDate && t.date) meta.push(h('span.m', dateLabel(t.date, t.dateKind, now)));
  if (!opts.hideTime && !t.time && t.part) meta.push(h('span.m', partLabel(t.part)));
  if (t.date && t.dateKind === 'day' && t.date < T && !done && !opts.showDate) meta.push(h('span.m', 'с ' + fmtDay(t.date, now)));
  const a = st.area(t.areaId);
  if (a && !opts.hideArea) meta.push(h('span.m', areaDot(a.id), a.name));
  if (g && !opts.hideGroup) meta.push(h('span.m', icon('chain', 14), hidden ? '•••' : g.title));
  else if (p) meta.push(h('span.m', icon('person', 14), personLabel(p, t.areaId)));
  if (st.isProject(t) && !hidden) {
    const total = t.checklist.length, dn = t.checklist.filter((c) => c.done).length;
    meta.push(h('span.m', t.text));
    meta.push(h('div.progress', { style: { width: '5rem' }, role: 'img', 'aria-label': 'сделано шагов: ' + dn }, h('i', { style: { width: (dn / total) * 100 + '%' } })));
  } else if (t.checklist && t.checklist.length && !hidden) {
    meta.push(h('span.m', icon('list', 14), t.checklist.filter((c) => c.done).length + ' из ' + t.checklist.length));
  }
  if (t.deadline && !done) meta.push(h('span.m', icon('flag', 14), deadlineLabel(t.deadline) + (t.deadlineTime ? ', до ' + t.deadlineTime : '')));
  if (t.repeat) meta.push(h('span.m', icon('repeat', 14)));
  if (t.from && t.from.name) meta.push(h('span.m', 'от ' + t.from.name));
  if (t.waitFor) meta.push(h('span.m', 'жду: ' + t.waitFor));
  if (done && opts.showDone && t.doneAt) meta.push(h('span.m', fmtDay(t.doneAt.slice(0, 10), now)));

  const title = hidden ? h('span.t-text.masked', '•••') : h('span.t-text', taskTitle(t));
  const check = h('button.check' + (done ? '.done' : ''), {
    'aria-label': done ? 'Вернуть' : 'Готово',
    onclick: (e) => { e.stopPropagation(); if (done) undone(t); else complete(t, row); },
  }, h('span.box', icon('check')));
  // «Скрыть»: пришедшую не туда задачу — одним касанием в закрытую область
  const hideBtn = opts.hideIncoming && t.from && !done && !st.isPrivate(t) && st.privateAreas().length
    ? h('button.chip.small.hide-btn', { 'aria-label': 'Скрыть', onclick: (e) => { e.stopPropagation(); hideIncoming(t); } }, icon('lock', 14), 'Скрыть') : null;
  const inner = h('div.row-inner',
    check,
    h('div.t-main', t.star && !done && !opts.hideStar ? h('span.star-mark', '★ ') : null, title, meta.length ? h('div.t-meta', meta) : null),
    t.time && !opts.hideTime ? h('span.t-time', t.time) : null,
    hideBtn);
  const row = h('div.row' + (done ? '.is-done' : '') + (t.isAnchor ? '.anchor' : '') + (app.selection && app.selection.has(t.id) ? '.selected' : ''), { dataset: { id: t.id } }, inner);
  swipeable(row, {
    onRight: done || opts.noSwipe ? null : () => complete(t, row),
    onLeft: done || opts.noSwipe ? null : () => reschedule([t.id]),
    onLong: opts.noSelect ? null : () => toggleSelect(t.id),
    onTap: () => {
      if (app.selection) return toggleSelect(t.id);
      if (hidden) return reveal(t);
      app.openTask(t.id);
    },
  });
  return row;
}

export async function hideIncoming(t) {
  const list = st.privateAreas();
  if (!list.length) { toast('Нет закрытой области'); return; }
  let areaId = list[0].id;
  if (list.length > 1) {
    areaId = await choose('Скрыть в закрытую область', list.map((a) => ({ label: a.name, value: a.id, icon: 'lock' })));
    if (!areaId) return;
  }
  app.revealed.delete(t.id);
  const r = st.hideTask(t.id, areaId);
  toast('Скрыто', { action: 'Отменить', onAction: () => r.undo() });
}

export function deadlineLabel(d) {
  const n = diffDays(st.T(), d);
  if (n === 0) return 'срок сегодня';
  if (n === 1) return 'срок завтра';
  if (n < 0) return 'срок был ' + fmtShort(d);
  return 'осталось ' + n + ' ' + plural(n, 'день', 'дня', 'дней');
}

export function toggleSelect(id) {
  if (!app.selection) app.selection = new Set();
  if (app.selection.has(id)) app.selection.delete(id);
  else app.selection.add(id);
  if (!app.selection.size) app.selection = null;
  app.render();
}

// ——— закрытие ———
export function complete(t, row) {
  const cur = S.tasks.get(t.id);
  if (!cur || cur.status !== 'active') return;
  buzz(14);
  const project = st.isProject(cur) && st.nextItem(cur);
  const go = () => {
    const r = st.completeTask(t.id, { step: !!project });
    if (!r) return;
    const info = r.info;
    let msg = project ? 'Шаг сделан' : 'Сделано';
    if (info.next) msg += ' · следующий ' + fmtDay(info.next.date, st.clock());
    toast(msg, { action: 'Отменить', onAction: () => r.undo() });
    if (info.projectDoneSteps) setTimeout(() => projectFinished(cur), 350);
    if (info.from && !project) setTimeout(() => offerReport(S.tasks.get(t.id)), 400);
    if (info.groupDone) setTimeout(() => app.render(), 50);
  };
  if (row && !reducedMotion()) {
    const chk = row.querySelector('.check');
    if (chk) chk.classList.add('done');
    row.style.height = row.offsetHeight + 'px';
    setTimeout(() => { row.classList.add('gone'); }, 260);
    setTimeout(go, 480);
  } else go();
}
function undone(t) {
  const r = st.uncompleteTask(t.id);
  if (r) toast('Вернул в работу', { action: 'Отменить', onAction: () => r.undo() });
}
async function projectFinished(t) {
  const v = await choose('Все шаги сделаны', [
    { label: 'Закрыть проект', value: 'close', primary: true },
    { label: 'Сохранить как шаблон', value: 'tpl', icon: 'chain' },
    { label: 'Оставить открытым', value: null },
  ]);
  if (v === 'close' || v === 'tpl') {
    if (v === 'tpl') { const { editTemplate } = await import('./areas.js'); editTemplate(st.templateDraftFrom(S.tasks.get(t.id)), true); }
    st.completeTask(t.id);
  }
}

export async function offerReport(t) {
  if (!t || !t.from) return;
  const { reportDone } = await import('./share.js');
  const v = await choose('Сообщить, что сделано?', [
    { label: 'Сообщить ' + (t.from.name || ''), value: true, primary: true, icon: 'send' },
    { label: 'Не нужно', value: false },
  ]);
  if (v) reportDone(t);
}

// ——— перенос ———
export async function reschedule(ids) {
  const now = st.clock();
  const T = st.T();
  const fri = addDays(weekStart(T), 4);
  const opts = [
    { label: 'Сегодня', value: { date: T } },
    { label: 'Завтра', value: { date: addDays(T, 1) } },
  ];
  if (fri > addDays(T, 1)) opts.push({ label: 'Пятница, ' + fmtShort(fri), value: { date: fri } });
  opts.push({ label: 'Следующий понедельник', value: { date: addDays(weekStart(T), 7) } });
  opts.push({ label: 'Выбрать…', value: 'pick' });
  opts.push({ label: 'Когда-нибудь', value: 'someday' });
  let v = await choose(ids.length > 1 ? 'Перенести ' + ids.length : 'Перенести', opts);
  if (!v) return;
  if (v === 'pick') {
    const p = await pickDate({ now });
    if (!p) return;
    if (!p.date) v = { date: null };
    else v = p;
  }
  if (v === 'someday') {
    const r = st.change(() => { for (const id of ids) { const t = S.tasks.get(id); if (t && !t.groupId) st.put('tasks', { ...t, status: 'someday', date: null, dateKind: null, star: null, inbox: false }); } });
    toast('В «Когда-нибудь»', { action: 'Отменить', onAction: () => r.undo() });
    return;
  }
  const r = st.moveTasks(ids, v.date, v.dateKind || 'day');
  toast(v.date ? 'Перенесено: ' + dateLabel(v.date, v.dateKind || 'day', now) : 'Без даты', { action: 'Отменить', onAction: () => r.undo() });
}

export function describeTaskWhen(t) {
  const now = st.clock();
  const parts = [];
  if (t.date) parts.push(dateLabel(t.date, t.dateKind, now));
  if (t.time) parts.push(t.time + (t.dur ? '–' + addMin(t.time, t.dur) : ''));
  else if (t.part) parts.push(partLabel(t.part));
  return parts.join(', ');
}
function addMin(time, m) {
  const [a, b] = time.split(':').map(Number);
  const x = a * 60 + b + m;
  return String(Math.floor(x / 60) % 24).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
}

export function emptyState(big, small, ic = 'sun') {
  const ill = icon(ic, 64);
  ill.classList.add('ill');
  return h('div.empty', ill, h('div.big', big), small ? h('div', small) : null);
}

export function sectionHead(text, right) {
  return h('div.section-h', h('span', text), h('span.grow'), right || null);
}

export { describeRepeat, fmtDay, DOW_SHORT, dow, quickDays, pickDate, pickTime, clear };
