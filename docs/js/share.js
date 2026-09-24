// Обмен задачами без сервера: данные только во фрагменте ссылки после #.
import { fmtDay, MONTHS } from './dates.js';
import { dateLabel, partLabel } from './parse.js';

export const MAX_CODE = 12000;
const LIM = { text: 500, note: 3000, draft: 3000, item: 300, items: 40, name: 60 };

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Проверяет и обрезает входящие данные задачи. Возвращает чистый объект или null. */
export function sanitizeShared(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const text = str(o.text, LIM.text).trim();
  const id = str(o.id, 40).replace(/[^\w\-]/g, '');
  if (!text || !id) return null;
  const res = {
    kind: o.kind === 'done' ? 'done' : 'task',
    id, text,
    from: str(o.from, LIM.name).trim(),
    date: isDate(o.date) ? o.date : null,
    dateKind: ['day', 'week', 'month'].includes(o.dateKind) ? o.dateKind : (isDate(o.date) ? 'day' : null),
    time: isTime(o.time) ? o.time : null,
    part: ['morning', 'day', 'evening'].includes(o.part) ? o.part : null,
    dur: Number.isInteger(o.dur) && o.dur > 0 && o.dur <= 24 * 60 ? o.dur : null,
    deadline: isDate(o.deadline) ? o.deadline : null,
    size: ['S', 'M', 'L'].includes(o.size) ? o.size : null,
    note: str(o.note, LIM.note),
    draft: str(o.draft, LIM.draft),
    checklist: Array.isArray(o.checklist) ? o.checklist.slice(0, LIM.items).map((x) => str(x, LIM.item).trim()).filter(Boolean) : [],
  };
  return res;
}

export function encodeTask(task, fromName) {
  const o = {
    v: 1, kind: 'task', id: task.shareId || task.id, from: fromName || '', text: task.text,
    date: task.date || undefined, dateKind: task.date ? task.dateKind || 'day' : undefined,
    time: task.time || undefined, part: task.part || undefined, dur: task.dur || undefined,
    deadline: task.deadline || undefined, size: task.size || undefined,
    note: task.note || undefined, draft: task.draft || undefined,
    checklist: (task.checklist || []).filter((c) => !c.done).map((c) => c.text),
  };
  if (!o.checklist.length) delete o.checklist;
  return 'v1.' + b64urlEncode(JSON.stringify(o));
}

export function encodeDone(task, fromName) {
  const o = { v: 1, kind: 'done', id: task.srcId || task.id, from: fromName || '', text: task.text };
  return 'v1.' + b64urlEncode(JSON.stringify(o));
}

/** Извлекает код из ссылки, фрагмента или произвольного текста. */
export function findCode(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/(?:#|^|\s)(t|d)=(v1\.[A-Za-z0-9_\-]{8,12000})/) || text.match(/(^|\s)(v1\.[A-Za-z0-9_\-]{20,12000})(?=\s|$)/);
  if (!m) return null;
  return m[2] || null;
}

export function decode(code) {
  if (typeof code !== 'string' || code.length > MAX_CODE || !code.startsWith('v1.')) return null;
  try {
    const obj = JSON.parse(b64urlDecode(code.slice(3)));
    return sanitizeShared(obj);
  } catch {
    return null;
  }
}

export function linkFor(code, base, kind = 't') {
  return base.replace(/#.*$/, '') + '#' + kind + '=' + code;
}

/** Человеческий текст к ссылке. */
export function humanText(task, fromName, now = new Date()) {
  const lines = [];
  let when = '';
  if (task.date) when = dateLabel(task.date, task.dateKind || 'day', now);
  if (task.time) when += (when ? ', ' : '') + 'в ' + task.time;
  else if (task.part) when += (when ? ', ' : '') + partLabel(task.part);
  lines.push((fromName ? fromName + ': ' : '') + task.text + (when ? ' — ' + when : ''));
  if (task.deadline) lines.push('Срок: ' + fmtDay(task.deadline, now));
  const items = (task.checklist || []).filter((c) => !c.done);
  if (items.length) lines.push(items.map((c) => '— ' + c.text).join('\n'));
  if (task.note) lines.push(task.note.slice(0, 500));
  return lines.join('\n');
}

export { MONTHS };
