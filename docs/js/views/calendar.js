// Один общий календарь (Яндекс) через .ics. Порядок попытки:
// 1) navigator.share с файлом — системное окно «Отправить в…», где есть Яндекс.Календарь;
// 2) если файлом поделиться нельзя или это упало — открыть файл в текущей вкладке (blob, без download),
//    чтобы Android сам предложил приложение для содержимого;
// 3) обычное скачивание — только если в настройках выбран способ «Скачивать файл»
//    (на случай, если на конкретном телефоне первые два способа не работают).
import { toast } from '../ui.js';
import * as st from '../store.js';
import { buildIcs } from '../ics.js';

export const HINTS = {
  shared: 'Выберите Яндекс.Календарь в списке приложений.',
  opened: 'Если вместо календаря началась загрузка: откройте Загрузки → нажмите на файл → выберите Яндекс.Календарь.',
  downloaded: 'Файл скачан в Загрузки. Откройте Загрузки → нажмите на файл → выберите Яндекс.Календарь',
};
export const CHECK_HINT = 'Если календарь не предложат выбрать — после открытия проверьте, что событие создано в общем календаре, а не в личном; при необходимости переместите его в Яндекс.Календаре вручную (долгое нажатие на событие → Переместить в календарь)';
export const autoCalendar = () => st.settings().autoCalendar !== false;
export const calendarMode = () => (st.settings().calendarMode === 'download' ? 'download' : 'auto');

export const calLog = [];
function log(msg) {
  calLog.push({ at: new Date().toISOString(), msg });
  if (calLog.length > 30) calLog.shift();
  console.info('[календарь] ' + msg);
}

/** Какое событие получится: 'time' (со временем), 'day' (на весь день), 'deadline' (срок) или null. */
export function calendarKind(t) {
  if (!t) return null;
  if (t.date && (!t.dateKind || t.dateKind === 'day')) return t.time ? 'time' : 'day';
  if (t.deadline) return 'deadline';
  return null;
}

const TYPE = 'text/calendar';

/** Шаг 2: открыть содержимое в текущей вкладке, без атрибута download. */
function openInTab(text, name) {
  // File, а не просто Blob: некоторые браузеры берут из него имя файла
  const url = URL.createObjectURL(new File([text], name, { type: TYPE }));
  window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Шаг 3 (резерв): обычное скачивание. */
export function downloadFile(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: TYPE }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);
}

/**
 * Передать .ics в календарь. Возвращает 'shared' | 'opened' | 'downloaded' | 'aborted'.
 * Вызывать прямо из обработчика нажатия: браузер разрешает «Поделиться» только сразу после действия.
 */
export async function deliverIcs(text, name, title = 'Событие') {
  if (calendarMode() === 'download') {
    downloadFile(text, name);
    log('скачивание файла (выбрано в настройках)');
    return 'downloaded';
  }
  const file = new File([text], name, { type: TYPE });
  let can = false;
  try { can = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch { can = false; }
  if (can) {
    try {
      await navigator.share({ files: [file], title });
      log('«Поделиться» с файлом: открыто системное окно');
      return 'shared';
    } catch (e) {
      // человек сам закрыл окно — ничего больше не открываем
      if (e && e.name === 'AbortError') { log('«Поделиться»: окно закрыто без выбора'); return 'aborted'; }
      log('«Поделиться» не сработало (' + ((e && e.name) || e) + ') — открываю файл во вкладке');
    }
  } else log('браузер не умеет передавать .ics через «Поделиться» — открываю файл во вкладке');
  try {
    openInTab(text, name);
    log('файл открыт во вкладке (blob, без download)');
    return 'opened';
  } catch (e) {
    log('открыть файл во вкладке не удалось (' + ((e && e.message) || e) + ') — скачиваю');
    downloadFile(text, name);
    return 'downloaded';
  }
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
  if (calendarMode() === 'download') return HINTS.downloaded;
  try {
    const f = new File(['x'], 'x.ics', { type: TYPE });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) return HINTS.shared;
  } catch { /* нет */ }
  return HINTS.opened;
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
