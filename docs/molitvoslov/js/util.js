// Мелкие общие помощники.

/** Создать элемент: h('p', {class: 'x', onclick: fn}, 'текст', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Ключ дня по местному времени: 2026-10-22 */
export function dayKey(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function fromKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return r;
}

/** Число дней между двумя датами (по календарю, без учёта часов) */
export function daysBetween(a, b) {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86400000);
}

/** Детерминированный хэш строки (FNV-1a) */
export function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

export function ordinalWeek(n) {
  return `${n}-я седмица`;
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Минуты от полуночи */
export function minutesOf(d) {
  return d.getHours() * 60 + d.getMinutes();
}

/** «09:30» → 570 */
export function parseHM(s) {
  const [hh, mm] = String(s).split(':').map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

/** Текущее время; в тестах можно подменить через ?now=2026-10-22T07:00 */
export function now() {
  const q = new URLSearchParams(location.search).get('now');
  if (q) {
    const d = new Date(q);
    if (!isNaN(d)) {
      // сдвигаем «сейчас» на столько, сколько прошло с загрузки страницы
      const shift = performance.now();
      return new Date(d.getTime() + shift);
    }
  }
  return new Date();
}

/** Разбить текст на фразы для медленного чтения */
export function phrases(text) {
  const parts = String(text).split(/(?<=[.;:!?…])\s+|(?<=,)\s+(?=[а-яё])/u);
  // слишком короткие куски склеиваем с соседом
  const out = [];
  for (const p of parts) {
    if (out.length && (p.length < 18 || out[out.length - 1].length < 18)) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out.filter(Boolean);
}
