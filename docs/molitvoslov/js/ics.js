// Часы молитвы → файл календаря (.ics) с ежедневными тихими событиями.
// Сервера нет, поэтому настоящие уведомления по расписанию даёт календарь телефона.

import { h } from './util.js';

function pad(n) { return String(n).padStart(2, '0'); }

function stamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

export function buildIcs(st, offices) {
  const ids = ['morning', ...(st.hours ? ['third', 'sixth', 'ninth'] : []), 'evening', 'sleep'];
  const title = Object.fromEntries(offices.map((o) => [o.id, o.title]));
  const today = new Date();
  const ymd = `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//molitvoslov//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Часы молитвы'];
  for (const id of ids) {
    const t = st.reminders[id];
    if (!t) continue;
    const [hh, mm] = t.split(':');
    lines.push(
      'BEGIN:VEVENT',
      `UID:molitvoslov-${id}@local`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${ymd}T${pad(hh)}${pad(mm)}00`,
      'DURATION:PT5M',
      'RRULE:FREQ=DAILY',
      `SUMMARY:${title[id]}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${title[id]}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function downloadReminders(st, offices) {
  const ics = buildIcs(st, offices);
  const file = new File([ics], 'chasy-molitvy.ics', { type: 'text/calendar' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: 'Часы молитвы' }).catch(() => {});
    return;
  }
  const a = h('a', { href: URL.createObjectURL(file), download: 'chasy-molitvy.ics' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
