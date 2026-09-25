// «Сегодня»: минимум на первом экране — три главных, ближайшее, одна строка «ещё N — позже».
import { h, icon, toast, sheet, pickDate, pickTime } from '../ui.js';
import * as st from '../store.js';
import { S } from '../store.js';
import { fmtDay, fmtShort, addDays, diffDays, monthStart, monthEnd, weekStart, toMin, plural, MONTHS_NOM, daysInMonth, dow, hm } from '../dates.js';
import { app, taskRow, emptyState, sectionHead, isHidden, hiddenArea } from './common.js';

const ui = () => st.meta('ui', {});
function dismiss(key, until) {
  st.change(() => st.setMeta('ui', { ...ui(), [key]: until }));
}
const dismissed = (key) => { const u = ui()[key]; return u && u >= st.T(); };

let showLater = false, showDone = false;

export function renderToday(root) {
  const T = st.T();
  const now = st.clock();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // у ассистента — крупный пункт «Записать сессию»
  if ((st.settings().contacts || []).some((c) => c.iRecord)) {
    root.append(h('button.btn.primary.block.big-action', { onclick: async () => { (await import('./session.js')).openRecordForm(); } }, icon('plus', 22), 'Записать сессию'));
  }
  const card = pickCard();
  if (card) root.append(card);

  const all = st.tasksForDay(T);
  let main = all.filter((t) => t.star === T).slice(0, 3);
  const starred = main.length > 0;
  let rest = all.filter((t) => !main.includes(t));
  if (!starred) {
    // без отмеченных главных — показываем три первых по важности
    const pri = (t) => (t.deadline ? 0 : 1) + (t.groupId ? 0 : 1) + (t.time ? 2 : 0) + (t.date < T ? 0 : 1);
    main = [...rest].filter((t) => !t.time).sort((a, b) => pri(a) - pri(b)).slice(0, 3);
    rest = rest.filter((t) => !main.includes(t));
  }
  const upcoming = rest.filter((t) => t.time && toMin(t.time) + (Number(t.dur) || 0) >= nowMin - 15).slice(0, 2);
  const later = rest.filter((t) => !upcoming.includes(t));
  const soonDeadlines = st.deadlines(1).filter((t) => !all.includes(t) && !t.waitFor);
  const blocksNext = st.blocksOn(T).filter((b) => toMin(b.end) > nowMin).slice(0, 1);
  const weekTasks = st.activeTasks().filter((t) => t.dateKind === 'week' && t.date === weekStart(T) && !t.waitFor);

  if (!all.length && !soonDeadlines.length && !card) {
    const doneToday = st.doneOn(T).length;
    root.append(doneToday ? emptyState('На сегодня всё.', 'Сделанное — внизу.', 'check') : emptyState('День свободен.', 'Если что-то придёт в голову — поле ввода внизу.'));
  }

  if (main.length) {
    root.append(sectionHead(starred ? 'Главное' : 'На сегодня'));
    root.append(h('div.list', main.map((t) => taskRow(t))));
  }
  if (upcoming.length || soonDeadlines.length || blocksNext.length) {
    root.append(sectionHead('Ближайшее'));
    const list = h('div.list', upcoming.map((t) => taskRow(t)), soonDeadlines.map((t) => taskRow(t, { showDate: true })));
    root.append(list);
    for (const b of blocksNext) {
      const a = st.area(b.areaId);
      const when = b.cont ? 'до ' + b.end : b.explicit ? b.start + '–' + (b.cut ? 'завтра ' : '') + b.end : b.start;
      root.append(h('div.t-meta', { style: { margin: '.4rem .5rem' } }, h('span.m', icon('clock', 14), when + ' · ' + (b.title || (a ? a.name : 'Блок')))));
    }
  }
  const laterCount = later.length + weekTasks.length;
  if (laterCount) {
    root.append(h('button.more-line', { 'aria-expanded': String(showLater), onclick: () => { showLater = !showLater; app.render(); } },
      icon(showLater ? 'up' : 'down', 18), 'ещё ' + laterCount + ' — позже'));
    if (showLater) {
      if (later.length) root.append(h('div.list', later.map((t) => taskRow(t))));
      if (weekTasks.length) {
        root.append(sectionHead('На этой неделе'));
        root.append(h('div.list', weekTasks.map((t) => taskRow(t))));
      }
    }
  }

  // тихие инструменты
  const tools = [];
  if (st.activeTasks().length) tools.push(h('button.chip.small', { onclick: whatNow }, 'Что сейчас?'));
  const calls = callTasks();
  const callsCtx = st.contexts().find((c) => c.name === 'Звонки') || st.contexts()[0];
  if (calls.length && callsCtx) tools.push(h('button.chip.small', { onclick: () => contextSheet(callsCtx.id) }, icon('phone', 16), callsCtx.name + ' · ' + calls.length));
  if (tools.length) root.append(h('div.chips', { style: { marginTop: '1rem' } }, tools));

  const doneToday = st.doneOn(T);
  if (doneToday.length) {
    root.append(h('button.more-line', { onclick: () => { showDone = !showDone; app.render(); }, style: { marginTop: '.75rem' } },
      icon('check', 18), 'Сделано сегодня: ' + doneToday.length));
    if (showDone) root.append(h('div.list', doneToday.map((t) => taskRow(t, { noSelect: true }))));
  }
}

function callTasks(ctxId) {
  const c = ctxId || (st.contexts().find((x) => x.name === 'Звонки') || {}).id;
  if (!c) return [];
  const T = st.T();
  return st.activeTasks().filter((t) => t.ctx === c && !t.waitFor && (!t.date || t.date <= T) && !(t.groupId && !t.isAnchor && st.nextSteps().get(t.groupId) !== t));
}

export function contextSheet(ctxId) {
  const c = st.contexts().find((x) => x.id === ctxId);
  const s = sheet(() => {
    const T = st.T();
    const list = st.activeTasks().filter((t) => t.ctx === ctxId && !t.waitFor && (!t.date || t.date <= addDays(T, 0)));
    return list.length ? h('div.list', list.map((t) => taskRow(t, { showDate: true }))) : emptyState('Здесь пусто.', null, 'phone');
  }, { title: c ? c.name : 'Контекст' });
  const un = st.subscribe(() => s.refresh());
  const prev = s.onClose; s.onClose = () => { un(); prev && prev(); };
}

// ——— «Что сейчас?» ———
export function whatNow() {
  let time = null, place = 'any', skip = new Set();
  const s = sheet(() => {
    const T = st.T();
    const ns = st.nextSteps();
    const cands = st.activeTasks().filter((t) => !t.waitFor && !t.isAnchor && !isHidden(t) && (!t.date || t.date <= T || (t.dateKind !== 'day' && t.date <= addDays(T, 6)))
      && (!t.groupId || ns.get(t.groupId) === t) && !(t.time && toMin(t.time) > st.clock().getHours() * 60 + 60));
    const fits = cands.filter((t) => {
      const m = st.taskMin(t);
      if (time === 15 && m > 20) return false;
      if (time === 60 && m > 60) return false;
      if (place !== 'any' && t.ctx !== place) return false;
      return true;
    });
    const score = (t) => (t.star === T ? 0 : 10) + (t.deadline ? Math.min(diffDays(T, t.deadline), 9) : 12) + (t.date && t.date <= T ? 0 : 5);
    const pick = fits.filter((t) => !skip.has(t.id)).sort((a, b) => score(a) - score(b))[0];
    return h('div',
      h('div.lbl', 'Сколько есть времени?'),
      h('div.chips', [[15, '15 мин'], [60, '1 час'], [999, 'Больше']].map(([v, l]) => h('button.chip' + (time === v ? '.on' : ''), { onclick: () => { time = v; skip.clear(); s.refresh(); } }, l))),
      h('div.lbl', { style: { marginTop: '.6rem' } }, 'Где я?'),
      h('div.chips.wrap', h('button.chip' + (place === 'any' ? '.on' : ''), { onclick: () => { place = 'any'; skip.clear(); s.refresh(); } }, 'Где угодно'),
        st.contexts().map((c) => h('button.chip' + (place === c.id ? '.on' : ''), { onclick: () => { place = c.id; skip.clear(); s.refresh(); } }, c.name))),
      time ? (pick ? h('div.whatnow',
        h('div.t-text', pick.text),
        h('div.row-btns', { style: { justifyContent: 'center' } },
          h('button.btn.primary', { onclick: () => { s.close(); app.openTask(pick.id); } }, 'Беру'),
          h('button.btn', { onclick: () => { skip.add(pick.id); s.refresh(); } }, 'Другую'))) :
        h('p.muted.whatnow', skip.size ? 'Больше вариантов нет. Можно просто отдохнуть.' : 'Подходящего нет — можно отдохнуть.')) : null,
    );
  }, { title: 'Что сейчас?' });
}

// ——— одна мягкая карточка ———
function pickCard() {
  const T = st.T();
  // 1. вчерашнее невыполненное
  const over = st.overdueList();
  if (over.length && !dismissed('carry')) {
    return h('div.card.soft',
      h('h3', 'С прошлых дней осталось ' + over.length),
      h('p', 'Можно спокойно решить одним касанием.'),
      h('div.chips.wrap',
        h('button.chip.on', { onclick: () => { const r = st.carryAll(over.map((t) => t.id)); dismiss('carry', T); toast('Перенесено на сегодня', { action: 'Отменить', onAction: () => r.undo() }); } }, 'Перенести всё на сегодня'),
        h('button.chip', { onclick: () => sortOut(over.map((t) => t.id)) }, 'Разобрать'),
        h('button.chip', { onclick: () => { const r = st.releaseAll(over.map((t) => t.id)); dismiss('carry', T); toast('Отпущено', { action: 'Отменить', onAction: () => r.undo() }); } }, 'Отпустить')));
  }
  // 2. «Следующий раз?»
  const ask = st.meta('askNext', []).map((id) => S.groups.get(id)).filter(Boolean);
  if (ask.length) {
    const g = ask[0];
    const p = st.person(g.personId);
    if (p) {
      const title = hiddenArea(g.areaId) ? g.templateName + ' · •••' : g.title;
      return h('div.card.calm',
        h('h3', title + ' — всё сделано'),
        h('p', 'Следующий раз?'),
        h('div.chips.wrap',
          g.anchor && g.anchor.time ? h('button.chip.on', { onclick: () => nextCycle(g, addDays(g.anchor.date, 7), g.anchor.time) }, 'Через неделю в то же время') : null,
          h('button.chip', { onclick: async () => { const d = await pickDate({ now: st.clock(), allowWeek: false, allowMonth: false, allowNone: false }); if (!d || !d.date) return; const t = await pickTime({ value: g.anchor && g.anchor.time }); if (t === null) return; nextCycle(g, d.date, t.time); } }, 'Выбрать'),
          h('button.chip', { onclick: () => { st.change(() => { st.put('people', { ...p, status: 'pause' }); st.setMeta('askNext', st.meta('askNext', []).filter((x) => x !== g.id)); }); toast('Пауза'); } }, 'Пауза'),
          h('button.chip', { onclick: () => { st.change(() => { st.put('people', { ...p, status: 'done' }); st.setMeta('askNext', st.meta('askNext', []).filter((x) => x !== g.id)); }); toast('Работа завершена'); } }, 'Завершить работу')));
    }
    st.dismissAskNext(g.id);
  }
  // 3. область с датой окончания
  for (const a of st.areasList()) {
    if (!a.endDate || dismissed('area:' + a.id)) continue;
    const n = diffDays(T, a.endDate);
    if (n <= 14) {
      return h('div.card.soft',
        h('h3', '«' + a.name + '» ' + (n >= 0 ? 'заканчивается ' + fmtDay(a.endDate, st.clock()) : 'закончилась ' + fmtDay(a.endDate, st.clock()))),
        h('p', 'Когда всё будет завершено, область можно убрать в архив — история сохранится.'),
        h('div.chips.wrap',
          h('button.chip.on', { onclick: () => { st.saveArea({ ...a, archived: true, archivedAt: st.clock().toISOString() }); toast('В архиве'); } }, 'Архивировать'),
          h('button.chip', { onclick: () => dismiss('area:' + a.id, addDays(T, 7)) }, 'Позже'),
          h('button.chip', { onclick: async () => { const d = await pickDate({ now: st.clock(), value: a.endDate, title: 'Новая дата окончания', allowWeek: false, allowMonth: false, noneLabel: 'Без даты окончания' }); if (d) st.saveArea({ ...a, endDate: d.date }); } }, 'Продлить')));
    }
  }
  // 4. задачи «в этом месяце» — распределить по неделям
  const ms = monthStart(T);
  const monthTasks = st.activeTasks().filter((t) => t.dateKind === 'month' && t.date <= ms);
  if (monthTasks.length && Number(T.slice(8)) <= 7 && !dismissed('month:' + ms)) {
    return h('div.card.calm',
      h('h3', 'На ' + MONTHS_NOM[Number(ms.slice(5, 7)) - 1] + ': ' + monthTasks.length + ' ' + plural(monthTasks.length, 'задача', 'задачи', 'задач')),
      h('p', 'Разложить по неделям?'),
      h('div.chips.wrap',
        h('button.chip.on', { onclick: () => distributeMonth(monthTasks.map((t) => t.id)) }, 'Распределить'),
        h('button.chip', { onclick: () => dismiss('month:' + ms, monthEnd(T)) }, 'Позже')));
  }
  // 5. конец месяца — три вопроса
  const dim = daysInMonth(Number(T.slice(0, 4)), Number(T.slice(5, 7)));
  const day = Number(T.slice(8));
  const refMonth = day >= dim - 2 ? T.slice(0, 7) : day <= 3 ? addDays(ms, -1).slice(0, 7) : null;
  if (refMonth && !(st.meta('reflections', {})[refMonth]) && !dismissed('reflect:' + refMonth)) {
    return h('div.card.calm',
      h('h3', 'Месяц подходит к концу'),
      h('p', 'Три коротких вопроса: что получилось, что продолжить, что отпустить.'),
      h('div.chips.wrap',
        h('button.chip.on', { onclick: async () => { const { monthReflection } = await import('./plan.js'); monthReflection(refMonth); } }, 'Ответить'),
        h('button.chip', { onclick: () => dismiss('reflect:' + refMonth, addDays(T, 40)) }, 'Не сейчас')));
  }
  // 6. резервная копия
  const last = st.meta('lastExport');
  const first = [...S.tasks.values()].reduce((m, t) => (t.createdAt && t.createdAt < m ? t.createdAt : m), '9999');
  const age = last ? diffDays(last.slice(0, 10), T) : first !== '9999' ? diffDays(first.slice(0, 10), T) : 0;
  if (age > 7 && !dismissed('export')) {
    return h('div.card.soft',
      h('h3', 'Сохранить копию данных?'),
      h('p', last ? 'Последняя копия — ' + fmtDay(last.slice(0, 10), st.clock()) + '.' : 'Копии пока не было.') ,
      h('div.chips.wrap',
        h('button.chip.on', { onclick: async () => { const { exportData } = await import('./settings.js'); exportData(); } }, 'Сохранить копию'),
        h('button.chip', { onclick: () => dismiss('export', addDays(T, 3)) }, 'Позже')));
  }
  return null;
}

function nextCycle(g, date, time) {
  const tplId = g.templateId;
  const r = st.launchTemplate(tplId, { anchor: { date, time, dur: g.anchor ? g.anchor.dur : undefined }, personId: g.personId });
  st.dismissAskNext(g.id);
  if (r) toast('Следующий раз: ' + fmtDay(date, st.clock()) + (time ? ' в ' + time : ''), { action: 'Отменить', onAction: () => r.undo() });
}

/** Разобрать хвосты по одной. */
function sortOut(ids) {
  const T = st.T();
  const s = sheet(() => {
    const list = ids.map((id) => S.tasks.get(id)).filter((t) => t && t.status === 'active' && t.date && t.date < T);
    if (!list.length) { setTimeout(() => { s.close(); dismiss('carry', T); }, 300); return emptyState('Разобрано.', null, 'check'); }
    return h('div.list', list.map((t) => h('div.card', { style: { margin: 0 } },
      h('div.t-text', isHidden(t) ? '•••' : t.text),
      h('div.chips.wrap',
        h('button.chip.small', { onclick: () => st.moveTasks([t.id], T) }, 'Сегодня'),
        h('button.chip.small', { onclick: () => st.moveTasks([t.id], addDays(T, 1)) }, 'Завтра'),
        h('button.chip.small', { onclick: async () => { const d = await pickDate({ now: st.clock() }); if (d) st.moveTasks([t.id], d.date, d.dateKind || 'day'); } }, 'Выбрать'),
        h('button.chip.small', { onclick: () => st.completeTask(t.id) }, '✓ Сделано'),
        !t.groupId ? h('button.chip.small', { onclick: () => st.releaseAll([t.id]) }, 'Отпустить') : null))));
  }, { title: 'Разобрать' });
  const un = st.subscribe(() => s.refresh());
  const prev = s.onClose; s.onClose = () => { un(); prev && prev(); };
}

/** Распределить задачи месяца по неделям. */
export function distributeMonth(ids) {
  const T = st.T();
  const s = sheet(() => {
    const list = ids.map((id) => S.tasks.get(id)).filter((t) => t && t.status === 'active' && t.dateKind === 'month');
    if (!list.length) { setTimeout(() => s.close(), 300); return emptyState('Готово.', null, 'check'); }
    const ms = list[0].date < monthStart(T) ? monthStart(T) : list[0].date;
    const weeks = [];
    let w = weekStart(ms);
    while (w <= monthEnd(ms)) { if (addDays(w, 6) >= T) weeks.push(w); w = addDays(w, 7); }
    return h('div.list', list.map((t) => h('div.card', { style: { margin: 0 } },
      h('div.t-text', isHidden(t) ? '•••' : t.text),
      h('div.chips.wrap',
        weeks.map((wk) => h('button.chip.small', { onclick: () => st.moveTasks([t.id], wk < weekStart(T) ? weekStart(T) : wk, 'week') }, fmtShort(wk < ms ? ms : wk) + '–' + fmtShort(addDays(wk, 6) > monthEnd(ms) ? monthEnd(ms) : addDays(wk, 6)))),
        h('button.chip.small', { onclick: async () => { const d = await pickDate({ now: st.clock() }); if (d) st.moveTasks([t.id], d.date, d.dateKind || 'day'); } }, 'День…')))));
  }, { title: 'Распределить по неделям' });
  const un = st.subscribe(() => s.refresh());
  const prev = s.onClose; s.onClose = () => { un(); prev && prev(); };
}

export { callTasks, hm, dow };
