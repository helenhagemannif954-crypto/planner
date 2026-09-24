// Церковный календарь офлайн. Православная пасхалия (юлианская), даты — в новом стиле.
import { mkDate, addDays, diffDays, dow } from './dates.js';

/** Православная Пасха в новом стиле, 'YYYY-MM-DD'. Корректна для 1900–2099. */
export function orthodoxEaster(year) {
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  // разница юлианского и григорианского календарей
  const shift = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  return addDays(mkDate(year, month, day), shift);
}

// Неподвижные праздники (новый стиль)
const FIXED = [
  [1, 7, 'Рождество Христово', 'great12'],
  [1, 14, 'Обрезание Господне, свт. Василия Великого', 'great'],
  [1, 19, 'Крещение Господне', 'great12'],
  [2, 15, 'Сретение Господне', 'great12'],
  [4, 7, 'Благовещение', 'great12'],
  [7, 7, 'Рождество Иоанна Предтечи', 'great'],
  [7, 12, 'Апостолов Петра и Павла', 'great'],
  [8, 19, 'Преображение Господне', 'great12'],
  [8, 28, 'Успение Богородицы', 'great12'],
  [9, 11, 'Усекновение главы Иоанна Предтечи', 'great'],
  [9, 21, 'Рождество Богородицы', 'great12'],
  [9, 27, 'Воздвижение Креста Господня', 'great12'],
  [10, 14, 'Покров Богородицы', 'great'],
  [12, 4, 'Введение во храм Богородицы', 'great12'],
];

/**
 * Все события года: праздники (kind: pascha | great12 | great | memorial | holy),
 * и периоды постов. Возвращает {days: Map<date, [{title, kind}]>, periods: [{title, from, to, kind}]}.
 */
const cache = new Map();
export function churchYear(year) {
  if (cache.has(year)) return cache.get(year);
  const P = orthodoxEaster(year);
  const days = new Map();
  const add = (date, title, kind) => {
    if (!date.startsWith(String(year))) return;
    if (!days.has(date)) days.set(date, []);
    days.get(date).push({ title, kind });
  };
  add(P, 'Пасха — Светлое Христово Воскресение', 'pascha');
  add(addDays(P, -7), 'Вход Господень в Иерусалим', 'great12');
  add(addDays(P, 39), 'Вознесение Господне', 'great12');
  add(addDays(P, 49), 'День Святой Троицы', 'great12');
  add(addDays(P, 50), 'День Святого Духа', 'memorial');
  add(addDays(P, 9), 'Радоница', 'memorial');
  add(addDays(P, -49), 'Прощёное воскресенье', 'memorial');
  add(addDays(P, -57), 'Вселенская родительская суббота', 'memorial');
  add(addDays(P, 48), 'Троицкая родительская суббота', 'memorial');
  for (const k of [-36, -29, -22]) add(addDays(P, k), 'Родительская суббота', 'memorial');
  const hw = ['Великий понедельник', 'Великий вторник', 'Великая среда', 'Великий четверг', 'Великая пятница', 'Великая суббота'];
  hw.forEach((t, i) => add(addDays(P, -6 + i), t, 'holy'));
  for (const [m, d, t, k] of FIXED) add(mkDate(year, m, d), t, k);
  // Дмитриевская родительская суббота — суббота перед 8 ноября
  let dm = mkDate(year, 11, 7);
  while (dow(dm) !== 6) dm = addDays(dm, -1);
  add(dm, 'Дмитриевская родительская суббота', 'memorial');

  const periods = [];
  const per = (title, from, to, kind) => periods.push({ title, from, to, kind });
  per('Великий пост', addDays(P, -48), addDays(P, -7), 'fast');
  per('Страстная седмица', addDays(P, -6), addDays(P, -1), 'holy');
  per('Светлая седмица', P, addDays(P, 6), 'bright');
  const petStart = addDays(P, 57), petEnd = mkDate(year, 7, 11);
  if (diffDays(petStart, petEnd) >= 0) per('Петров пост', petStart, petEnd, 'fast');
  per('Успенский пост', mkDate(year, 8, 14), mkDate(year, 8, 27), 'fast');
  per('Рождественский пост', mkDate(year, 11, 28), mkDate(year, 12, 31), 'fast');
  per('Рождественский пост', mkDate(year, 1, 1), mkDate(year, 1, 6), 'fast');
  per('Святки', mkDate(year, 1, 7), mkDate(year, 1, 17), 'bright');
  periods.sort((a, b) => (a.from < b.from ? -1 : 1));
  const res = { days, periods, pascha: P };
  cache.set(year, res);
  return res;
}

/** Сведения о дне: праздники, период, признак «накануне праздника». */
export function churchDay(date) {
  const y = Number(date.slice(0, 4));
  const cy = churchYear(y);
  const feasts = cy.days.get(date) || [];
  const periods = cy.periods.filter((p) => p.from <= date && date <= p.to);
  const next = addDays(date, 1);
  const ny = churchYear(Number(next.slice(0, 4)));
  const eveOf = (ny.days.get(next) || []).filter((f) => f.kind === 'pascha' || f.kind === 'great12' || f.kind === 'great');
  const major = feasts.some((f) => f.kind === 'pascha' || f.kind === 'great12' || f.kind === 'great');
  return { feasts, periods, eveOf, major, holy: periods.some((p) => p.kind === 'holy') };
}

/** На сколько часов церковный день уменьшает ёмкость (по настройкам). */
export function churchReduction(date, cfg, specialDays = []) {
  let r = 0;
  if (cfg && cfg.enabled !== false) {
    const d = churchDay(date);
    if (d.major) r = Math.max(r, cfg.feast ?? 3);
    else if (d.holy) r = Math.max(r, cfg.holy ?? 3);
    if (d.eveOf.length) r += cfg.eve ?? 2;
  }
  for (const s of specialDays) {
    if (s.date === date || (s.yearly && s.date.slice(5) === date.slice(5))) r += Number(s.hours) || 0;
  }
  return r;
}
