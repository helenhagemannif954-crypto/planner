// Один общий календарь (например, в Яндексе) через .ics: сразу после сохранения задачи со временем
// открывается системный выбор приложения. Для закрытых областей уходит только «Встреча».
import { toast, shareOut } from '../ui.js';
import * as st from '../store.js';
import { buildIcs } from '../ics.js';

export const CAL_HINT = 'Откройте в Яндекс.Календаре';
export const autoCalendar = () => st.settings().autoCalendar !== false;

/** .ics для задачи и системный выбор приложения (share, иначе скачивание файла). */
export function sendToCalendar(t, { kind = 'time', hint = true } = {}) {
  const priv = st.isPrivate(t);
  const ics = buildIcs(t, { private: priv, kind, now: st.clock() });
  const file = new File([ics], (priv ? 'vstrecha' : 'sobytie') + '.ics', { type: 'text/calendar' });
  if (hint) toast(CAL_HINT, { duration: 5000 });
  return shareOut({ file, title: priv ? 'Встреча' : t.text }).then((r) => {
    if (r === 'downloaded' && hint) toast('Файл готов — откройте его: ' + CAL_HINT.toLowerCase(), { duration: 6000 });
    return r;
  });
}

/**
 * Сразу после сохранения (пока браузер считает это действием пользователя) предлагаем календарь.
 * Возвращает true, если предложили — тогда вызывающий добавит подсказку в свой тост.
 */
export function offerCalendar(t) {
  if (!t || !autoCalendar() || !t.date || !t.time || t.status !== 'active' || (t.dateKind && t.dateKind !== 'day')) return false;
  sendToCalendar(t, { hint: false });
  return true;
}
