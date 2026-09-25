// Один общий календарь (Яндекс) через .ics. Порядок попытки:
// 1) navigator.share с файлом — системное окно «Отправить в…», где есть Яндекс.Календарь;
// 2) если файлом поделиться нельзя или это упало — прямой переход по blob-ссылке (без download),
//    чтобы Android сам предложил приложение для содержимого;
// 3) скачивание — последний запасной вариант.
// Любой способ можно закрепить в настройках; каждая попытка пишется в историю (localStorage, 5 последних),
// которую показывает экран «Диагностика календаря».
import { toast } from '../ui.js';
import * as st from '../store.js';
import { buildIcs, checkIcs } from '../ics.js';

export const HINTS = {
  shared: 'Выберите Яндекс.Календарь в списке приложений.',
  opened: 'Если вместо календаря началась загрузка: откройте Загрузки → нажмите на файл → выберите Яндекс.Календарь.',
  downloaded: 'Файл скачан в Загрузки. Откройте Загрузки → нажмите на файл → выберите Яндекс.Календарь',
};
export const CHECK_HINT = 'Если календарь не предложат выбрать — после открытия проверьте, что событие создано в общем календаре, а не в личном; при необходимости переместите его в Яндекс.Календаре вручную (долгое нажатие на событие → Переместить в календарь)';
export const autoCalendar = () => st.settings().autoCalendar !== false;
// Способы передачи. «auto» — share с файлом, если браузер умеет, иначе прямой переход по blob-ссылке.
export const METHODS = {
  share: 'share с файлом',
  link: 'ссылка <a href="blob:…" target="_blank">',
  nav: 'прямой переход по blob-ссылке',
  download: 'скачивание',
};
export const calendarMode = () => {
  const m = st.settings().calendarMode;
  return m && (m === 'auto' || METHODS[m]) ? m : 'auto';
};

// ——— журнал и история попыток (localStorage, последние 5) ———
export const calLog = [];
function log(msg) {
  calLog.push({ at: Date.now(), msg });
  if (calLog.length > 20) calLog.shift();
  console.info('[календарь] ' + msg);
}
const DIAG_KEY = 'planner.calendarDiag';
export function diagHistory() {
  try { const v = JSON.parse(localStorage.getItem(DIAG_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => x && x.at) : []; } catch { return []; }
}
function saveHistory(list) {
  try { localStorage.setItem(DIAG_KEY, JSON.stringify(list.slice(0, 5))); } catch { /* хранилище недоступно */ }
}
export function clearDiag() { try { localStorage.removeItem(DIAG_KEY); } catch { /* нет */ } }
/** Отметка человека «что было на экране» для последней попытки. */
export function markLast(outcome) {
  const list = diagHistory();
  if (!list.length) return;
  list[0].seen = outcome;
  saveHistory(list);
}
const errText = (e) => {
  if (e && e.name) return e.name + ': ' + (e.message || '(без текста)');
  return String(e);
};

/** Какое событие получится: 'time' (со временем), 'day' (на весь день), 'deadline' (срок) или null. */
export function calendarKind(t) {
  if (!t) return null;
  if (t.date && (!t.dateKind || t.dateKind === 'day')) return t.time ? 'time' : 'day';
  if (t.deadline) return 'deadline';
  return null;
}

export const TYPE = 'text/calendar;charset=utf-8';
const SHARE_TYPE = 'text/calendar'; // для File в «Поделиться»: canShare сверяет тип без параметров

let lastBlobType = null;
const blobUrl = (text) => {
  const b = new Blob([text], { type: TYPE });
  lastBlobType = b.type;
  return URL.createObjectURL(b);
};

/** Возможности браузера — для диагностики и выбора способа. */
export function capabilities(name = 'proverka.ics') {
  const res = { share: typeof navigator.share === 'function', canShareFn: typeof navigator.canShare === 'function', canShareFiles: null, canShareError: null };
  if (res.canShareFn) {
    try { res.canShareFiles = navigator.canShare({ files: [new File(['BEGIN:VCALENDAR\r\n'], name, { type: SHARE_TYPE })] }); } catch (e) { res.canShareError = errText(e); }
  }
  return res;
}
const shareBlocker = (cap) => (!cap.share ? 'navigator.share отсутствует'
  : cap.canShareError ? 'navigator.canShare бросил исключение: ' + cap.canShareError
    : cap.canShareFn && cap.canShareFiles !== true ? 'navigator.canShare({files}) = ' + cap.canShareFiles + ' — браузер не передаёт файл .ics'
      : null);

async function viaShare(text, name, title) {
  const file = new File([text], name, { type: SHARE_TYPE });
  await navigator.share({ files: [file], title });
}
function viaLink(text) {
  const url = blobUrl(text);
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);
}
function viaNav(text) {
  const url = blobUrl(text);
  window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function downloadFile(text, name) {
  const url = blobUrl(text);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);
}

/** Один шаг одним способом. Исключение не теряется: полный текст уходит в историю. */
async function step(method, text, name, title) {
  try {
    if (method === 'share') {
      const why = shareBlocker(capabilities(name));
      if (why) return { method, ok: false, error: why };
      await viaShare(text, name, title);
      return { method, ok: true, note: 'системное окно открыто' };
    }
    if (method === 'link') viaLink(text);
    else if (method === 'nav') viaNav(text);
    else downloadFile(text, name);
    return { method, ok: true, note: method === 'download' ? 'файл отдан на скачивание' : 'браузер принял ссылку' };
  } catch (e) {
    return { method, ok: false, error: errText(e), aborted: !!(e && e.name === 'AbortError') };
  }
}

const RESULT = { share: 'shared', link: 'opened', nav: 'opened', download: 'downloaded' };

/**
 * Передать .ics в календарь. Возвращает 'shared' | 'opened' | 'downloaded' | 'aborted'.
 * Вызывать прямо из обработчика нажатия: браузер разрешает «Поделиться» только сразу после действия.
 * opts.mode — способ для пробной попытки из «Диагностики»; иначе — из настроек.
 */
export async function deliverIcs(text, name, title = 'Событие', opts = {}) {
  const mode = opts.mode || calendarMode();
  const activation = navigator.userActivation ? navigator.userActivation.isActive : null;
  const issues = checkIcs(text);
  lastBlobType = null;
  const steps = [];
  const run = async (m) => { const r = await step(m, text, name, title); steps.push(r); return r; };
  let res = 'aborted';
  if (mode === 'auto') {
    const cap = capabilities(name);
    const why = shareBlocker(cap);
    let r = null;
    if (why) steps.push({ method: 'share', ok: false, skipped: true, error: why });
    else r = await run('share');
    if (r && r.ok) res = 'shared';
    else if (!(r && r.aborted)) {
      const n = await run('nav');
      if (n.ok) res = 'opened';
      else if ((await run('download')).ok) res = 'downloaded';
    }
  } else {
    const r = await run(mode);
    if (r.ok) res = RESULT[mode];
    else if (!r.aborted && mode !== 'download' && (await run('download')).ok) res = 'downloaded'; // не оставляем ни с чем
  }
  const last = steps[steps.length - 1];
  const failed = steps.filter((x) => !x.ok && !x.skipped);
  const entry = {
    at: new Date().toISOString(), mode, method: last.method, ok: !!last.ok, result: res,
    error: failed.length ? failed[failed.length - 1].error : null,
    steps, activation, file: name, bytes: new TextEncoder().encode(text).length,
    ics: issues.length ? issues.join('; ') : 'ok', blobType: lastBlobType,
  };
  saveHistory([entry, ...diagHistory()]);
  log(steps.map((x) => METHODS[x.method] + ': ' + (x.ok ? 'без ошибки' : (x.skipped ? 'пропущен — ' : 'ошибка — ') + x.error)).join(' → '));
  return res;
}

/** Пробная попытка из «Диагностики»: событие-проверка на завтра, 10:00. */
export function testIcs() {
  const now = st.clock();
  const d = new Date(now.getTime() + 86400000);
  const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return buildIcs({ id: 'proverka-' + now.getTime().toString(36), text: 'Проверка планировщика (можно удалить)', date, time: '10:00', dur: 30 }, { kind: 'time', now });
}

// ——— экран «Диагностика календаря» ———
export const SEEN = {
  calendar: 'открылся календарь или выбор приложения',
  download: 'началась загрузка файла',
  nothing: 'ничего не произошло',
  other: 'открылось что-то другое',
};
const fmtAt = (iso) => { const d = new Date(iso); return d.toLocaleDateString('ru-RU') + ', ' + d.toLocaleTimeString('ru-RU'); };
const tf = (v) => (v === true ? 'true' : v === false ? 'false' : 'недоступно');
function uaShort() {
  const ua = navigator.userAgent;
  const m = (re) => (ua.match(re) || [])[1];
  const b = m(/YaBrowser\/([\d.]+)/) ? 'Яндекс.Браузер ' + m(/YaBrowser\/([\d.]+)/)
    : m(/SamsungBrowser\/([\d.]+)/) ? 'Samsung Internet ' + m(/SamsungBrowser\/([\d.]+)/)
      : m(/Firefox\/([\d.]+)/) ? 'Firefox ' + m(/Firefox\/([\d.]+)/)
        : m(/Chrome\/([\d.]+)/) ? 'Chrome ' + m(/Chrome\/([\d.]+)/) : 'другой браузер';
  const os = m(/(Android [\d.]+)/) || (/iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'другая система');
  return b + ', ' + os;
}
const stepText = (x) => METHODS[x.method] + ' — ' + (x.ok ? 'без ошибки' : (x.skipped ? 'пропущен: ' : 'ошибка: ') + x.error);
const modeText = (m) => (m === 'auto' ? 'автоматически (share с файлом → прямой переход по blob-ссылке → скачивание)' : METHODS[m]);

/** Текст экрана диагностики (он же копируется кнопкой). */
export function diagText() {
  const cap = capabilities();
  const hist = diagHistory();
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  const lines = [
    'Браузер: ' + uaShort(),
    'Запущено как приложение: ' + (standalone ? 'да' : 'нет, во вкладке браузера'),
    'navigator.share: ' + cap.share,
    'navigator.canShare({files:[.ics]}): ' + (cap.canShareError ? 'ошибка — ' + cap.canShareError : tf(cap.canShareFiles)),
    'Способ в настройках: ' + modeText(calendarMode()),
    '',
  ];
  if (!hist.length) {
    lines.push('Попыток ещё не было. Нажмите «Пробная попытка».');
    return lines.join('\n');
  }
  const l = hist[0];
  const lastErr = hist.find((x) => x.error);
  lines.push(
    'Последняя попытка: ' + fmtAt(l.at),
    'Способ: ' + METHODS[l.method] + (l.mode === 'auto' ? ' (автоматически)' : l.mode === l.method ? ' (выбран вручную)' : ' (запасной; выбран: ' + METHODS[l.mode] + ')'),
    'Шаги: ' + l.steps.map(stepText).join(' → '),
    'Результат: ' + (l.ok ? 'без ошибки' : 'ошибка'),
    'На экране: ' + (l.seen ? SEEN[l.seen] : 'не отмечено'),
    'Текст последней ошибки: ' + (l.error || (lastErr ? 'в этой попытке нет; ранее (' + fmtAt(lastErr.at) + '): ' + lastErr.error : 'ошибок не было')),
    'Файл: ' + l.file + ', ' + l.bytes + ' байт, проверка .ics: ' + (l.ics === 'ok' ? 'корректен (CRLF, VCALENDAR/VEVENT, UID, PRODID, DTSTAMP, DTSTART, DTEND)' : l.ics),
    'Тип Blob: ' + (l.blobType || (l.method === 'share' ? 'не создавался (File ' + SHARE_TYPE + ')' : '—')),
    'Нажатие ещё активно (userActivation): ' + (l.activation === true ? 'да' : l.activation === false ? 'нет' : 'недоступно'),
    '',
    'История (последние ' + hist.length + '):',
  );
  hist.forEach((x, i) => {
    lines.push((i + 1) + '. ' + fmtAt(x.at) + ' — ' + METHODS[x.method] + ' — ' + (x.ok ? 'без ошибки' : 'ошибка: ' + x.error)
      + (x.seen ? ' — на экране: ' + SEEN[x.seen] : ''));
  });
  return lines.join('\n');
}

/** .ics задачи. Для закрытых областей в файле только «Встреча». */
export function sendToCalendar(t, { kind, toastHint = true } = {}) {
  const k = kind || calendarKind(t);
  if (!k) return Promise.resolve(null);
  const priv = st.isPrivate(t);
  const text = buildIcs(t, { private: priv, kind: k, now: st.clock() });
  const name = (priv ? 'vstrecha' : 'sobytie') + '-' + (t.date || t.deadline || '') + '.ics';
  return deliverIcs(text, name, priv ? 'Встреча' : t.text).then((r) => {
    if (toastHint && HINTS[r]) toast(HINTS[r], { duration: 8000 });
    return r;
  });
}

/** Какой способ сработает — чтобы заранее дать точную подсказку в общем тосте (с «Отменить»). */
export function expectedHint() {
  const mode = calendarMode();
  if (mode === 'download') return HINTS.downloaded;
  if (mode === 'link' || mode === 'nav') return HINTS.opened;
  if (!shareBlocker(capabilities())) return HINTS.shared;
  return mode === 'share' ? HINTS.downloaded : HINTS.opened;
}

/**
 * Сразу после сохранения задачи со временем (пока это ещё действие пользователя).
 * Возвращает подсказку для тоста вызывающего или null, если календарь не предлагался.
 */
export function offerCalendar(t) {
  if (!t || !autoCalendar() || !t.date || !t.time || t.status !== 'active' || (t.dateKind && t.dateKind !== 'day')) return null;
  const hint = expectedHint();
  sendToCalendar(t, { kind: 'time', toastHint: false });
  return hint;
}
