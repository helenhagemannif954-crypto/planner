// Всё, что приложение помнит, — только на этом устройстве, в localStorage.
// Никаких счётчиков и статистики: только настройки, помянник, избранное
// и указатели «где остановился» (для неповторяемости).

import { dayKey, addDays, now } from './util.js';

const KEY = 'molitvoslov.v1';

export const DEFAULT_SETTINGS = {
  fontSize: 20,          // px
  theme: 'system',       // system | light | dark
  volume: 'normal',      // short | normal | full — объём правила
  pinPsalms: true,       // Пс 62 утром, Пс 140 вечером
  hours: true,           // третий, шестой, девятый часы
  night: false,          // полунощная молитва
  noRepeatDays: 14,      // молитва не повторяется N дней
  silence: 60,           // секунд тишины
  readMode: 'normal',    // normal | slow | plain («только чтение»)
  wakeLock: true,        // не гасить экран во время молитвы
  silenceSound: false,   // мягкий звук в конце тишины
  silenceVibrate: false, // лёгкая вибрация в конце тишины
  reminders: { morning: '07:00', third: '09:00', sixth: '12:00', ninth: '15:00', evening: '18:00', sleep: '22:00' },
};

function fresh() {
  return {
    v: 1,
    settings: { ...DEFAULT_SETTINGS, reminders: { ...DEFAULT_SETTINGS.reminders } },
    names: { living: [], departed: [] },
    favorites: [],          // [{kind, id, title, ref?, saved}]
    reading: { pos: 0, day: null, shown: false },
    circle: { pos: 0, slots: {} },   // slots: {'2026-10-22:morning': {pos, shown}}
    picks: {},              // {'2026-10-22:morning:normal': {blockKey: id}}
    history: {},            // {id: 'YYYY-MM-DD'} — когда текст звучал последний раз
  };
}

let state = null;

export function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { s = null; }
  const base = fresh();
  if (!s || typeof s !== 'object') s = base;
  s.settings = { ...base.settings, ...(s.settings || {}) };
  s.settings.reminders = { ...base.settings.reminders, ...(s.settings.reminders || {}) };
  s.names = { living: [], departed: [], ...(s.names || {}) };
  for (const k of ['favorites']) if (!Array.isArray(s[k])) s[k] = [];
  for (const k of ['reading', 'circle', 'picks', 'history']) if (!s[k] || typeof s[k] !== 'object') s[k] = base[k];
  if (!s.circle.slots) s.circle.slots = {};
  state = s;
  prune();
  return state;
}

export function get() {
  return state || load();
}

let timer = null;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 50);
}

export function flush() {
  clearTimeout(timer);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('[хранилище] не сохранено', e); }
}

export function settings() {
  return get().settings;
}

export function setSetting(k, v) {
  get().settings[k] = v;
  flush();
}

// при сворачивании и закрытии — записать сразу, не дожидаясь таймера
if (typeof document !== 'undefined') {
  addEventListener('pagehide', () => { if (state) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && state) flush(); });
}

/** Убрать старые записи: выборки старше 3 дней, журнал старше 60 дней */
function prune() {
  const today = now(); // «сейчас» приложения (в проверках — из ?now=)
  const cutPick = dayKey(addDays(today, -3));
  for (const k of Object.keys(state.picks)) if (k.slice(0, 10) < cutPick) delete state.picks[k];
  for (const k of Object.keys(state.circle.slots)) if (k.slice(0, 10) < cutPick) delete state.circle.slots[k];
  const cutHist = dayKey(addDays(today, -60));
  for (const [k, d] of Object.entries(state.history)) if (d < cutHist) delete state.history[k];
}

// ——— помянник ———
export function addName(list, name) {
  name = String(name || '').trim().replace(/\s+/g, ' ');
  if (!name) return false;
  get().names[list].push(name);
  save();
  return true;
}

export function removeName(list, i) {
  get().names[list].splice(i, 1);
  save();
}

export function moveName(list, i, dir) {
  const arr = get().names[list];
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  save();
}

// ——— избранное ———
export function isFavorite(kind, id) {
  return get().favorites.some((f) => f.kind === kind && f.id === id);
}

export function toggleFavorite(item) {
  const fav = get().favorites;
  const i = fav.findIndex((f) => f.kind === item.kind && f.id === item.id);
  if (i >= 0) fav.splice(i, 1);
  else fav.unshift({ ...item, saved: dayKey(new Date()) });
  save();
  return i < 0;
}

// ——— резервная копия ———
export function exportData() {
  const { settings: st, names, favorites, reading, circle } = get();
  return JSON.stringify({ app: 'molitvoslov', v: 1, settings: st, names, favorites, reading: { pos: reading.pos }, circle: { pos: circle.pos } }, null, 2);
}

export function importData(text) {
  const d = JSON.parse(text);
  if (!d || d.app !== 'molitvoslov') throw new Error('Это не файл молитвослова');
  const s = get();
  if (d.settings) s.settings = { ...s.settings, ...d.settings };
  if (d.names) s.names = { living: d.names.living || [], departed: d.names.departed || [] };
  if (Array.isArray(d.favorites)) s.favorites = d.favorites;
  if (d.reading && Number.isInteger(d.reading.pos)) s.reading = { pos: d.reading.pos, day: null, shown: false };
  if (d.circle && Number.isInteger(d.circle.pos)) s.circle = { pos: d.circle.pos, slots: {} };
  flush();
}

/** Для тестов: начать с чистого листа */
export function reset() {
  state = fresh();
  flush();
}
