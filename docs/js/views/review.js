// Недельный обзор — 10 минут, пошагово; можно прервать и продолжить.
import { h, icon, sheet, toast, pickDate } from '../ui.js';
import * as st from '../store.js';
import { S } from '../store.js';
import { addDays, weekStart, fmtDay, fmtShort, DOW_SHORT, diffDays, fmtDur, parseYmd } from '../dates.js';
import { churchDay } from '../church.js';
import { app, taskRow, emptyState, sectionHead, isHidden, personLabel, hiddenArea } from './common.js';

const STEPS = [
  'Сделанное за неделю',
  'Входящие',
  'Люди без следующего раза',
  '«Когда-нибудь» и давнее',
  'Сроки и церковные дни',
  'Нагрузка следующей недели',
  'Резервная копия',
];

export function openReview() {
  const T = st.T();
  const ws = weekStart(T);
  let rv = st.meta('review');
  if (!rv || rv.weekOf !== ws || rv.done) rv = { weekOf: ws, step: 0, startedAt: st.clock().toISOString() };
  const save = () => st.change(() => st.setMeta('review', { ...rv }));
  save();
  const s = sheet(() => {
    const body = h('div');
    body.append(h('div.stepper', STEPS.map((_, i) => h('i' + (i <= rv.step ? '.on' : '')))));
    body.append(h('h3', { style: { marginBottom: '.5rem' } }, (rv.step + 1) + '. ' + STEPS[rv.step]));
    body.append(stepBody(rv.step));
    const last = rv.step === STEPS.length - 1;
    body.append(h('div.row-btns',
      rv.step > 0 ? h('button.btn', { onclick: () => { rv.step--; save(); s.refresh(); } }, 'Назад') : null,
      h('button.btn.primary', {
        onclick: () => {
          if (last) { rv.done = true; save(); s.close(); toast('Обзор завершён. Хорошей недели.'); return; }
          rv.step++; save(); s.refresh();
        },
      }, last ? 'Готово' : 'Дальше'),
      h('button.btn.ghost', { onclick: () => { save(); s.close(); toast('Обзор можно продолжить позже'); } }, 'Прервать')));
    return body;
  }, { title: 'Недельный обзор', full: true });
  const un = st.subscribe(() => { if (!s.el.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') s.refresh(); });
  const prev = s.onClose; s.onClose = () => { un(); prev && prev(); };
}

function stepBody(i) {
  const T = st.T();
  const now = st.clock();
  const box = h('div');
  if (i === 0) {
    const done = st.doneBetween(addDays(T, -7), T);
    box.append(h('p.muted', done.length ? 'За семь дней сделано: ' + done.length + '. Это немало.' : 'Неделя была тихой. Так тоже бывает.'));
    box.append(h('div.list', done.slice(0, 60).map((t) => taskRow(t, { noSelect: true, showDone: true }))));
  } else if (i === 1) {
    const list = st.inboxList();
    if (!list.length) box.append(emptyState('Входящие пусты.', null, 'inbox'));
    else {
      box.append(h('div.row-btns', { style: { marginTop: 0 } }, h('button.btn.primary', { onclick: async () => { const { openMatrix } = await import('./matrix.js'); openMatrix(list.map((t) => t.id)); } }, icon('grid', 18), 'Разобрать по квадратам')));
      box.append(h('div.list', { style: { marginTop: '.5rem' } }, list.map((t) => taskRow(t))));
    }
  } else if (i === 2) {
    const people = [...S.people.values()].filter((p) => p.status === 'active' && !p.schedule && !hasNext(p.id));
    if (!people.length) box.append(emptyState('У всех есть следующий раз.', null, 'person'));
    for (const p of people) {
      box.append(h('div.card', { style: { margin: '.35rem 0' } },
        h('b', personLabel(p)), h('div.muted.small', (st.area(p.areaId) || {}).name || ''),
        h('div.chips.wrap',
          h('button.chip.small.on', { onclick: async () => { const { launchSheet } = await import('./areas.js'); launchSheet(p.templateId || null, p.id); } }, 'Запланировать'),
          h('button.chip.small', { onclick: () => st.savePerson({ ...p, status: 'pause' }) }, 'Пауза'),
          h('button.chip.small', { onclick: () => st.savePerson({ ...p, status: 'done' }) }, 'Завершить'))));
    }
  } else if (i === 3) {
    const old = st.activeTasks().filter((t) => !t.date && !t.deadline && !t.groupId && !t.waitFor && diffDays((t.createdAt || '').slice(0, 10) || T, T) > 14);
    const some = st.somedayList();
    const list = [...old, ...some];
    if (!list.length) box.append(emptyState('Ничего не залежалось.', null, 'check'));
    box.append(h('p.muted.small', 'Что-то взять на эту неделю, что-то оставить, что-то отпустить.'));
    for (const t of list) {
      box.append(h('div.card', { style: { margin: '.35rem 0' } },
        h('div.t-text', isHidden(t) ? '•••' : t.text),
        h('div.chips.wrap',
          h('button.chip.small', { onclick: () => st.moveTasks([t.id], weekStart(T), 'week') }, 'На эту неделю'),
          h('button.chip.small', { onclick: async () => { const d = await pickDate({ now }); if (d) st.moveTasks([t.id], d.date, d.dateKind || 'day'); } }, 'Выбрать день'),
          t.status !== 'someday' ? h('button.chip.small', { onclick: () => st.change(() => st.put('tasks', { ...t, status: 'someday', inbox: false })) }, 'Когда-нибудь') : h('button.chip.small', { onclick: () => st.change(() => st.put('tasks', { ...t, touchedAt: now.toISOString() })) }, 'Оставить'),
          h('button.chip.small', { onclick: () => st.deleteTask(t.id) }, 'Отпустить'))));
    }
  } else if (i === 4) {
    const dls = st.deadlines(14);
    box.append(sectionHead('Сроки на две недели'));
    if (dls.length) box.append(h('div.list', dls.map((t) => taskRow(t, { showDate: true }))));
    else box.append(h('p.muted.small', 'Жёстких сроков нет.'));
    box.append(sectionHead('Церковные дни'));
    const days = [];
    for (let k = 0; k < 14; k++) {
      const d = addDays(T, k);
      const cd = churchDay(d);
      for (const f of cd.feasts) if (f.kind !== 'memorial' || /родительск/i.test(f.title)) days.push([d, f.title]);
      const sp = st.meta('specialDays', []).filter((x) => x.date === d || (x.yearly && x.date.slice(5) === d.slice(5)));
      for (const x of sp) days.push([d, x.title]);
    }
    if (days.length) box.append(h('div.card', days.map(([d, t]) => h('div.small', h('span.muted', DOW_SHORT[parseYmd(d).getDay() === 0 ? 6 : parseYmd(d).getDay() - 1] + ' ' + fmtShort(d) + ' '), t))));
    else box.append(h('p.muted.small', 'Больших праздников нет.'));
  } else if (i === 5) {
    const ns = addDays(weekStart(T), 7);
    for (let k = 0; k < 7; k++) {
      const d = addDays(ns, k);
      const l = st.loadOf(d);
      box.append(h('button.week-day', { style: { display: 'block', width: '100%', textAlign: 'left' }, onclick: () => { app.planDate = d; app.planMode = 'day'; app.go('plan'); } },
        h('div.wd-head', h('b', DOW_SHORT[k] + ', ' + fmtShort(d)), h('span.grow'), h('span.small.muted', fmtDur(l.min) || '—')),
        h('div.load', h('i.lv-' + l.level, { style: { width: Math.min(100, l.ratio * 100) + '%' } }))));
    }
    box.append(h('p.muted.small', 'Зелёный — спокойно, жёлтый — плотно, терракотовый — перегруз.'));
  } else if (i === 6) {
    const last = st.meta('lastExport');
    box.append(h('p.muted', last ? 'Последняя копия: ' + fmtDay(last.slice(0, 10), now) + '.' : 'Копии ещё не было.'));
    box.append(h('button.btn.primary.block', { onclick: async () => { const { exportData } = await import('./settings.js'); await exportData(); } }, icon('download', 18), 'Сохранить копию'));
    box.append(h('p.muted.small', 'Файл можно сохранить в облако или отправить себе в мессенджер.'));
  }
  return box;
}

function hasNext(personId) {
  const T = st.T();
  return [...S.groups.values()].some((g) => g.personId === personId && g.status === 'active' && (!g.anchor || g.anchor.date >= T));
}

export { STEPS, hiddenArea };
