// Один общий календарь через файл .ics; приложение календаря выбирает человек (обычно Google Календарь).
// Основной способ — скачивание по НАСТОЯЩЕЙ видимой ссылке <a href="blob:…" download="…">,
// которую человек нажимает сам. Программный .click() по скрытой ссылке и «Поделиться» файлом
// по умолчанию не используются: на телефонах (Chrome на Android) первое молча блокируется,
// второе падает с NotAllowedError (.ics нет в списке разрешённых типов). Переход по blob-ссылке
// ничего не открывает: другие приложения blob-ссылку не видят.
// Остальные способы можно попробовать вручную в «Диагностике календаря»; каждая попытка
// пишется в историю (localStorage, 5 последних).
import { h, icon, hideToast, sheet } from '../ui.js';
import * as st from '../store.js';
import { buildIcs, checkIcs } from '../ics.js';
import { fmtDay } from '../dates.js';

export const STEPS = 'После скачивания внизу экрана браузера появится плашка «Открыть» — нажмите её и выберите ваше приложение календаря';
export const CHECK_HINT = 'Если календарь не предложат выбрать — после открытия проверьте, что событие создано в общем календаре, а не в личном; при необходимости перенесите его в общий календарь вручную в вашем приложении календаря';
export const autoCalendar = () => st.settings().autoCalendar !== false;
export const METHODS = {
  download: 'скачивание по нажатию на ссылку',
  share: 'share с файлом',
  link: 'ссылка <a href="blob:…" target="_blank">',
  nav: 'прямой переход по blob-ссылке',
  auto: 'скачивание программным кликом',
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
function viaAuto(text, name) {
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
    else viaAuto(text, name);
    return { method, ok: true, note: 'браузер принял ссылку' };
  } catch (e) {
    return { method, ok: false, error: errText(e), aborted: !!(e && e.name === 'AbortError') };
  }
}
function save(entry) {
  saveHistory([entry, ...diagHistory()]);
  log(entry.steps.map((x) => METHODS[x.method] + ': ' + (x.ok ? 'без ошибки' : 'ошибка — ' + x.error)).join(' → '));
  return entry;
}
const fileMeta = (text, name) => {
  const issues = checkIcs(text);
  return { file: name, bytes: new TextEncoder().encode(text).length, ics: issues.length ? issues.join('; ') : 'ok' };
};

/**
 * Ручная попытка из «Диагностики» одним способом: share | link | nav | auto (программный клик).
 * По умолчанию эти способы не используются. Возвращает запись истории.
 */
export async function tryMethod(mode, text, name, title = 'Событие') {
  const activation = navigator.userActivation ? navigator.userActivation.isActive : null;
  lastBlobType = null;
  const r = await step(mode, text, name, title);
  return save({
    at: new Date().toISOString(), mode, method: mode, ok: !!r.ok, error: r.ok ? null : r.error,
    steps: [r], activation, ...fileMeta(text, name), blobType: lastBlobType,
  });
}

/**
 * Основной способ: видимая ссылка-кнопка <a href="blob:…" download="…">. Её нажимает человек,
 * поэтому загрузку не блокируют ни Chrome, ни Яндекс.Браузер. Нажатие записывается в историю:
 * создан ли blob, было ли нажатие настоящим (isTrusted).
 */
export function calendarLink(text, name, { label = 'Добавить в календарь', cls = '.btn.primary.block.big-action', source = '', onDone } = {}) {
  let url;
  const meta = fileMeta(text, name);
  try {
    url = blobUrl(text);
  } catch (e) {
    const err = errText(e);
    save({ at: new Date().toISOString(), mode: 'download', method: 'download', ok: false, error: 'не удалось создать blob: ' + err, steps: [{ method: 'download', ok: false, error: 'не удалось создать blob: ' + err }], blobCreated: false, blobError: err, clicked: false, source, ...meta });
    return h('p.cal-hint', 'Не удалось подготовить файл: ' + err);
  }
  const blobType = lastBlobType;
  return h('a.cal-link' + cls, {
    href: url, download: name, rel: 'noopener',
    onclick: (e) => {
      save({
        at: new Date().toISOString(), mode: 'download', method: 'download', ok: true, error: null,
        steps: [{ method: 'download', ok: true, note: 'blob создан, нажатие на ссылку' + (e.isTrusted ? '' : ' (не настоящее)') }],
        blobCreated: true, clicked: true, trusted: e.isTrusted, source, ...meta, blobType,
      });
      // перерисовку — после того, как браузер начал загрузку по ссылке
      if (onDone) setTimeout(onDone, 250);
    },
  }, icon('download', 20), label);
}

/** Подсказка под кнопкой скачивания; после нажатия — та же, но заметным блоком. */
export function stepsBlock(done = true) {
  return done ? h('div.cal-steps', { role: 'status' }, icon('check', 20), h('span', STEPS)) : h('p.small.cal-hint', STEPS);
}

/** Файл события для задачи. Для закрытых областей в файле только «Встреча». */
export function taskIcs(t, kind) {
  const k = kind || calendarKind(t);
  if (!k) return null;
  const priv = st.isPrivate(t);
  return {
    text: buildIcs(t, { private: priv, kind: k, now: st.clock() }),
    name: (priv ? 'vstrecha' : 'sobytie') + '-' + (t.date || t.deadline || '') + '.ics',
    title: priv ? 'Встреча' : t.text,
  };
}

/** Лист «Добавить в календарь»: большая ссылка, после нажатия — шаги. */
export function calendarSheet(t, { kind, done = false } = {}) {
  const f = taskIcs(t, kind);
  if (!f) return null;
  let shown = done;
  return sheet((api) => h('div',
    h('p.muted', f.title + (t.date ? ' · ' + fmtDay(t.date, st.clock()) + (t.time ? ', ' + t.time : '') : '')),
    calendarLink(f.text, f.name, { label: shown ? 'Скачать файл ещё раз' : 'Добавить в календарь', source: 'sheet', onDone: () => { shown = true; api.refresh(); } }),
    stepsBlock(shown),
    h('p.muted.small.cal-hint', CHECK_HINT),
    shown ? h('button.btn.block', { onclick: () => api.close() }, 'Готово') : null,
  ), { title: 'Календарь' });
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
/** Факт последней попытки скачивания: дошло ли дело до blob и нажатия на ссылку. */
function downloadFact(hist) {
  const d = hist.find((x) => x.method === 'download');
  if (!d) return 'Попытка скачивания: ещё не было (нажмите «Скачать пробный файл»)';
  const blob = d.blobCreated === false ? 'нет — ' + (d.blobError || d.error)
    : 'да (' + (d.blobType || '—') + ', ' + d.bytes + ' байт)';
  const click = d.clicked ? 'да' + (d.trusted === false ? ', но не настоящее (isTrusted=false)' : ', настоящее (isTrusted=true)') : 'нет';
  return 'Попытка скачивания (' + fmtAt(d.at) + '): blob создан — ' + blob + '; нажатие на ссылку — ' + click;
}

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
    'Способ по умолчанию: скачивание по нажатию на ссылку <a href="blob:…" download>',
    downloadFact(hist),
    '',
  ];
  if (!hist.length) {
    lines.push('Попыток ещё не было.');
    return lines.join('\n');
  }
  const l = hist[0];
  const lastErr = hist.find((x) => x.error);
  lines.push(
    'Последняя попытка: ' + fmtAt(l.at),
    'Способ: ' + METHODS[l.method],
    'Шаги: ' + l.steps.map(stepText).join(' → '),
    'Результат: ' + (l.ok ? 'без ошибки' : 'ошибка'),
    'На экране: ' + (l.seen ? SEEN[l.seen] : 'не отмечено'),
    'Текст последней ошибки: ' + (l.error || (lastErr ? 'в этой попытке нет; ранее (' + fmtAt(lastErr.at) + '): ' + lastErr.error : 'ошибок не было')),
    'Файл: ' + l.file + ', ' + l.bytes + ' байт, проверка .ics: ' + (l.ics === 'ok' ? 'корректен (CRLF, VCALENDAR/VEVENT, UID, PRODID, DTSTAMP, DTSTART, DTEND)' : l.ics),
    'Тип Blob: ' + (l.blobType || (l.method === 'share' ? 'не создавался (File ' + SHARE_TYPE + ')' : '—')),
    ...(l.method === 'download' ? [] : ['Нажатие ещё активно (userActivation): ' + (l.activation === true ? 'да' : l.activation === false ? 'нет' : 'недоступно')]),
    '',
    'История (последние ' + hist.length + '):',
  );
  hist.forEach((x, i) => {
    lines.push((i + 1) + '. ' + fmtAt(x.at) + ' — ' + METHODS[x.method] + ' — ' + (x.ok ? 'без ошибки' : 'ошибка: ' + x.error)
      + (x.seen ? ' — на экране: ' + SEEN[x.seen] : ''));
  });
  return lines.join('\n');
}

/**
 * Сразу после сохранения задачи со временем: ссылка «В календарь» для тоста (с «Отменить»).
 * Нажимает её человек — это обычная загрузка файла. Возвращает элемент или null.
 */
export function offerCalendar(t) {
  if (!t || !autoCalendar() || !t.date || !t.time || t.status !== 'active' || (t.dateKind && t.dateKind !== 'day')) return null;
  const f = taskIcs(t, 'time');
  return calendarLink(f.text, f.name, {
    label: 'В календарь', cls: '.toast-act.toast-link', source: 'toast',
    onDone: () => { hideToast(); calendarSheet(t, { kind: 'time', done: true }); },
  });
}
