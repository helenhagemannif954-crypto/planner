// Хранилище IndexedDB: схема с номером версии, миграции, внутренние копии.
// Правило: обновление никогда не теряет данные — перед миграцией делается копия.

export const DB_NAME = 'planner';
export const IDB_VERSION = 1;
export const SCHEMA = 2; // версия формата данных
export const KINDS = ['tasks', 'areas', 'people', 'templates', 'groups'];
const MAX_BACKUPS = 12;

let dbp = null;

function req(r) {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function done(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('abort'));
  });
}

export function openDb(name = DB_NAME) {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(name, IDB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const k of KINDS) if (!db.objectStoreNames.contains(k)) db.createObjectStore(k, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'id' });
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('База занята другой вкладкой'));
  });
  return dbp;
}

/** Полный снимок данных в формате экспорта. */
export async function dump() {
  const db = await openDb();
  const tx = db.transaction([...KINDS, 'meta'], 'readonly');
  const data = {};
  for (const k of KINDS) data[k] = await req(tx.objectStore(k).getAll());
  const meta = await req(tx.objectStore('meta').getAll());
  data.meta = {};
  let schema = null;
  for (const m of meta) {
    if (m.key === 'schema') schema = m.value;
    else data.meta[m.key] = m.value;
  }
  return { app: 'planner', schema: schema ?? SCHEMA, exportedAt: new Date().toISOString(), data };
}

/** Полностью заменяет данные снимком (в одной транзакции). */
export async function restore(snapshot) {
  const db = await openDb();
  const tx = db.transaction([...KINDS, 'meta'], 'readwrite');
  for (const k of KINDS) {
    const s = tx.objectStore(k);
    s.clear();
    for (const v of snapshot.data[k] || []) s.put(v);
  }
  const ms = tx.objectStore('meta');
  ms.clear();
  for (const [key, value] of Object.entries(snapshot.data.meta || {})) ms.put({ key, value });
  ms.put({ key: 'schema', value: snapshot.schema });
  await done(tx);
}

export async function getSchema() {
  const db = await openDb();
  const tx = db.transaction('meta', 'readonly');
  const r = await req(tx.objectStore('meta').get('schema'));
  return r ? r.value : null;
}

export async function isEmpty() {
  const db = await openDb();
  const tx = db.transaction([...KINDS, 'meta'], 'readonly');
  for (const k of [...KINDS, 'meta']) if ((await req(tx.objectStore(k).count())) > 0) return false;
  return true;
}

// ——— внутренние копии ———
export async function saveBackup(reason, snapshot) {
  const db = await openDb();
  snapshot = snapshot || (await dump());
  const at = new Date().toISOString();
  const tx = db.transaction('backups', 'readwrite');
  const s = tx.objectStore('backups');
  s.put({ id: at + '-' + Math.random().toString(36).slice(2, 6), at, reason, snapshot });
  await done(tx);
  await pruneBackups();
}
export async function listBackups() {
  const db = await openDb();
  const tx = db.transaction('backups', 'readonly');
  const all = await req(tx.objectStore('backups').getAll());
  return all.sort((a, b) => (a.at < b.at ? 1 : -1));
}
async function pruneBackups() {
  const all = await listBackups();
  if (all.length <= MAX_BACKUPS) return;
  // храним свежие; копии «перед миграцией» и «перед импортом» живут дольше ежедневных
  const daily = all.filter((b) => b.reason === 'daily');
  const other = all.filter((b) => b.reason !== 'daily');
  const keep = new Set([...daily.slice(0, 7), ...other.slice(0, 5)].map((b) => b.id));
  const db = await openDb();
  const tx = db.transaction('backups', 'readwrite');
  for (const b of all) if (!keep.has(b.id)) tx.objectStore('backups').delete(b.id);
  await done(tx);
}

// ——— запись ———
/** ops: [{kind, op:'put'|'del', value|id}], meta ops: kind 'meta' {key, value} */
export async function write(ops) {
  if (!ops.length) return;
  const db = await openDb();
  const stores = [...new Set(ops.map((o) => o.kind))];
  const tx = db.transaction(stores, 'readwrite');
  for (const o of ops) {
    const s = tx.objectStore(o.kind);
    if (o.kind === 'meta') {
      if (o.op === 'del') s.delete(o.key);
      else s.put({ key: o.key, value: o.value });
    } else if (o.op === 'del') s.delete(o.id);
    else s.put(o.value);
  }
  await done(tx);
}

// ——— миграции ———
// Каждая функция получает снимок версии N и возвращает снимок версии N+1.
export const MIGRATIONS = {
  // Версия 1 — формат ранней сборки: задачи {id, title, done, due, area (имя), notes},
  // области {id, name, color}. Версия 2 — текущий формат.
  1: (snap) => {
    const d = snap.data;
    const areas = (d.areas || []).map((a, i) => ({
      id: a.id, name: a.name || 'Без названия', color: a.color || '#8a7a52', order: i, kind: 'duty',
      private: false, pinLock: false, synonyms: [], archived: false, endDate: null,
    }));
    const byName = new Map(areas.map((a) => [a.name.toLowerCase(), a.id]));
    const now = snap.exportedAt || new Date().toISOString();
    const tasks = (d.tasks || []).map((t) => ({
      id: t.id, text: t.title || t.text || '', areaId: t.areaId || byName.get(String(t.area || '').toLowerCase()) || null,
      date: t.due || null, dateKind: t.due ? 'day' : null, time: null, part: null, dur: null, deadline: null,
      size: null, repeat: null, ctx: null, note: t.notes || '', draft: '', checklist: [],
      status: t.done ? 'done' : 'active', doneAt: t.done ? (t.doneAt || now) : null,
      star: null, inbox: !t.due && !t.area, createdAt: t.createdAt || now, updatedAt: now, touchedAt: now,
    }));
    return { ...snap, schema: 2, data: { ...d, tasks, areas, people: d.people || [], templates: d.templates || [], groups: d.groups || [], meta: d.meta || {} } };
  },
};

export function migrateSnapshot(snap) {
  let s = snap;
  let guard = 0;
  while ((s.schema || 1) < SCHEMA) {
    const v = s.schema || 1;
    const fn = MIGRATIONS[v];
    if (!fn) throw new Error('Нет миграции с версии ' + v);
    s = fn(s);
    if (++guard > 50) throw new Error('Цикл миграций');
  }
  for (const k of KINDS) if (!Array.isArray(s.data[k])) s.data[k] = [];
  if (!s.data.meta || typeof s.data.meta !== 'object') s.data.meta = {};
  return s;
}

/** Проверяет данные при открытии и мигрирует их с копией «перед миграцией». */
export async function ensureSchema() {
  const empty = await isEmpty();
  if (empty) {
    await write([{ kind: 'meta', op: 'put', key: 'schema', value: SCHEMA }]);
    return { fresh: true };
  }
  const v = await getSchema();
  if (v === SCHEMA) return { fresh: false };
  if (v != null && v > SCHEMA) return { fresh: false, newer: true };
  const snap = await dump();
  snap.schema = v || 1;
  await saveBackup('before-migration-v' + snap.schema, snap);
  const migrated = migrateSnapshot(snap);
  await restore(migrated);
  return { fresh: false, migrated: snap.schema };
}

/** Проверка файла импорта. Возвращает {ok, snapshot, summary} или {ok:false, error}. */
export function validateImport(text) {
  if (typeof text !== 'string' || text.length > 30 * 1024 * 1024) return { ok: false, error: 'Файл слишком большой' };
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: 'Это не файл резервной копии' }; }
  if (!obj || obj.app !== 'planner' || !obj.data || typeof obj.data !== 'object') return { ok: false, error: 'Это не файл резервной копии планировщика' };
  if (typeof obj.schema !== 'number' || obj.schema < 1) return { ok: false, error: 'Неизвестная версия данных' };
  if (obj.schema > SCHEMA) return { ok: false, error: 'Файл сделан более новой версией приложения. Сначала обновите приложение.' };
  let snap;
  try { snap = migrateSnapshot(obj); } catch (e) { return { ok: false, error: 'Файл повреждён: ' + e.message }; }
  for (const k of KINDS) {
    snap.data[k] = snap.data[k].filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id.length < 100);
  }
  const t = snap.data.tasks;
  const summary = {
    exportedAt: obj.exportedAt || null,
    tasks: t.filter((x) => x.status !== 'done' && !x.deletedAt).length,
    done: t.filter((x) => x.status === 'done').length,
    areas: snap.data.areas.length,
    people: snap.data.people.length,
    templates: snap.data.templates.length,
  };
  return { ok: true, snapshot: snap, summary };
}

export async function persistStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* нет поддержки */ }
  return false;
}
