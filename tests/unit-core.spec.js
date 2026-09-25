// Повторы, пасхалия, движок цепочек, коды обмена, .ics.
import { test, expect } from '@playwright/test';
import { nextDate, firstOccurrence } from '../docs/js/recur.js';
import { orthodoxEaster, churchDay, churchYear, churchReduction } from '../docs/js/church.js';
import { instantiate, reanchor, stepApplies, suggestOffsets, computeStep } from '../docs/js/chain.js';
import { encodeTask, encodeDone, decode, findCode, sanitizeShared, linkFor, humanText } from '../docs/js/share.js';
import { buildIcs } from '../docs/js/ics.js';
import { seedTemplates, seedAreas } from '../docs/js/seed.js';
import { migrateSnapshot, validateImport, SCHEMA } from '../docs/js/db.js';

test.describe('повторы', () => {
  test('каждый день: следующий — завтра, просроченный — после сегодня', () => {
    expect(nextDate({ kind: 'daily' }, '2026-09-24', '2026-09-24')).toBe('2026-09-25');
    expect(nextDate({ kind: 'daily' }, '2026-09-20', '2026-09-24')).toBe('2026-09-25');
  });
  test('по дням недели', () => {
    const r = { kind: 'weekly', days: [1, 4] };
    expect(nextDate(r, '2026-09-24', '2026-09-24')).toBe('2026-09-28'); // чт → пн
    expect(nextDate(r, '2026-09-28', '2026-09-28')).toBe('2026-10-01'); // пн → чт
    expect(firstOccurrence(r, '2026-09-25')).toBe('2026-09-28');
  });
  test('раз в N дней — от плановой даты', () => {
    expect(nextDate({ kind: 'interval', n: 3 }, '2026-09-24', '2026-09-24')).toBe('2026-09-27');
    expect(nextDate({ kind: 'interval', n: 3 }, '2026-09-24', '2026-09-28')).toBe('2026-09-30');
  });
  test('ежемесячно: число и последний день', () => {
    expect(nextDate({ kind: 'monthly', day: 5 }, '2026-09-05', '2026-09-07')).toBe('2026-10-05');
    expect(nextDate({ kind: 'monthly', day: 31 }, '2026-10-31', '2026-10-31')).toBe('2026-11-30');
    expect(nextDate({ kind: 'monthly', day: 'last' }, '2027-01-31', '2027-01-31')).toBe('2027-02-28');
    expect(nextDate({ kind: 'monthly', day: 'last' }, '2028-01-31', '2028-01-31')).toBe('2028-02-29');
  });
  test('ежегодно', () => {
    expect(nextDate({ kind: 'yearly', month: 7, day: 12 }, '2026-07-12', '2026-07-12')).toBe('2027-07-12');
    expect(nextDate({ kind: 'yearly', month: 2, day: 29 }, '2028-02-29', '2028-02-29')).toBe('2029-02-28');
  });
  test('через N дней после выполнения', () => {
    expect(nextDate({ kind: 'after', n: 30 }, '2026-09-01', '2026-09-24')).toBe('2026-10-24');
  });
  test('задачу закрыли заранее — следующий после плановой даты', () => {
    expect(nextDate({ kind: 'weekly', days: [5] }, '2026-09-25', '2026-09-23')).toBe('2026-10-02');
  });
});

test.describe('пасхалия', () => {
  const known = { 2025: '2025-04-20', 2026: '2026-04-12', 2027: '2027-05-02', 2028: '2028-04-16', 2029: '2029-04-08' };
  for (const [y, d] of Object.entries(known)) {
    test('Пасха ' + y, () => expect(orthodoxEaster(Number(y))).toBe(d));
  }
  test('переходящие праздники 2026', () => {
    const cy = churchYear(2026);
    const find = (t) => [...cy.days].find(([, fs]) => fs.some((f) => f.title.includes(t)))[0];
    expect(find('Вход Господень')).toBe('2026-04-05');
    expect(find('Вознесение')).toBe('2026-05-21');
    expect(find('Троицы')).toBe('2026-05-31');
    expect(find('Радоница')).toBe('2026-04-21');
  });
  test('посты и Страстная 2027', () => {
    const cy = churchYear(2027);
    const p = (t) => cy.periods.find((x) => x.title === t);
    expect(p('Великий пост').from).toBe('2027-03-15');
    expect(p('Страстная седмица').from).toBe('2027-04-26');
    expect(p('Страстная седмица').to).toBe('2027-05-01');
    expect(p('Петров пост').from).toBe('2027-06-28');
    expect(p('Успенский пост').from).toBe('2027-08-14');
  });
  test('двунадесятые и великие неподвижные', () => {
    expect(churchDay('2026-01-07').major).toBe(true);
    expect(churchDay('2026-09-27').feasts[0].title).toContain('Воздвижение');
    expect(churchDay('2026-10-14').feasts[0].title).toContain('Покров');
    expect(churchDay('2026-09-26').eveOf[0].title).toContain('Воздвижение');
  });
  test('праздник и канун уменьшают ёмкость', () => {
    const cfg = { enabled: true, feast: 3, eve: 2, holy: 3 };
    expect(churchReduction('2026-09-27', cfg)).toBe(3);
    expect(churchReduction('2026-09-26', cfg)).toBe(2);
    expect(churchReduction('2026-04-08', cfg)).toBe(3); // Страстная среда
    expect(churchReduction('2026-09-24', cfg)).toBe(0);
    expect(churchReduction('2026-09-24', cfg, [{ date: '2025-09-24', yearly: true, hours: 4 }])).toBe(4);
    expect(churchReduction('2026-09-27', { ...cfg, enabled: false })).toBe(0);
  });
});

test.describe('цепочки', () => {
  const areas = seedAreas();
  const ses = seedTemplates(areas).find((t) => t.name === 'Сессия');
  let n = 0;
  const uid = () => 'id' + ++n;
  const run = (person, cycle, anchor) => instantiate(ses, { anchor, person, cycle, uid });
  const byText = (tasks, t) => tasks.find((x) => x.text.startsWith(t));

  test('«Сессия» для двух клиентов — раздельные цепочки с верными датами', () => {
    const a = run({ id: 'A', code: 'А.К.', areaId: 'c' }, 7, { date: '2026-10-01', time: '18:00' });
    const b = run({ id: 'B', code: 'М.С.', areaId: 'c' }, 2, { date: '2026-10-02', time: '11:00' });
    expect(a.group.id).not.toBe(b.group.id);
    expect(a.group.title).toBe('Сессия · А.К. · №7');
    expect(b.group.title).toBe('Сессия · М.С. · №2');
    expect(a.tasks.every((t) => t.groupId === a.group.id && t.personId === 'A')).toBe(true);
    expect(b.tasks.every((t) => t.groupId === b.group.id && t.personId === 'B')).toBe(true);
    expect(byText(a.tasks, 'Перечитать').date).toBe('2026-09-30');
    const rec = byText(a.tasks, 'Проверить диктофон');
    expect([rec.date, rec.time]).toEqual(['2026-10-01', '17:45']);
    const anchor = a.tasks.find((t) => t.isAnchor);
    expect([anchor.date, anchor.time, anchor.dur]).toEqual(['2026-10-01', '18:00', 60]);
    expect(byText(a.tasks, 'Транскрибировать').date).toBe('2026-10-01');
    expect(byText(b.tasks, 'Перечитать').date).toBe('2026-10-01');
    expect(byText(b.tasks, 'Проверить диктофон').time).toBe('10:45');
    // порядок: подготовка → якорь → после
    const order = a.tasks.map((t) => (t.isAnchor ? 'ЯКОРЬ' : t.text.split(' ')[0]));
    expect(order.indexOf('Перечитать')).toBeLessThan(order.indexOf('ЯКОРЬ'));
    expect(order.indexOf('Транскрибировать')).toBeGreaterThan(order.indexOf('ЯКОРЬ'));
  });
  test('«каждую 3-ю» — на 3-й и 6-й, «только первый раз» — только на первой', () => {
    const has = (cycle, t) => !!byText(run({ id: 'A', code: 'А.К.' }, cycle, { date: '2026-10-01', time: '18:00' }).tasks, t);
    const upd = [1, 2, 3, 4, 5, 6, 7, 9].map((c) => has(c, 'Обновить карточку'));
    expect(upd).toEqual([false, false, true, false, false, true, false, true]);
    const tests = [1, 2, 3].map((c) => has(c, 'Отправить тесты'));
    expect(tests).toEqual([true, false, false]);
    expect(stepApplies({ kind: 'nth', n: 3 }, 0)).toBe(false);
  });
  test('перенос якоря сдвигает невыполненные шаги, выполненные не трогает', () => {
    const a = run({ id: 'A', code: 'А.К.' }, 4, { date: '2026-10-01', time: '18:00' });
    const tasks = a.tasks.map((t) => ({ ...t, status: t.text.startsWith('Перечитать') ? 'done' : 'active' }));
    const ch = reanchor(a.group, tasks, { date: '2026-10-05', time: '12:00', dur: 60 });
    const get = (t) => ch.find((x) => x.text.startsWith(t));
    expect(get('Перечитать')).toBeUndefined();
    expect([get('Проверить').date, get('Проверить').time]).toEqual(['2026-10-05', '11:45']);
    expect(get('Транскрибировать').date).toBe('2026-10-05');
    const anc = ch.find((x) => x.isAnchor);
    expect([anc.date, anc.time]).toEqual(['2026-10-05', '12:00']);
  });
  test('шаги до даты запуска ставятся на день запуска', () => {
    const r = instantiate(ses, { anchor: { date: '2026-09-24', time: '18:00' }, person: { id: 'A', code: 'А.К.' }, cycle: 1, uid, today: '2026-09-24' });
    expect(r.tasks.every((t) => t.date >= '2026-09-24')).toBe(true);
  });
  test('шаблон без якоря — шаги от даты запуска', () => {
    const tpl = { id: 't', name: 'Проект', steps: [{ text: 'А', offset: { kind: 'after_days', n: 0 } }, { text: 'Б', offset: { kind: 'after_days', n: 3 } }] };
    const r = instantiate(tpl, { start: '2026-09-24', uid });
    expect(r.tasks.map((t) => t.date)).toEqual(['2026-09-24', '2026-09-27']);
    expect(r.tasks.some((t) => t.isAnchor)).toBe(false);
  });
  test('предложение смещений по фактическим датам', () => {
    const s = suggestOffsets([
      { text: 'план', date: '2026-09-20' }, { text: 'тезисы', date: '2026-09-25' }, { text: 'выступить', date: '2026-09-27' }, { text: 'заметки', date: '2026-09-28' },
    ], { date: '2026-09-27' });
    expect(s.map((x) => x.offset)).toEqual([{ kind: 'before_days', n: 7 }, { kind: 'before_days', n: 2 }, { kind: 'same_day', n: 0 }, { kind: 'after_days', n: 1 }]);
  });
  test('computeStep: сразу после — время окончания якоря', () => {
    expect(computeStep({ kind: 'after' }, { date: '2026-10-01', time: '18:00', dur: 90 }, '2026-10-01')).toEqual({ date: '2026-10-01', time: '19:30' });
  });
});

test.describe('обмен задачами', () => {
  const task = { id: 'abc123', text: 'Купить хлеб и молоко', date: '2026-09-25', dateKind: 'day', time: '18:00', note: 'в «Пятёрочке»', checklist: [{ text: 'хлеб', done: false }, { text: 'молоко', done: true }] };
  test('код туда и обратно, данные только во фрагменте', () => {
    const code = encodeTask(task, 'Иоанн');
    const url = linkFor(code, 'https://example.org/planner/', 't');
    expect(url.startsWith('https://example.org/planner/#t=v1.')).toBe(true);
    expect(url.split('#')[0]).toBe('https://example.org/planner/');
    const back = decode(findCode(url));
    expect(back).toMatchObject({ kind: 'task', id: 'abc123', from: 'Иоанн', text: task.text, date: '2026-09-25', time: '18:00', note: task.note, checklist: ['хлеб'] });
  });
  test('человеческий текст с датой и временем', () => {
    const t = humanText(task, 'Иоанн', new Date(2026, 8, 24, 10));
    expect(t).toContain('Купить хлеб и молоко');
    expect(t).toContain('завтра');
    expect(t).toContain('18:00');
  });
  test('отметка о выполнении', () => {
    const d = decode(encodeDone({ id: 'x1', srcId: 'abc123', text: 'Сделано' }, 'Мария'));
    expect(d).toMatchObject({ kind: 'done', id: 'abc123', from: 'Мария' });
  });
  test('проверка и ограничение входящих данных', () => {
    expect(decode('v1.@@@')).toBe(null);
    expect(decode('v1.' + 'A'.repeat(20000))).toBe(null);
    expect(sanitizeShared({ id: 'x', text: '' })).toBe(null);
    const s = sanitizeShared({ id: 'x<script>', text: 'a'.repeat(5000), date: 'nope', time: '25:99', dur: -5, checklist: Array(100).fill('шаг'), note: '<img src=x onerror=alert(1)>' });
    expect(s.id).toBe('xscript');
    expect(s.text.length).toBe(500);
    expect(s.date).toBe(null);
    expect(s.time).toBe(null);
    expect(s.dur).toBe(null);
    expect(s.checklist.length).toBe(40);
    expect(s.note).toBe('<img src=x onerror=alert(1)>'); // хранится как текст, выводится только через textContent
  });
});

test.describe('календарь .ics', () => {
  test('время: напоминание за 15 минут', () => {
    const ics = buildIcs({ id: 't1', text: 'Встреча с деканом', date: '2026-10-01', time: '18:00', dur: 60 }, { now: new Date(2026, 8, 24) });
    expect(ics).toContain('SUMMARY:Встреча с деканом');
    expect(ics).toContain('TRIGGER:-PT15M');
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
  });
  test('срок: за 1 день и за 2 часа', () => {
    const ics = buildIcs({ id: 't2', text: 'Отчёт', deadline: '2026-10-15' }, { kind: 'deadline' });
    expect(ics).toContain('TRIGGER:-P1D');
    expect(ics).toContain('TRIGGER:-PT2H');
  });
  test('закрытая область — только нейтральный текст', () => {
    const ics = buildIcs({ id: 't3', text: 'Сессия с А.К.', note: 'телефон клиента', date: '2026-10-01', time: '18:00' }, { private: true });
    expect(ics).toContain('SUMMARY:Встреча');
    expect(ics).not.toContain('А.К.');
    expect(ics).not.toContain('телефон');
  });
});

test.describe('миграции данных', () => {
  test('версия 1 → текущая без потерь', () => {
    const v1 = { app: 'planner', schema: 1, exportedAt: '2026-01-01T00:00:00Z', data: {
      areas: [{ id: 'a1', name: 'Семья', color: '#123456' }],
      tasks: [{ id: 't1', title: 'Купить подарок', done: false, due: '2026-02-01', area: 'Семья', notes: 'красный' }, { id: 't2', title: 'Старое', done: true }],
    } };
    const s = migrateSnapshot(v1);
    expect(s.schema).toBe(SCHEMA);
    const t1 = s.data.tasks.find((t) => t.id === 't1');
    expect(t1).toMatchObject({ text: 'Купить подарок', status: 'active', date: '2026-02-01', areaId: 'a1', note: 'красный' });
    expect(s.data.tasks.find((t) => t.id === 't2').status).toBe('done');
    expect(s.data.areas[0]).toMatchObject({ name: 'Семья', archived: false, private: false });
  });
  test('импорт проверяет файл', () => {
    expect(validateImport('не json').ok).toBe(false);
    expect(validateImport(JSON.stringify({ app: 'other' })).ok).toBe(false);
    expect(validateImport(JSON.stringify({ app: 'planner', schema: 99, data: {} })).ok).toBe(false);
    const ok = validateImport(JSON.stringify({ app: 'planner', schema: SCHEMA, data: { tasks: [{ id: 'a', text: 'x', status: 'active' }, { bad: true }], areas: [], people: [], templates: [], groups: [], meta: {} } }));
    expect(ok.ok).toBe(true);
    expect(ok.summary.tasks).toBe(1);
  });
});

import { segmentsOn, blockRange, describeBlock } from '../docs/js/blocks.js';
import { encodeSession, encodeSetup } from '../docs/js/share.js';

test.describe('постоянные блоки', () => {
  test('многодневный блок «пн 16:00 → вт 16:00» даёт часть каждому дню', () => {
    const b = { id: 'd', dow: 1, start: '16:00', endDow: 2, end: '16:00' };
    expect(segmentsOn([b], 1).map((x) => [x.start, x.end, x.min, x.cut])).toEqual([['16:00', '24:00', 480, true]]);
    expect(segmentsOn([b], 2).map((x) => [x.start, x.end, x.min, x.cont])).toEqual([['00:00', '16:00', 960, true]]);
    expect(segmentsOn([b], 3)).toEqual([]);
    expect(describeBlock(b)).toBe('пн 16:00 → вт 16:00');
  });
  test('блок через конец недели: вс 20:00 → пн 08:00', () => {
    const b = { id: 'w', dow: 7, start: '20:00', endDow: 1, end: '08:00' };
    expect(segmentsOn([b], 7)[0].min).toBe(240);
    expect(segmentsOn([b], 1)[0]).toMatchObject({ start: '00:00', end: '08:00', min: 480 });
  });
  test('без окончания — длительность по умолчанию, остаток дня свободен', () => {
    const b = { id: 'n', dow: 3, start: '10:00' };
    expect(blockRange(b, 60).e - blockRange(b, 60).s).toBe(60);
    expect(segmentsOn([b], 3, () => 90)[0]).toMatchObject({ start: '10:00', end: '11:30', min: 90, explicit: false });
  });
  test('старый формат (конец в тот же день) работает как раньше', () => {
    expect(segmentsOn([{ id: 'o', dow: 4, start: '07:30', end: '10:00' }], 4)[0].min).toBe(150);
  });
});

test.describe('запись сессии: код обмена', () => {
  test('клиент, начало и необязательное окончание', () => {
    const code = encodeSession({ id: 's1', client: 'А.К.', start: { date: '2026-09-28', time: '18:00' }, end: { date: '2026-09-28', time: '19:00' } }, 'Мария');
    expect(decode(code)).toMatchObject({ kind: 'session', id: 's1', from: 'Мария', client: 'А.К.', start: { date: '2026-09-28', time: '18:00' }, end: { date: '2026-09-28', time: '19:00' } });
    const only = decode(encodeSession({ id: 's2', client: 'Б.', start: { date: '2026-09-28', time: null } }, 'Мария'));
    expect(only.end).toBe(null);
    expect(decode(encodeSetup('x1', 'Иоанн'))).toMatchObject({ kind: 'setup', recordSessions: true, from: 'Иоанн' });
  });
});
