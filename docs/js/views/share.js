// Отправка и приём задач без сервера.
import { h, toast, choose, prompt, sheet, shareOut, copyText, icon } from '../ui.js';
import * as st from '../store.js';
import { S } from '../store.js';
import { encodeTask, encodeDone, decode, findCode, humanText, linkFor } from '../share.js';
import { dateLabel } from '../parse.js';
import { app } from './common.js';

export function appBase() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export async function pickContact(title = 'Кому') {
  const contacts = st.settings().contacts || [];
  const v = await choose(title, [
    ...contacts.map((c) => ({ label: c.name, value: c.id, icon: 'person' })),
    { label: 'Другому…', value: '__other' },
  ]);
  if (!v) return null;
  if (v === '__other') {
    const name = await prompt('Имя', '', { placeholder: 'Например: Отец Николай', max: 60 });
    if (!name) return null;
    return { id: null, name };
  }
  return contacts.find((c) => c.id === v) || null;
}

export async function sendTask(t) {
  if (!t) return false;
  if (st.isPrivate(t)) { toast('Задачи закрытой области не отправляются'); return false; }
  // у задачи с датой и временем другой путь — общий календарь (его видят оба)
  if (t.date || t.time) {
    const { sendToCalendar } = await import('./calendar.js');
    await sendToCalendar(t);
    return false;
  }
  const c = await pickContact('Отправить задачу');
  if (!c) return false;
  const me = st.settings().myName || '';
  const code = encodeTask(t, me);
  const url = linkFor(code, appBase(), 't');
  const text = humanText(t, me, st.clock());
  const r = await shareOut({ title: 'Задача', text, url });
  if (r === 'aborted') return false;
  const m = st.markSent(t.id, c.name);
  toast(r === 'copied' ? 'Ссылка скопирована · жду от ' + c.name : 'Отправлено · жду от ' + c.name, { action: 'Отменить', onAction: () => m.undo() });
  return true;
}

export async function reportDone(t) {
  if (!t) return;
  const me = st.settings().myName || '';
  const priv = st.isPrivate(t);
  const neutral = priv ? { ...t, text: 'Сделано' } : t;
  const code = encodeDone(neutral, me);
  const url = linkFor(code, appBase(), 'd');
  const text = priv ? 'Сделано ✓' : '✓ Сделано: ' + t.text;
  const r = await shareOut({ title: 'Сделано', text, url });
  if (r === 'copied') toast('Скопировано — вставьте в сообщение');
}

export function acceptShared(obj) {
  // запись сессии и настройка контакта — свои экраны
  if (obj.kind === 'session') { import('./session.js').then((m) => m.sessionScreen(obj)); return { type: 'session' }; }
  if (obj.kind === 'setup') { import('./session.js').then((m) => m.setupScreen(obj)); return { type: 'setup' }; }
  const r = st.receiveShared(obj);
  if (r.type === 'task') {
    toast('Во «Входящие»' + (obj.from ? ': от ' + obj.from : ''), { action: 'Отменить', onAction: () => r.undo() });
    app.go('inbox');
  } else if (r.type === 'done') {
    toast((obj.from || 'Сделано') + ': ✓ ' + (st.isPrivate(r.task) ? 'задача закрыта' : r.task.text), { action: 'Отменить', onAction: () => r.undo() });
  } else if (r.type === 'dup') toast('Эта задача уже есть');
  else toast('Задача не найдена');
  return r;
}

const inAppBrowser = () => /; wv\)|Telegram|WhatsApp|Instagram|FBAN|FBAV|VKClient|Viber|OKApp/i.test(navigator.userAgent);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

/** Обрабатывает #t=… / #d=… при открытии. Возвращает true, если была ссылка. */
export function handleHash() {
  const m = location.hash.match(/^#(t|d)=(v1\.[A-Za-z0-9_\-]+)$/);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  const obj = decode(m[2]);
  if (!obj) { toast('Ссылка повреждена'); return true; }
  const here = st.settings().onboarded;
  if (standalone() || (here && !inAppBrowser())) { acceptShared(obj); return true; }
  landing(obj, m[1] + '=' + m[2]);
  return true;
}

function landing(obj, codeFrag) {
  const code = codeFrag.slice(2);
  const when = obj.date ? dateLabel(obj.date, obj.dateKind || 'day', st.clock()) + (obj.time ? ', ' + obj.time : '') : '';
  // если задача от этого контакта ложится в закрытую область — текст не показываем и здесь
  const c = st.contactByName(obj.from);
  const hidden = obj.kind === 'session' || !!(c && st.area(c.areaId) && st.area(c.areaId).private);
  const kindLabel = { done: 'Отметка о выполнении', session: 'Запись сессии', setup: 'Настройка' }[obj.kind] || 'Задача';
  const s = sheet(() => h('div.form',
    h('div.card', { style: { margin: 0 } },
      h('div.muted.small', kindLabel + (obj.from ? ' от ' + obj.from : '')),
      h('div.t-text' + (hidden ? '.masked' : ''), hidden ? '•••' : obj.text), when && !hidden ? h('div.muted', when) : null),
    h('p.muted', 'Похоже, ссылка открылась во встроенном браузере. Чтобы задача попала в ваш планировщик, откройте её в приложении или скопируйте код и нажмите «Вставить задачу» во «Входящих».'),
    h('button.btn.primary.block', {
      onclick: async () => {
        await copyText(codeFrag);
        const u = new URL(appBase());
        u.searchParams.set('paste', '1');
        if (/Android/i.test(navigator.userAgent)) location.href = 'intent://' + u.host + u.pathname + u.search + '#Intent;scheme=https;package=com.android.chrome;end';
        else location.href = u.toString();
      },
    }, 'Открыть в приложении'),
    h('button.btn.block', { onclick: async () => { const ok = await copyText(codeFrag); toast(ok ? 'Код скопирован' : 'Не удалось скопировать'); } }, icon('copy', 18), 'Скопировать код'),
    h('button.btn.ghost.block', { onclick: () => { s.close(); acceptShared(obj); } }, 'Добавить здесь'),
    h('div.link-code', code.slice(0, 120) + (code.length > 120 ? '…' : '')),
  ), { title: 'Задача по ссылке' });
}

/** «Вставить задачу»: читает код из буфера обмена. */
export async function pasteTask() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { text = ''; }
  if (!text) {
    text = await prompt('Вставить задачу', '', { text: 'Вставьте сюда код или ссылку (долгое нажатие → «Вставить»).', multiline: true, max: 13000 });
    if (!text) return;
  }
  const code = findCode(text.slice(0, 13000));
  const obj = code && decode(code);
  if (obj) { acceptShared(obj); return; }
  // обычный текст — в поле ввода
  if (app.composer) { app.go('today'); app.composer.setText(text.slice(0, 1000)); app.composer.focusInput(); }
  else toast('Кода задачи не нашлось');
}

export { findCode, decode, S };
