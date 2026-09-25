// Файл .ics для календаря телефона: одно событие с напоминаниями.
import { dateTime, addDays } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');
function utc(d) {
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00Z';
}
function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function fold(line) {
  const out = [];
  while (line.length > 72) { out.push(line.slice(0, 72)); line = ' ' + line.slice(72); }
  out.push(line);
  return out.join('\r\n');
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
    // время — начало; без окончания событие-точка
    start = dateTime(task.date, task.time);
    end = new Date(start.getTime() + (Number(task.dur) || 0) * 60000);
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
    ...(allDay ? ['DTSTART;VALUE=DATE:' + allDay.from, 'DTEND;VALUE=DATE:' + allDay.to] : ['DTSTART:' + utc(start), 'DTEND:' + utc(end)]),
    'SUMMARY:' + esc(summary),
  ];
  if (!priv && task.note) lines.push('DESCRIPTION:' + esc(task.note.slice(0, 1000)));
  for (const a of alarms) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(summary), 'TRIGGER:' + a, 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
export { addDays };
