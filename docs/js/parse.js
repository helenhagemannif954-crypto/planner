// Офлайн-разбор естественной русской речи для быстрого ввода.
// Чистый модуль без обращения к DOM: parse(text, ctx) → {text, date, time, …, chips}.
import {
  today, addDays, addMonths, dow, weekStart, monthStart, monthEnd, mkDate, isValidDate,
  hm, fromMin, toMin, fmtDay, fmtShort, MONTHS_NOM, plural, daysInMonth,
} from './dates.js';
import { firstOccurrence, describe as describeRepeat } from './recur.js';

const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';
const rx = (src, flags = 'iu') => new RegExp(src, flags);

// ——— числа словами ———
const UNITS = { один: 1, одна: 1, одну: 1, одного: 1, одной: 1, два: 2, две: 2, двух: 2, три: 3, трех: 3, четыре: 4, четырех: 4, пять: 5, пяти: 5, шесть: 6, шести: 6, семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9 };
const TEENS = { десять: 10, десяти: 10, одиннадцать: 11, одиннадцати: 11, двенадцать: 12, двенадцати: 12, тринадцать: 13, тринадцати: 13, четырнадцать: 14, четырнадцати: 14, пятнадцать: 15, пятнадцати: 15, шестнадцать: 16, шестнадцати: 16, семнадцать: 17, семнадцати: 17, восемнадцать: 18, восемнадцати: 18, девятнадцать: 19, девятнадцати: 19 };
const TENS = { двадцать: 20, двадцати: 20, тридцать: 30, тридцати: 30, сорок: 40, сорока: 40, пятьдесят: 50, пятидесяти: 50 };
const ORD = { первого: 1, второго: 2, третьего: 3, четвертого: 4, пятого: 5, шестого: 6, седьмого: 7, восьмого: 8, девятого: 9, десятого: 10, одиннадцатого: 11, двенадцатого: 12, тринадцатого: 13, четырнадцатого: 14, пятнадцатого: 15, шестнадцатого: 16, семнадцатого: 17, восемнадцатого: 18, девятнадцатого: 19, двадцатого: 20, тридцатого: 30 };
const alt = (o) => Object.keys(o).sort((a, b) => b.length - a.length).join('|');
const NUMW = `(?:(?:${alt(TENS)})(?:\\s+(?:${alt(UNITS)}))?|${alt(TEENS)}|${alt(UNITS)}|\\d{1,2})`;
const ORDW = `(?:(?:двадцать|тридцать)\\s+(?:${alt(ORD)})|${alt(ORD)})`;

export function wordNum(s) {
  if (s == null) return null;
  s = s.trim().toLowerCase().replace(/ё/g, 'е');
  if (/^\d+$/.test(s)) return Number(s);
  let n = 0;
  for (const w of s.split(/\s+/)) {
    if (w in TENS) n += TENS[w];
    else if (w in TEENS) n += TEENS[w];
    else if (w in UNITS) n += UNITS[w];
    else if (w in ORD) n += ORD[w];
    else if (w === 'час') n += 1;
    else return null;
  }
  return n;
}

// ——— дни недели и месяцы ———
const DOW_RE = '(пн|вт|ср|чт|пт|сб|вс|понедельн\\p{L}*|вторн\\p{L}*|сред[аеуыо]\\p{L}*|сред[аеуы]|четверг\\p{L}*|пятниц\\p{L}*|суббот\\p{L}*|воскресен\\p{L}*)';
function dowOf(w) {
  w = w.toLowerCase();
  const keys = [['пн', 'понедельн'], ['вт', 'вторн'], ['ср', 'сред'], ['чт', 'четверг'], ['пт', 'пятниц'], ['сб', 'суббот'], ['вс', 'воскресен']];
  for (let i = 0; i < 7; i++) if (w === keys[i][0] || w.startsWith(keys[i][1])) return i + 1;
  return null;
}
const MONTH_GEN = '(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)';
const MONTH_STEMS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const MONTH_ANY = '(январ[еяю]|феврал[еяю]|марте|марта|марту|апрел[еяю]|мае|мая|маю|июн[еяю]|июл[еяю]|августе|августа|августу|сентябр[еяю]|октябр[еяю]|ноябр[еяю]|декабр[еяю])';
function monthOf(w) {
  w = w.toLowerCase();
  if (/^ма[йеяю]$/.test(w)) return 5;
  for (let i = 0; i < 12; i++) if (i !== 4 && w.startsWith(MONTH_STEMS[i])) return i + 1;
  return null;
}

// ——— основы слов для синонимов ———
export function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
}
export function stem(w) {
  w = norm(w);
  if (w.length > 5) w = w.replace(/(ться|тся|ть|ти)$/, '');
  const s = w.replace(/[аеиоуыэюяйь]+$/, '');
  return s.length >= 3 ? s : w;
}
function words(s) {
  const out = [];
  const re = /[\p{L}\d]+/gu;
  let m;
  while ((m = re.exec(s))) out.push({ w: norm(m[0]), i: m.index, end: m.index + m[0].length });
  return out;
}
/** Ищет синоним (одно или несколько слов) в тексте. Возвращает индекс первого слова или -1. */
export function findPhrase(textWords, phrase) {
  const pw = words(phrase).map((x) => stem(x.w));
  if (!pw.length) return -1;
  outer: for (let i = 0; i + pw.length <= textWords.length; i++) {
    for (let j = 0; j < pw.length; j++) {
      const tw = textWords[i + j].w;
      const st = pw[j];
      if (!(tw === st || tw.startsWith(st) || stem(tw) === st)) continue outer;
    }
    return i;
  }
  return -1;
}

export function codeKey(code) {
  return String(code || '').toUpperCase().replace(/Ё/g, 'Е').replace(/[^\p{L}\d]/gu, '');
}
export function codeDisplay(letters) {
  const k = codeKey(letters);
  if (/^\p{L}{1,3}$/u.test(k)) return k.split('').join('.') + '.';
  return String(letters).trim();
}

// ——— основная функция ———
export function parse(input, ctx = {}) {
  const now = ctx.now || new Date();
  const T = today(now);
  const orig = String(input || '').slice(0, 2000);
  const st = { orig, low: orig.toLowerCase().replace(/ё/g, 'е') };
  const r = {
    text: '', date: null, dateKind: null, time: null, part: null, dur: null, deadline: null,
    size: null, repeat: null, star: false, areaId: null, ctx: null, templateId: null,
    personId: null, personCode: null, newPerson: null, chips: [], recognized: false, done: false,
  };
  const mask = (i, j) => {
    const sp = ' '.repeat(j - i);
    st.orig = st.orig.slice(0, i) + sp + st.orig.slice(j);
    st.low = st.low.slice(0, i) + sp + st.low.slice(j);
  };
  const first = (src, fn) => {
    const re = rx(src, 'iug');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(st.low))) {
      const res = fn(m);
      if (res !== false) {
        const [a, b] = Array.isArray(res) ? res : [m.index, m.index + m[0].length];
        mask(a, b);
        return true;
      }
      if (m[0].length === 0) re.lastIndex++;
    }
    return false;
  };
  const all = (src, fn) => {
    let n = 0;
    while (first(src, fn)) if (++n > 20) break;
    return n;
  };

  const adjHour = (h, qual, bare) => {
    if (qual === 'утра') return h === 12 ? 0 : h;
    if (qual === 'дня') return h <= 6 ? h + 12 : h;
    if (qual === 'вечера') return h < 12 ? h + 12 : h;
    if (qual === 'ночи') return h === 12 ? 0 : h;
    if (bare && h >= 1 && h <= 6) return h + 12;
    return h;
  };
  const setTime = (h, m) => {
    if (h == null || m == null || h > 23 || m > 59 || h < 0 || m < 0) return false;
    if (r.time) return false;
    r.time = fromMin(h * 60 + m);
    return true;
  };

  // 1. «уже сделал»
  first(B + '(уже\\s+)?(сделал|сделала|сделано|готово)' + E + '\\s*[:\\-—]?', (m) => {
    if (m.index > 2 && !m[1]) return false;
    r.done = true;
  });

  // 2. #теги областей
  if (ctx.areas) {
    all('#([\\p{L}\\d_\\-]+)', (m) => {
      const tag = norm(m[1]).replace(/[_\-]/g, '');
      const a = matchAreaTag(tag, ctx.areas);
      if (!a) return false;
      r.areaId = a.id;
    });
  }

  // 3. главное: «!» и «важно»
  first('(^|\\s)(!+)(?=\\s|$)|(!+)$', () => { r.star = true; });
  first(B + '(важно|важное|главное)' + E + '[!]*', () => { r.star = true; });

  // 4. повторы
  first(B + 'через\\s+(' + NUMW + '|\\d+)\\s+(дн\\p{L}*|день)\\s+после\\s+выполнени\\p{L}*' + E, (m) => {
    r.repeat = { kind: 'after', n: wordNum(m[1]) };
  });
  first(B + '(?:каждый|каждое|каждую)\\s+(утро|вечер)' + E, (m) => {
    r.repeat = { kind: 'daily' };
    r.part = m[1] === 'утро' ? 'morning' : 'evening';
  }) ||
  first(B + '(ежедневно|каждый\\s+день|каждодневно)' + E, () => { r.repeat = { kind: 'daily' }; });
  if (!r.repeat) first(B + '(?:каждые|раз\\s+в)\\s+(' + NUMW + '|\\d+)\\s+(дн\\p{L}*|день|недел\\p{L}*)' + E, (m) => {
    const n = wordNum(m[1]);
    if (!n) return false;
    r.repeat = /^недел/.test(m[2]) ? { kind: 'interval', n: n * 7 } : { kind: 'interval', n };
  });
  if (!r.repeat) first(B + '(по\\s+будням|каждый\\s+будний\\s+день|в\\s+будни)' + E, () => { r.repeat = { kind: 'weekly', days: [1, 2, 3, 4, 5] }; });
  if (!r.repeat) first(B + '(?:кажд\\p{L}*|по)\\s+' + DOW_RE + '((?:\\s*(?:,|и)\\s*' + DOW_RE + ')*)' + E, (m) => {
    const list = m[0].replace(/^(кажд\S*|по)\s+/i, '').split(/\s*(?:,|\sи\s)\s*/);
    const days = [...new Set(list.map((x) => dowOf(x.trim())).filter(Boolean))].sort();
    if (!days.length) return false;
    r.repeat = { kind: 'weekly', days };
  });
  if (!r.repeat) first(B + '(еженедельно|каждую\\s+неделю|раз\\s+в\\s+неделю)' + E, () => { r.repeat = { kind: 'weekly', days: [] }; });
  if (!r.repeat) first(B + '(ежемесячно|каждый\\s+месяц|каждого\\s+месяца|раз\\s+в\\s+месяц)' + E, () => { r.repeat = { kind: 'monthly', day: null }; });
  if (!r.repeat) first(B + '(ежегодно|каждый\\s+год|раз\\s+в\\s+год)' + E, () => { r.repeat = { kind: 'yearly' }; });
  if (r.repeat && r.repeat.kind === 'monthly') {
    first(B + '(?:в\\s+)?(?:последн\\p{L}*\\s+(?:день|числ\\p{L}*))' + E, () => { r.repeat.day = 'last'; }) ||
    first(B + '(\\d{1,2}|' + ORDW + ')(?:-?го)?(?:\\s+числа)?' + E, (m) => {
      if (!/го|числа|^\p{L}/u.test(m[0])) return false;
      const d = wordNum(m[1]);
      if (!d || d > 31) return false;
      r.repeat.day = d;
    });
  }

  // 5. «через 2 часа», «через полчаса»
  first(B + 'через\\s+(?:(' + NUMW + '|\\d+|полтора)\\s+)?(час\\p{L}*|минут\\p{L}*|мин|полчаса)' + E, (m) => {
    let n = m[1] ? (m[1] === 'полтора' ? 1.5 : wordNum(m[1])) : 1;
    if (n == null) return false;
    let min = /^мин/.test(m[2]) ? n : m[2] === 'полчаса' ? 30 : n * 60;
    const t = new Date(now.getTime() + min * 60000);
    const rounded = Math.ceil((t.getHours() * 60 + t.getMinutes()) / 5) * 5;
    r.date = today(t);
    r.dateKind = 'day';
    r.time = fromMin(Math.min(rounded, 23 * 60 + 55));
  });

  // 6. даты и сроки
  const PRE = '(?:(в|во|на|до|к|ко|срок(?:ом)?|дедлайн|не\\s+позднее|к\\s+концу)\\s+)?';
  const put = (pre, date, kind = 'day') => {
    if (!date) return false;
    const dl = pre && /^(до|к|ко|срок|дедлайн|не)/.test(pre);
    if (dl) {
      if (r.deadline) return false;
      r.deadline = kind === 'month' ? addDays(monthStart(date), -1) : kind === 'week' ? addDays(weekStart(date), 6) : date;
      if (kind === 'month' && /^(до|к|ко)$/.test(pre)) r.deadline = addDays(monthStart(date), -1);
      return true;
    }
    if (r.date) return false;
    r.date = date;
    r.dateKind = kind;
    return true;
  };
  const futureYear = (m, d, y) => {
    if (y) {
      if (y < 100) y += 2000;
      return isValidDate(y, m, d) ? mkDate(y, m, d) : null;
    }
    let yy = now.getFullYear();
    if (!isValidDate(yy, m, d) && !isValidDate(yy + 1, m, d)) return null;
    let res = isValidDate(yy, m, d) ? mkDate(yy, m, d) : null;
    if (!res || res < T) res = isValidDate(yy + 1, m, d) ? mkDate(yy + 1, m, d) : null;
    return res;
  };
  const dayWords = { 'сегодня': 0, 'завтра': 1, 'послезавтра': 2 };

  let found = true;
  for (let guard = 0; found && guard < 4; guard++) {
    found = false;
    // до конца недели / месяца
    found = first(B + '(до|к)\\s+конц[ау]\\s+(недели|месяца|года)' + E, (m) => {
      if (r.deadline) return false;
      r.deadline = m[2] === 'недели' ? addDays(weekStart(T), 6) : m[2] === 'месяца' ? monthEnd(T) : mkDate(now.getFullYear(), 12, 31);
    }) || found;
    found = first(B + PRE + '(сегодня|завтра|послезавтра)' + E, (m) => put(m[1], addDays(T, dayWords[m[2]]))) || found;
    found = first(B + PRE + '(?:(следующ\\p{L}*|эт\\p{L}*)\\s+)?' + DOW_RE + E, (m) => {
      const pre = m[1], mod = m[2], w = dowOf(m[3]);
      if (!w) return false;
      const short = /^(пн|вт|ср|чт|пт|сб|вс)$/.test(m[3]);
      if (!pre && !mod && !short) return false;
      let d;
      if (mod && /^следующ/.test(mod)) d = addDays(weekStart(T), 7 + w - 1);
      else if (mod && /^эт/.test(mod)) d = addDays(weekStart(T), w - 1);
      else {
        // ближайший такой день, включая сегодня
        d = addDays(weekStart(T), w - 1);
        if (d < T) d = addDays(d, 7);
      }
      return put(pre, d);
    }) || found;
    found = first(B + '(до\\s+|к\\s+)?через\\s+(?:(' + NUMW + '|\\d+|пару)\\s+)?(дн\\p{L}*|день|недел\\p{L}*|месяц\\p{L}*|год\\p{L}*)' + E, (m) => {
      const n = m[2] ? (m[2] === 'пару' ? 2 : wordNum(m[2])) : 1;
      if (!n) return false;
      const u = m[3];
      const d = /^(дн|день)/.test(u) ? addDays(T, n) : /^недел/.test(u) ? addDays(T, 7 * n) : /^месяц/.test(u) ? addMonths(T, n) : addMonths(T, 12 * n);
      return put(m[1] ? 'до' : null, d);
    }) || found;
    found = first(B + PRE + '(\\d{1,2})[.\\/](\\d{1,2})(?:[.\\/](\\d{2}|\\d{4}))?' + E, (m) => {
      const dd = +m[2], mm = +m[3], yy = m[4] ? +m[4] : null;
      if (mm < 1 || mm > 12) return false;
      return put(m[1], futureYear(mm, dd, yy));
    }) || found;
    found = first(B + PRE + '(\\d{1,2}|' + ORDW + '|' + NUMW + ')(?:-?го|-е)?\\s+' + MONTH_GEN + '(?:\\s+(\\d{4})(?:\\s*г(?:ода|\\.)?)?)?' + E, (m) => {
      const d = wordNum(m[2]);
      if (!d) return false;
      return put(m[1], futureYear(monthOf(m[3]), d, m[4] ? +m[4] : null));
    }) || found;
    found = first(B + PRE + '(?:(\\d{1,2})-?го|(\\d{1,2})\\s+числа|(' + ORDW + ')\\s+числа)' + E, (m) => {
      const d = +(m[2] || m[3]) || wordNum(m[4]);
      if (!d || d > 31) return false;
      const y = now.getFullYear(), mo = now.getMonth() + 1;
      let res = isValidDate(y, mo, d) ? mkDate(y, mo, d) : null;
      if (!res || res < T) {
        const n = addMonths(monthStart(T), 1);
        const ny = +n.slice(0, 4), nm = +n.slice(5, 7);
        res = mkDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
      }
      return put(m[1], res);
    }) || found;
    found = first(B + PRE + '(эт\\p{L}*|следующ\\p{L}*)\\s+недел\\p{L}*' + E, (m) => {
      const ws = weekStart(T);
      return put(m[1], /^след/.test(m[2]) ? addDays(ws, 7) : ws, 'week');
    }) || found;
    found = first(B + PRE + '(выходн\\p{L}*)' + E, (m) => {
      let d = addDays(weekStart(T), 5);
      if (d < T) d = T;
      return put(m[1], d);
    }) || found;
    found = first(B + PRE + '(эт\\p{L}*|следующ\\p{L}*)\\s+месяц\\p{L}*' + E, (m) => {
      if (!m[1]) return false;
      const ms = monthStart(T);
      return put(m[1], /^след/.test(m[2]) ? addMonths(ms, 1) : ms, 'month');
    }) || found;
    found = first(B + PRE + MONTH_ANY + '(?:\\s+(\\d{4}))?' + E, (m) => {
      if (!m[1]) return false;
      const mo = monthOf(m[2]);
      if (!mo) return false;
      let y = m[3] ? +m[3] : now.getFullYear();
      if (!m[3] && mo < now.getMonth() + 1) y++;
      return put(m[1], mkDate(y, mo, 1), 'month');
    }) || found;
  }

  // 7. время
  const QUAL = '(утра|дня|вечера|ночи)';
  first(B + 'с\\s+(\\d{1,2})(?::(\\d{2}))?\\s+до\\s+(\\d{1,2})(?::(\\d{2}))?(?:\\s+' + QUAL + ')?' + E, (m) => {
    const h1 = adjHour(+m[1], m[5], !m[5] && !m[2]), h2 = adjHour(+m[3], m[5], !m[5] && !m[4]);
    const a = h1 * 60 + (+m[2] || 0), b = h2 * 60 + (+m[4] || 0);
    if (b <= a || !setTime(h1, +m[2] || 0)) return false;
    r.dur = b - a;
  });
  first(B + '(?:(?:в|к|около|на)\\s+)?(\\d{1,2})[:](\\d{2})(?:\\s+' + QUAL + ')?' + E, (m) => {
    const h = adjHour(+m[1], m[4], false);
    return setTime(h, +m[2]);
  });
  first(B + '(?:в|к)\\s+(\\d{1,2})\\.(\\d{2})' + E, (m) => {
    const mm = +m[2];
    if (mm >= 1 && mm <= 12) return false;
    return setTime(adjHour(+m[1], null, false), mm);
  });
  first(B + '(?:в\\s+)?полдень' + E, () => setTime(12, 0));
  first(B + '(?:в\\s+)?(?:пол-?\\s?|половин[еау]\\s+)(' + ORDW + ')(?:\\s+' + QUAL + ')?' + E, (m) => {
    let h = wordNum(m[1]) - 1;
    if (h === 0) h = 12;
    return setTime(adjHour(h, m[2], !m[2]), 30);
  });
  first(B + '(?:в\\s+)?четверть\\s+(' + ORDW + ')(?:\\s+' + QUAL + ')?' + E, (m) => {
    let h = wordNum(m[1]) - 1;
    if (h === 0) h = 12;
    return setTime(adjHour(h, m[2], !m[2]), 15);
  });
  first(B + 'без\\s+четверти\\s+(' + NUMW + '|час)(?:\\s+' + QUAL + ')?' + E, (m) => {
    let h = wordNum(m[1]) - 1;
    if (h === 0) h = 12;
    return setTime(adjHour(h, m[2], !m[2]), 45);
  });
  first(B + '(?:в|к|около)\\s+(' + NUMW + '|час)(?:\\s+(час(?:а|ов)?))?(?:\\s+(' + NUMW + ')(?:\\s+минут\\p{L}*)?)?(?:\\s+' + QUAL + ')?' + E, (m) => {
    const h0 = wordNum(m[1]);
    const mins = m[3] ? wordNum(m[3]) : 0;
    const qual = m[4];
    const hasWord = !!m[2] || m[1] === 'час';
    if (h0 == null || h0 > 23 || mins == null || mins > 59) return false;
    if (m[3] && mins < 10 && !/^\d/.test(m[3]) && !m[2]) return false;
    if (!hasWord && !m[3] && !qual) {
      // голое «в 18»: принимаем только перед концом фразы или служебным словом
      const rest = st.low.slice(m.index + m[0].length);
      if (!/^\s*($|[,.;!?)]|(в|во|на|до|с|и|к|утром|вечером|днем|сегодня|завтра|послезавтра|#)(?![\p{L}\d]))/u.test(rest)) return false;
      if (!/^\d/.test(m[1])) return false;
    }
    return setTime(adjHour(h0, qual, !qual), mins);
  });
  first(B + '(утром|с\\s+утра|днем|после\\s+обеда|вечером|ночью)' + E, (m) => {
    r.part = /утр/.test(m[1]) ? 'morning' : /дн|обед/.test(m[1]) ? 'day' : 'evening';
  });

  // 8. длительность и размер
  first(B + '(?:на\\s+)(?:(' + NUMW + '|\\d+|полтора)\\s+)?(час\\p{L}*|минут\\p{L}*|мин|полчаса)' + E, (m) => {
    const n = m[1] ? (m[1] === 'полтора' ? 1.5 : wordNum(m[1])) : 1;
    if (n == null || n === 0) return false;
    r.dur = Math.round(/^мин/.test(m[2]) ? n : m[2] === 'полчаса' ? 30 : n * 60);
  }) || first(B + '(\\d{1,3})\\s*(мин|минут\\p{L}*)' + E, (m) => { r.dur = +m[1]; });
  first(B + '(быстр\\p{L}*|минутное\\s+дело|мелоч\\p{L}*)' + E, (m) => {
    if (/^быстр/.test(m[1]) && m.index > 0 && /[\p{L}]\s*$/u.test(st.low.slice(0, m.index)) && !/^быстро$/.test(m[1])) return false;
    r.size = 'S';
  });
  first(B + '(больш(ое|ая|ой)(\\s+дело|\\s+задача)?)' + E, () => { r.size = 'L'; });
  if (r.dur && !r.size) r.size = r.dur <= 15 ? 'S' : r.dur <= 60 ? 'M' : 'L';

  // 9. шаблоны (только в начале фразы) и люди
  const tw = words(st.low);
  if (ctx.templates && ctx.templates.length) {
    let best = null;
    for (const t of ctx.templates) {
      for (const syn of [t.name, ...(t.synonyms || [])]) {
        if (!syn) continue;
        const i = findPhrase(tw, syn.split('/')[0]);
        if (i >= 0 && i <= 1 && (!best || i < best.i)) best = { t, i, len: words(syn.split('/')[0]).length };
      }
    }
    if (best) {
      r.templateId = best.t.id;
      const a = tw[best.i].i, b = tw[best.i + best.len - 1].end;
      mask(a, b);
    }
  }
  const people = ctx.people || [];
  // «с А.К.», «со С.», «для А.К.», «с а к»
  const pm = st.orig.match(/(^|[\s,])(с|со|для|у)\s+((?:\p{L}\.?\s?){1,3}(?![\p{L}]))/u);
  let personDone = false;
  if (pm) {
    const raw = pm[3].trim();
    const key = codeKey(raw);
    const letters = raw.replace(/[^\p{L}]/gu, '');
    const looksCode = /\./.test(raw) || /^\p{Lu}+$/u.test(letters) || /^(\p{L}\s)+\p{L}$/u.test(raw) || letters.length <= 2;
    const p = people.find((x) => codeKey(x.code) === key && x.status !== 'archived');
    const start = pm.index + pm[1].length;
    if (p) {
      r.personId = p.id; r.personCode = p.code; personDone = true;
      mask(start, start + pm[0].length - pm[1].length);
    } else if (r.templateId && looksCode && key.length >= 1 && key.length <= 3) {
      r.newPerson = codeDisplay(raw); personDone = true;
      mask(start, start + pm[0].length - pm[1].length);
    }
  }
  if (!personDone && people.length) {
    for (const x of words(st.orig)) {
      const p = people.find((pp) => codeKey(pp.code).length >= 2 && codeKey(pp.code) === codeKey(st.orig.slice(x.i, x.end + 4).match(/^[\p{L}.\s]*/u)[0]));
      if (p) {
        r.personId = p.id; r.personCode = p.code;
        break;
      }
    }
  }
  if (r.personId) {
    const p = people.find((x) => x.id === r.personId);
    if (p && !r.areaId) r.areaId = p.areaId || null;
  }

  // 10. области по ключевым словам (текст не меняем)
  const allWords = words(orig.toLowerCase().replace(/ё/g, 'е'));
  if (!r.areaId && ctx.areas) {
    let best = null;
    for (const a of ctx.areas) {
      if (a.archived) continue;
      for (const syn of [a.name, ...(a.synonyms || [])]) {
        const i = findPhrase(allWords, syn);
        if (i >= 0) {
          const score = words(syn).length * 100 - i;
          if (!best || score > best.score) best = { a, score };
        }
      }
    }
    if (best) r.areaId = best.a.id;
  }
  if (r.templateId && !r.areaId) {
    const t = ctx.templates.find((x) => x.id === r.templateId);
    if (t && t.areaId) r.areaId = t.areaId;
  }
  // 11. контексты
  if (ctx.contexts) {
    for (const c of ctx.contexts) {
      if ([c.name, ...(c.synonyms || [])].some((s) => s && findPhrase(allWords, s) >= 0)) { r.ctx = c.id; break; }
    }
  }

  // ——— итоги ———
  if (r.repeat) {
    if (r.repeat.kind === 'weekly' && !r.repeat.days.length) r.repeat.days = [dow(r.date || T)];
    if (r.repeat.kind === 'monthly' && !r.repeat.day) r.repeat.day = Number((r.date || T).slice(8, 10));
    if (r.repeat.kind === 'yearly') { const d = r.date || T; r.repeat.month = +d.slice(5, 7); r.repeat.day = +d.slice(8, 10); }
    if (!r.date || r.dateKind !== 'day') { r.date = firstOccurrence(r.repeat, T); r.dateKind = 'day'; }
  }
  if ((r.time || r.part) && !r.date) {
    r.date = T;
    r.dateKind = 'day';
    if (r.time && !ctx.keepPast && toMin(r.time) < now.getHours() * 60 + now.getMinutes() - 60) r.date = addDays(T, 1);
  }
  if (r.star && !r.date) { r.date = T; r.dateKind = 'day'; }
  if (r.time) r.part = null;

  r.text = cleanup(st.orig);
  r.recognized = !!(r.date || r.deadline || r.areaId || r.templateId || r.repeat || r.personId);
  r.chips = chipsOf(r, ctx, now);
  return r;
}

function matchAreaTag(tag, areas) {
  const act = areas.filter((a) => !a.archived);
  const n = (s) => norm(s).replace(/[\s_\-]/g, '');
  return act.find((a) => n(a.name) === tag) ||
    act.find((a) => n(a.name).startsWith(tag)) ||
    act.find((a) => (a.synonyms || []).some((s) => n(s) === tag || stem(s) === stem(tag))) ||
    null;
}

function cleanup(s) {
  s = s.replace(/\s+/g, ' ').trim();
  // висящие предлоги и знаки
  for (let i = 0; i < 3; i++) {
    s = s.replace(/(^|\s)(в|во|на|к|ко|до|с|со|и|по|у|для|около)(?=\s*$)/iu, '').trim();
    s = s.replace(/(^|\s)(в|во|на|к|ко|до|с|со|и|около)\s+(?=(в|во|на|к|до|и)\s)/iu, '$1').trim();
    s = s.replace(/^[,.;:\-—–\s]+|[,;:\-—–\s]+$/gu, '').trim();
  }
  s = s.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ');
  if (s) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

const PART_LABEL = { morning: 'утром', day: 'днём', evening: 'вечером' };
export function partLabel(p) { return PART_LABEL[p] || ''; }

export function dateLabel(date, kind, now = new Date()) {
  if (!date) return '';
  if (kind === 'week') {
    const ws = weekStart(today(now));
    if (date === ws) return 'на этой неделе';
    if (date === addDays(ws, 7)) return 'на следующей неделе';
    return 'неделя с ' + fmtShort(date);
  }
  if (kind === 'month') {
    const m = +date.slice(5, 7);
    return 'в ' + ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'][m - 1] + (date.slice(0, 4) !== String(now.getFullYear()) ? ' ' + date.slice(0, 4) : '');
  }
  return fmtDay(date, now);
}

function chipsOf(r, ctx, now) {
  const c = [];
  if (r.done) c.push({ key: 'done', label: 'уже сделано' });
  if (r.templateId) {
    const t = (ctx.templates || []).find((x) => x.id === r.templateId);
    c.push({ key: 'template', label: 'цепочка: ' + (t ? t.name : '') });
  }
  if (r.personId) c.push({ key: 'person', label: r.personCode, person: true });
  if (r.newPerson) c.push({ key: 'person', label: r.newPerson + ' (новый)', person: true });
  if (r.date) c.push({ key: 'date', label: dateLabel(r.date, r.dateKind, now) });
  if (r.time) c.push({ key: 'time', label: r.time + (r.dur ? ' · ' + (r.dur >= 60 ? (r.dur / 60) + ' ч' : r.dur + ' мин') : '') });
  else if (r.part) c.push({ key: 'time', label: partLabel(r.part) });
  if (r.deadline) c.push({ key: 'deadline', label: 'срок ' + fmtDay(r.deadline, now) });
  if (r.repeat) c.push({ key: 'repeat', label: describeRepeat(r.repeat) });
  if (r.star) c.push({ key: 'star', label: '★ главное' });
  if (r.areaId) {
    const a = (ctx.areas || []).find((x) => x.id === r.areaId);
    if (a) c.push({ key: 'area', label: a.name, color: a.color, areaId: a.id });
  }
  if (r.ctx) {
    const x = (ctx.contexts || []).find((y) => y.id === r.ctx);
    if (x) c.push({ key: 'ctx', label: x.name });
  }
  if (r.size && !r.time) c.push({ key: 'size', label: { S: 'быстро', M: 'около часа', L: 'большое' }[r.size] });
  return c;
}

export { plural, MONTHS_NOM, hm };
