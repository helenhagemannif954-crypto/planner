// Работа с датами. Дата хранится строкой 'YYYY-MM-DD' в местном времени устройства,
// время — строкой 'HH:MM'. Неделя начинается с понедельника (1..7).

export const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
export const DOW_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
export const DOW_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export const DOW_ACC = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];

const pad = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function hm(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // полдень — защита от переходов времени
}
export function mkDate(y, m, d) {
  return ymd(new Date(y, m - 1, d, 12));
}
export function isValidDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(y, m - 1, d, 12);
  return t.getMonth() === m - 1 && t.getDate() === d;
}
export function today(now = new Date()) {
  return ymd(now);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function addMonths(s, n) {
  const d = parseYmd(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = daysInMonth(d.getFullYear(), d.getMonth() + 1);
  d.setDate(Math.min(day, last));
  return ymd(d);
}
export function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}
/** 1 = понедельник … 7 = воскресенье */
export function dow(s) {
  const g = parseYmd(s).getDay();
  return g === 0 ? 7 : g;
}
export function weekStart(s) {
  return addDays(s, 1 - dow(s));
}
export function monthStart(s) {
  return s.slice(0, 8) + '01';
}
export function monthEnd(s) {
  const [y, m] = s.split('-').map(Number);
  return mkDate(y, m, daysInMonth(y, m));
}
export function diffDays(a, b) {
  // b - a в днях
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}
export function toMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
export function fromMin(n) {
  n = Math.max(0, Math.min(24 * 60 - 1, Math.round(n)));
  return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
}
/** Сдвиг даты и времени на N минут; возвращает {date, time}. */
export function shiftDateTime(date, time, minutes) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const t = new Date(y, mo - 1, d, h, mi + minutes);
  return { date: ymd(t), time: hm(t) };
}
export function dateTime(date, time) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

export function fmtDay(s, now = new Date()) {
  const t = today(now);
  const dd = diffDays(t, s);
  if (dd === 0) return 'сегодня';
  if (dd === 1) return 'завтра';
  if (dd === -1) return 'вчера';
  if (dd === 2) return 'послезавтра';
  const d = parseYmd(s);
  if (dd > 2 && dd < 7) return DOW_SHORT[dow(s) - 1] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + (sameYear ? '' : ' ' + d.getFullYear());
}
export function fmtLong(s) {
  const d = parseYmd(s);
  const w = DOW_FULL[dow(s) - 1];
  return w[0].toUpperCase() + w.slice(1) + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}
export function fmtShort(s) {
  const d = parseYmd(s);
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1);
}
export function fmtDur(min) {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return m + ' мин';
  if (!m) return h + ' ч';
  return h + ' ч ' + m + ' мин';
}
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export function monthName(s) {
  const d = parseYmd(s);
  return MONTHS_NOM[d.getMonth()];
}
