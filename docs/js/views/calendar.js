// Один общий календарь (Яндекс) через .ics. Файл скачивается обычной ссылкой-загрузкой:
// Android открывает его «на просмотр» и предлагает календари. Системное «Поделиться»
// для .ics не используем — оно показывает мессенджеры, а не календарь.
import { toast } from '../ui.js';
import * as st from '../store.js';
import { buildIcs } from '../ics.js';

export const FILE_HINT = 'Файл сохранён — откройте его из уведомлений или папки Загрузки и выберите Яндекс.Календарь';
export const autoCalendar = () => st.settings().autoCalendar !== false;

/** Какое событие получится: 'time' (со временем), 'day' (на весь день), 'deadline' (срок) или null. */
export function calendarKind(t) {
  if (!t) return null;
  if (t.date && (!t.dateKind || t.dateKind === 'day')) return t.time ? 'time' : 'day';
  if (t.deadline) return 'deadline';
  return null;
}

/** Скачивание файла обычной ссылкой (без побочных меню браузера). */
export function downloadFile(text, name, type = 'text/calendar') {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  // ссылку не отзываем сразу: на Android загрузка начинается не мгновенно
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);
}

/** .ics задачи → загрузка. Для закрытых областей в файле только «Встреча». */
export function sendToCalendar(t, { kind, toastHint = true } = {}) {
  const k = kind || calendarKind(t);
  if (!k) return false;
  const priv = st.isPrivate(t);
  downloadFile(buildIcs(t, { private: priv, kind: k, now: st.clock() }), (priv ? 'vstrecha' : 'sobytie') + '-' + (t.date || t.deadline || '') + '.ics');
  if (toastHint) toast(FILE_HINT, { duration: 8000 });
  return true;
}

/** Сразу после сохранения задачи со временем (пока это ещё действие пользователя). */
export function offerCalendar(t) {
  if (!t || !autoCalendar() || !t.date || !t.time || t.status !== 'active' || (t.dateKind && t.dateKind !== 'day')) return false;
  return sendToCalendar(t, { kind: 'time', toastHint: false });
}
export const CAL_HINT = 'файл для Яндекс.Календаря — в «Загрузках»';
