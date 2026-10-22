// Церковное время: юлианская пасхалия, седмица, время суток.

import { addDays, daysBetween, minutesOf, WEEKDAYS, MONTHS_GEN, dayKey } from './util.js';

/** Православная Пасха (юлианская пасхалия), дата по григорианскому календарю */
export function pascha(year) {
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31); // 3 — март, 4 — апрель (по юлианскому)
  const day = ((d + e + 114) % 31) + 1;
  const shift = Math.floor(year / 100) - Math.floor(year / 400) - 2; // разница стилей
  return new Date(year, month - 1, day + shift);
}

/** Богоявление: 6 января по юлианскому = 19 января (1900–2099) */
function epiphany(year) {
  const shift = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  return new Date(year, 0, 6 + shift);
}

/**
 * Всё, что нужно знать о дне.
 * season: ordinary | lent | holyweek | pascha | brightweek | pentecostal | pentecost | epiphany
 */
export function dayInfo(date) {
  const d0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const p = pascha(d0.getFullYear());
  const fromP = daysBetween(p, d0);
  const wd = d0.getDay();
  const info = {
    date: d0,
    key: dayKey(d0),
    weekday: wd,
    fromPascha: fromP,
    pascha: p,
    season: 'ordinary',
    feast: null,
    label: '',
    sunday: wd === 0,
    saturday: wd === 6,
    fast: false,        // постный (покаянный) день
    lentWeekday: false,
    paschal: false,     // пятьдесят дней от Пасхи до Пятидесятницы
  };
  if (fromP >= -48 && fromP <= -8) {
    info.season = 'lent';
    const week = Math.floor((fromP + 48) / 7) + 1;
    info.label = `Четыредесятница · ${week}-я седмица`;
    if (fromP === -8) info.label = 'Четыредесятница · последний день';
  } else if (fromP >= -7 && fromP <= -1) {
    info.season = 'holyweek';
    info.label = ({ [-7]: 'Вход Господень в Иерусалим', [-3]: 'Великий четверг', [-2]: 'Великая пятница', [-1]: 'Великая суббота' })[fromP] || 'Страстная седмица';
    if (fromP === -7) info.feast = 'palm';
    if (fromP === -2) info.feast = 'goodfriday';
  } else if (fromP === 0) {
    info.season = 'pascha';
    info.feast = 'pascha';
    info.label = 'Пасха Христова';
  } else if (fromP >= 1 && fromP <= 6) {
    info.season = 'brightweek';
    info.label = 'Светлая седмица';
  } else if (fromP >= 7 && fromP <= 48) {
    info.season = 'pentecostal';
    info.label = `Пятьдесят дней Пасхи · ${fromP + 1}-й день`;
  } else if (fromP === 49) {
    info.season = 'pentecost';
    info.feast = 'pentecost';
    info.label = 'Пятидесятница';
  }
  info.paschal = fromP >= 0 && fromP <= 49;
  if (dayKey(d0) === dayKey(epiphany(d0.getFullYear()))) {
    info.season = 'epiphany';
    info.feast = 'epiphany';
    info.label = 'Богоявление';
  }
  info.lentWeekday = info.season === 'lent' && wd >= 1 && wd <= 5;
  // Среда и пятница — постные (Дидахе 8:1), кроме пятидесяти дней Пасхи
  info.fast = !info.paschal && (wd === 3 || wd === 5);
  if (info.season === 'holyweek' && wd !== 0) info.fast = true;
  if (!info.label) {
    if (info.fast) info.label = wd === 3 ? 'Среда · постный день' : 'Пятница · постный день';
    else if (wd === 0) info.label = 'День Воскресения';
    else if (wd === 6) info.label = 'Суббота · память творения';
  }
  // покаянные тексты не звучат в воскресенье и все пятьдесят дней Пасхи
  info.noPenitence = info.sunday || info.paschal;
  return info;
}

export function dateTitle(date) {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS_GEN[date.getMonth()]}`;
}

/** Воскресенье, с которого начинается седмица этого дня */
export function weekStart(date) {
  return addDays(date, -date.getDay());
}

const EPOCH = new Date(2024, 0, 7); // воскресенье — точка отсчёта круга тем

/** Тема седмицы: в Пасху и Четыредесятницу — свои, иначе — по кругу */
export function weekTheme(date, themes) {
  const ws = weekStart(date);
  const p = pascha(ws.getFullYear());
  const fromP = daysBetween(p, ws);
  const seas = themes.seasonal || {};
  if (fromP >= 0 && fromP <= 49 && seas.pascha) return seas.pascha[Math.min(Math.floor(fromP / 7), seas.pascha.length - 1)];
  if (fromP === -7 && seas.holyweek) return seas.holyweek;
  if (fromP >= -49 && fromP < -7 && seas.lent) return seas.lent[Math.min(Math.floor((fromP + 49) / 7), seas.lent.length - 1)];
  const ord = themes.order || [];
  if (!ord.length) return null;
  const n = Math.floor(daysBetween(EPOCH, ws) / 7);
  return ord[((n % ord.length) + ord.length) % ord.length];
}

/**
 * Какой чин сейчас по времени. Окна (минуты от полуночи) — простые и предсказуемые.
 * Если дневные часы выключены — днём предлагается молитва темы седмицы.
 */
export function officeForTime(date, st) {
  const m = minutesOf(date);
  if (m < 4 * 60) return st.night ? 'night' : 'sleep';
  if (m < 10 * 60) return 'morning';
  if (st.hours) {
    if (m < 11 * 60 + 30) return 'third';
    if (m < 14 * 60 + 30) return 'sixth';
    if (m < 17 * 60) return 'ninth';
  } else {
    if (m < 11 * 60 + 30) return 'morning';
    if (m < 17 * 60) return 'theme';
  }
  if (m < 21 * 60) return 'evening';
  return 'sleep';
}

/** Чины дня в порядке времени (для списка «сегодня») */
export function officesOfDay(st) {
  const list = ['morning'];
  if (st.hours) list.push('third', 'sixth', 'ninth');
  list.push('evening', 'sleep');
  if (st.night) list.push('night');
  return list;
}
