// Файл .ics для календаря телефона: одно событие с напоминаниями.
import { dateTime, addDays } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');
function utc(d) {
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00Z';
}
function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
/** Перенос строк по RFC 5545: не длиннее 75 байт UTF-8, продолжение — с пробела; символы не режем. */
const enc = new TextEncoder();
function fold(line) {
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // у строк-продолжений первый байт — пробел
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.map((x, i) => (i ? ' ' + x : x)).join('\r\n');
}

/**
 * task: {id, text, date, time, dur, deadline}; opts: {private, kind:'time'|'deadline', now}
 * Для закрытой области уходит только нейтральный текст «Встреча».
 */
export function buildIcs(task, opts = {}) {
  const now = opts.now || new Date();
  const priv = !!opts.private;
  const kind = opts.kind || (task.time ? 'time' : 'deadline');
  const summary = priv ? 'Встреча' : opts.summary || (kind === 'deadline' ? 'Срок: ' : '') + task.text;
  let start, end, alarms;
  let allDay = null;
  if (kind === 'day') {
    // задача на день без времени — событие на весь день
    allDay = { from: task.date.replace(/-/g, ''), to: addDays(task.date, 1).replace(/-/g, '') };
    alarms = [];
  } else if (kind === 'time') {
    // время — начало. Задача-точка (без окончания) уходит в календарь на 30 минут:
    // календари на Android без DTEND событие не импортируют или показывают криво.
    start = dateTime(task.date, task.time);
    end = new Date(start.getTime() + (Number(task.dur) || 30) * 60000);
    alarms = ['-PT15M'];
  } else {
    const d = task.deadline || task.date;
    start = dateTime(d, task.deadlineTime || task.time || '18:00');
    end = new Date(start.getTime() + 30 * 60000);
    alarms = ['-P1D', '-PT2H'];
  }
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//planner//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + esc(task.id) + '-' + kind + '@planner',
    'DTSTAMP:' + utc(now),
    ...(allDay ? ['DTSTART;VALUE=DATE:' + allDay.from, 'DTEND;VALUE=DATE:' + allDay.to]
      : ['DTSTART:' + utc(start), 'DTEND:' + utc(end)]),
    'SUMMARY:' + esc(summary),
  ];
  if (!priv && task.note) lines.push('DESCRIPTION:' + esc(task.note.slice(0, 1000)));
  for (const a of alarms) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(summary), 'TRIGGER:' + a, 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Проверка файла перед отдачей: возвращает список проблем (пустой — файл корректен). */
export function checkIcs(text) {
  const issues = [];
  if (typeof text !== 'string' || !text) return ['файл пустой'];
  if (/\r(?!\n)|(?<!\r)\n/.test(text)) issues.push('переводы строк не CRLF');
  if (!text.endsWith('\r\n')) issues.push('нет CRLF в конце');
  const lines = text.replace(/\r\n$/, '').split('\r\n');
  if (lines.some((l) => enc.encode(l).length > 75)) issues.push('строка длиннее 75 байт');
  const un = lines.join('\r\n').replace(/\r\n[ \t]/g, '').split('\r\n'); // склеенные продолжения
  if (un[0] !== 'BEGIN:VCALENDAR') issues.push('первая строка не BEGIN:VCALENDAR');
  if (un[un.length - 1] !== 'END:VCALENDAR') issues.push('последняя строка не END:VCALENDAR');
  const bi = un.indexOf('BEGIN:VEVENT'), ei = un.indexOf('END:VEVENT');
  if (bi < 0 || ei < bi || un.lastIndexOf('BEGIN:VEVENT') !== bi) issues.push('нет ровно одного блока BEGIN:VEVENT … END:VEVENT');
  const head = un.slice(0, bi < 0 ? un.length : bi);
  if (!head.includes('VERSION:2.0')) issues.push('нет VERSION:2.0');
  if (!head.some((l) => /^PRODID:.+/.test(l))) issues.push('нет PRODID');
  const ev = bi >= 0 && ei > bi ? un.slice(bi + 1, ei).filter((l, i, a) => {
    // свойства самого события, без вложенных VALARM
    const before = a.slice(0, i);
    return before.filter((x) => x === 'BEGIN:VALARM').length === before.filter((x) => x === 'END:VALARM').length && !/^(BEGIN|END):VALARM$/.test(l);
  }) : [];
  const prop = (name) => ev.find((l) => l.startsWith(name + ':') || l.startsWith(name + ';'));
  if (!prop('UID')) issues.push('нет UID');
  if (!prop('DTSTAMP') || !/^DTSTAMP:\d{8}T\d{6}Z$/.test(prop('DTSTAMP'))) issues.push('нет DTSTAMP или неверный формат');
  const ds = prop('DTSTART'), de = prop('DTEND');
  const val = (l) => l && l.slice(l.indexOf(':') + 1);
  const fmtOk = (l) => l && (/^DT(START|END):\d{8}T\d{6}Z$/.test(l) || /^DT(START|END);VALUE=DATE:\d{8}$/.test(l));
  if (!fmtOk(ds)) issues.push('нет DTSTART или неверный формат');
  if (!fmtOk(de)) issues.push('нет DTEND или неверный формат');
  else if (fmtOk(ds) && !(val(de) > val(ds))) issues.push('DTEND не позже DTSTART');
  if (!prop('SUMMARY')) issues.push('нет SUMMARY');
  const count = (x) => un.filter((l) => l === x).length;
  if (count('BEGIN:VALARM') !== count('END:VALARM')) issues.push('VALARM не закрыт');
  return issues;
}
export { addDays };
