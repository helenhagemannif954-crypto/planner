// Состояние приложения в памяти + запись в IndexedDB. Вся предметная логика здесь.
import * as db from './db.js';
import { uid, seedAreas, seedContexts, seedTemplates, COLORS } from './seed.js';
import {
  today, addDays, dow, weekStart, monthStart, diffDays, toMin, fromMin, dateTime, hm, ymd, addMonths,
} from './dates.js';
import { nextDate } from './recur.js';
import { instantiate, reanchor, suggestOffsets, groupTitle } from './chain.js';
import { churchReduction } from './church.js';
import { norm, codeKey } from './parse.js';
import { segmentsOn } from './blocks.js';

export const S = { tasks: new Map(), areas: new Map(), people: new Map(), templates: new Map(), groups: new Map(), meta: {} };
export const SIZE_MIN = { S: 15, M: 60, L: 180 };
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const f of listeners) { try { f(); } catch (e) { console.error(e); } } }

export let clock = () => new Date();
export function setClock(fn) { clock = fn; }
export const T = () => today(clock());
const iso = () => clock().toISOString();

// ——— транзакции с отменой ———
let batch = null;
function rec(key, prev) {
  if (!batch.prev.has(key)) batch.prev.set(key, prev === undefined ? undefined : structuredClone(prev));
}
export function put(kind, obj) {
  if (!batch) throw new Error('put вне change()');
  const m = S[kind];
  rec(kind + '\u0000' + obj.id, m.get(obj.id));
  obj.updatedAt = iso();
  m.set(obj.id, obj);
  batch.ops.push({ kind, op: 'put', value: obj });
  return obj;
}
export function del(kind, id) {
  if (!batch) throw new Error('del вне change()');
  const m = S[kind];
  if (!m.has(id)) return;
  rec(kind + '\u0000' + id, m.get(id));
  m.delete(id);
  batch.ops.push({ kind, op: 'del', id });
}
export function setMeta(key, value) {
  if (!batch) throw new Error('setMeta вне change()');
  rec('meta\u0000' + key, S.meta[key]);
  S.meta[key] = value;
  batch.ops.push({ kind: 'meta', op: 'put', key, value });
}
export function meta(key, dflt) {
  return S.meta[key] === undefined ? dflt : S.meta[key];
}

let queue = Promise.resolve();
export let onError = (e) => console.error(e);
export function setOnError(fn) { onError = fn; }

/**
 * Выполняет изменения синхронно в памяти и записывает их одной транзакцией.
 * Возвращает {result, undo}. Запись идёт по очереди, порядок сохраняется.
 */
export function change(fn) {
  if (batch) return { result: fn(), undo: async () => {}, saved: Promise.resolve() };
  const b = { ops: [], prev: new Map() };
  batch = b;
  let result;
  try { result = fn(); } catch (e) { batch = null; rollback(b); throw e; }
  batch = null;
  const ops = dedupe(b.ops);
  const saved = (queue = queue.then(() => db.write(ops)).catch((e) => { onError(e); throw e; }));
  saved.catch(() => {});
  emit();
  const undo = () => change(() => {
    for (const [key, prev] of b.prev) {
      const [kind, id] = key.split('\u0000');
      if (kind === 'meta') setMeta(id, prev);
      else if (prev === undefined) del(kind, id);
      else put(kind, prev);
    }
  }).saved;
  return { result, undo, saved };
}
function dedupe(ops) {
  const last = new Map();
  ops.forEach((o, i) => last.set(o.kind + '\u0000' + (o.id || o.key || (o.value && o.value.id)), i));
  return ops.filter((o, i) => last.get(o.kind + '\u0000' + (o.id || o.key || (o.value && o.value.id))) === i);
}
function rollback(b) {
  for (const [key, prev] of b.prev) {
    const [kind, id] = key.split('\u0000');
    if (kind === 'meta') S.meta[id] = prev;
    else if (prev === undefined) S[kind].delete(id);
    else S[kind].set(id, prev);
  }
}
export function flush() { return queue.catch(() => {}); }

// ——— загрузка ———
export const DEFAULT_SETTINGS = {
  myName: '', onboarded: false, contacts: [], capacity: [8, 8, 8, 8, 8, 6, 5],
  church: { enabled: true, feast: 3, eve: 2, holy: 3 }, yearStart: 9, pinHash: null, pinSalt: null,
};

export async function load() {
  const info = await db.ensureSchema();
  const snap = await db.dump();
  for (const k of db.KINDS) {
    S[k].clear();
    for (const v of snap.data[k]) S[k].set(v.id, v);
  }
  S.meta = snap.data.meta || {};
  S.meta.settings = { ...DEFAULT_SETTINGS, ...(S.meta.settings || {}) };
  if (info.fresh || !S.areas.size && !S.meta.seeded) seed();
  return info;
}

export function seed() {
  change(() => {
    const areas = seedAreas();
    for (const a of areas) put('areas', a);
    for (const t of seedTemplates(areas)) put('templates', t);
    setMeta('contexts', seedContexts());
    setMeta('settings', { ...DEFAULT_SETTINGS, ...(S.meta.settings || {}) });
    setMeta('blocks', []);
    setMeta('specialDays', []);
    setMeta('seeded', true);
  });
}

export const settings = () => S.meta.settings || DEFAULT_SETTINGS;
export function setSettings(patch) {
  return change(() => setMeta('settings', { ...settings(), ...patch }));
}

// ——— выборки ———
export const areasList = (all = false) => [...S.areas.values()].filter((a) => all || !a.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const area = (id) => (id ? S.areas.get(id) : null);
export const person = (id) => (id ? S.people.get(id) : null);
export const isPrivate = (t) => { const a = area(t && t.areaId); return !!(a && a.private); };
export const contexts = () => meta('contexts', []);
export const live = (t) => !t.deletedAt;
export const activeTasks = () => [...S.tasks.values()].filter((t) => !t.deletedAt && t.status === 'active');
export const taskMin = (t) => Number(t.dur) || SIZE_MIN[t.size] || 30;

export function sortTasks(list) {
  return list.sort((a, b) => {
    const ka = (a.time || (a.part === 'morning' ? '08:00' : a.part === 'day' ? '13:00' : a.part === 'evening' ? '18:00' : '99')) + (a.order || 0);
    const kb = (b.time || (b.part === 'morning' ? '08:00' : b.part === 'day' ? '13:00' : b.part === 'evening' ? '18:00' : '99')) + (b.order || 0);
    return ka < kb ? -1 : ka > kb ? 1 : (a.createdAt || '') < (b.createdAt || '') ? -1 : 1;
  });
}

/** Очередной шаг каждой активной группы (не якорь). */
export function nextSteps() {
  const map = new Map();
  for (const t of activeTasks()) {
    if (!t.groupId || t.isAnchor) continue;
    const cur = map.get(t.groupId);
    const k = (t.date || '9999') + (t.time || '') + String(t.order || 0).padStart(3, '0');
    if (!cur || k < cur.k) map.set(t.groupId, { t, k });
  }
  return new Map([...map].map(([g, v]) => [g, v.t]));
}

/** Проект: задача с чек-листом и сроком. */
export const isProject = (t) => !!(t.deadline && t.checklist && t.checklist.length);
export const nextItem = (t) => (t.checklist || []).find((c) => !c.done) || null;

/** Задачи дня (включая хвосты прошлых дней). */
export function tasksForDay(d, { includeOverdue = true } = {}) {
  const ns = nextSteps();
  const res = [];
  for (const t of activeTasks()) {
    if (t.waitFor) continue;
    if (t.groupId && !t.isAnchor && ns.get(t.groupId) !== t) continue;
    const onDay = t.dateKind === 'day' || !t.dateKind ? t.date === d : false;
    const overdue = includeOverdue && t.date && t.dateKind === 'day' && t.date < d;
    const starred = t.star === d;
    if (onDay || overdue || starred) res.push(t);
  }
  return sortTasks(res);
}
export function mainOf(d) {
  return activeTasks().filter((t) => t.star === d && !t.waitFor).slice(0, 3);
}

export function overdueList() {
  const d = T(), ws = weekStart(d), ms = monthStart(d);
  const ns = nextSteps();
  return activeTasks().filter((t) => {
    if (!t.date || t.waitFor) return false;
    if (t.groupId && !t.isAnchor && ns.get(t.groupId) !== t) return false;
    if (t.dateKind === 'week') return t.date < ws;
    if (t.dateKind === 'month') return t.date < ms;
    return t.date < d;
  });
}

export function inboxList() {
  return activeTasks().filter((t) => t.inbox && !t.waitFor).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export function waitingList() {
  return activeTasks().filter((t) => t.waitFor);
}
export function somedayList() {
  return [...S.tasks.values()].filter((t) => !t.deletedAt && t.status === 'someday');
}
export function doneOn(d) {
  return [...S.tasks.values()].filter((t) => !t.deletedAt && t.status === 'done' && t.doneAt && ymd(new Date(t.doneAt)) === d)
    .sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1));
}
export function doneBetween(a, b) {
  return [...S.tasks.values()].filter((t) => {
    if (t.deletedAt || t.status !== 'done' || !t.doneAt) return false;
    const d = ymd(new Date(t.doneAt));
    return d >= a && d <= b;
  }).sort((x, y) => (x.doneAt < y.doneAt ? 1 : -1));
}
export function deadlines(days = 60) {
  const d = T();
  return activeTasks().filter((t) => t.deadline && diffDays(d, t.deadline) <= days).sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
}
export function groupTasks(gid) {
  return [...S.tasks.values()].filter((t) => t.groupId === gid && !t.deletedAt).sort((a, b) => (a.order || 0) - (b.order || 0));
}

// ——— задачи ———
export function newTask(f = {}) {
  const now = iso();
  return {
    id: uid(), text: '', areaId: null, personId: null, date: null, dateKind: null, time: null, part: null, dur: null,
    deadline: null, size: null, repeat: null, ctx: null, note: '', draft: '', checklist: [], from: null, srcId: null,
    shareId: null, waitFor: null, star: null, status: 'active', doneAt: null, inbox: false, groupId: null,
    isAnchor: false, stepOffset: null, order: 0, createdAt: now, updatedAt: now, touchedAt: now, deletedAt: null,
    ...f,
  };
}

export function addTask(fields) {
  const t = newTask(fields);
  if (t.date && !t.dateKind) t.dateKind = 'day';
  if (t.inbox === undefined || fields.inbox === undefined) t.inbox = !t.date && !t.areaId && !t.deadline && !t.groupId && !t.personId;
  return change(() => put('tasks', t));
}

export function updateTask(id, patch) {
  const t = S.tasks.get(id);
  if (!t) return null;
  return change(() => {
    const n = { ...t, ...patch, touchedAt: iso() };
    if ('date' in patch && patch.date && !patch.dateKind && !t.dateKind) n.dateKind = 'day';
    if ('date' in patch && !patch.date) n.dateKind = null;
    if (n.inbox && (n.date || n.areaId || n.deadline) && !('inbox' in patch)) n.inbox = false;
    if (n.status === 'someday' && n.date) n.status = 'active';
    // перенос якоря сдвигает цепочку
    if (t.isAnchor && t.groupId && (('date' in patch && patch.date !== t.date) || ('time' in patch && patch.time !== t.time) || ('dur' in patch && patch.dur !== t.dur))) {
      put('tasks', n);
      shiftChain(t.groupId, { date: n.date, time: n.time, dur: n.dur });
      return n;
    }
    return put('tasks', n);
  });
}

function shiftChain(gid, anchor) {
  const g = S.groups.get(gid);
  if (!g) return;
  const tasks = groupTasks(gid);
  for (const c of reanchor(g, tasks, anchor)) put('tasks', { ...S.tasks.get(c.id), date: c.date, time: c.time, dur: c.dur });
  put('groups', { ...g, anchor: { ...anchor } });
}

export function moveAnchor(gid, anchor) {
  const a = groupTasks(gid).find((t) => t.isAnchor);
  if (!a) return null;
  return updateTask(a.id, { date: anchor.date, time: anchor.time, dur: anchor.dur ?? a.dur });
}

/** Закрытие задачи. Возвращает {undo, info:{next, groupDone, from, projectStep}} */
export function completeTask(id, opts = {}) {
  const t = S.tasks.get(id);
  if (!t) return null;
  const info = {};
  const res = change(() => {
    const d = T();
    // проект: закрываем очередной шаг чек-листа, если просили
    if (opts.step && isProject(t)) {
      const item = nextItem(t);
      if (item) {
        const checklist = t.checklist.map((c) => (c.id === item.id ? { ...c, done: true, doneAt: iso() } : c));
        put('tasks', { ...t, checklist, touchedAt: iso() });
        info.projectStep = item;
        if (checklist.some((c) => !c.done)) return;
        info.projectDoneSteps = true;
        return;
      }
    }
    put('tasks', { ...t, status: 'done', doneAt: iso(), inbox: false, touchedAt: iso() });
    if (t.repeat) {
      const nd = nextDate(t.repeat, t.date, d);
      if (nd) {
        const n = newTask({
          ...t, id: uid(), date: nd, dateKind: 'day', status: 'active', doneAt: null, star: null, inbox: false,
          checklist: (t.checklist || []).map((c) => ({ ...c, done: false, doneAt: null })), createdAt: iso(),
        });
        put('tasks', n);
        info.next = n;
      }
    }
    if (t.groupId) {
      const g = S.groups.get(t.groupId);
      const rest = groupTasks(t.groupId).filter((x) => x.status === 'active');
      if (g && !rest.length) {
        put('groups', { ...g, status: 'done', doneAt: iso() });
        info.groupDone = g;
        const p = person(g.personId);
        if (p && p.status === 'active') {
          if (!p.schedule) setMeta('askNext', [...meta('askNext', []).filter((x) => x !== g.id), g.id]);
        }
      }
    }
    if (t.from && t.srcId) info.from = t.from;
  });
  if (info.groupDone) ensureScheduledCycles();
  return { ...res, info };
}

export function uncompleteTask(id) {
  const t = S.tasks.get(id);
  if (!t) return null;
  return change(() => put('tasks', { ...t, status: 'active', doneAt: null }));
}

export function deleteTask(id) {
  const t = S.tasks.get(id);
  if (!t) return null;
  return change(() => put('tasks', { ...t, deletedAt: iso() }));
}

export function moveTasks(ids, date, dateKind = 'day') {
  return change(() => {
    for (const id of ids) {
      const t = S.tasks.get(id);
      if (!t) continue;
      if (t.isAnchor && t.groupId && date) {
        put('tasks', { ...t, date, touchedAt: iso() });
        shiftChain(t.groupId, { date, time: t.time, dur: t.dur });
        continue;
      }
      put('tasks', {
        ...t, date, dateKind: date ? dateKind : null, inbox: false, touchedAt: iso(),
        status: t.status === 'someday' && date ? 'active' : t.status,
        star: t.star && date ? (t.star < date ? null : t.star) : t.star,
      });
    }
  });
}

/** «Главное»: не больше трёх на день. Возвращает {full:[…]} если места нет. */
export function setStar(id, on, d = T()) {
  const t = S.tasks.get(id);
  if (!t) return null;
  if (!on) return change(() => put('tasks', { ...t, star: null }));
  const cur = mainOf(d).filter((x) => x.id !== id);
  if (cur.length >= 3) return { full: cur };
  return change(() => {
    const patch = { ...t, star: d, inbox: false, touchedAt: iso() };
    if (!t.date || t.date > d || t.dateKind !== 'day') { patch.date = d; patch.dateKind = 'day'; }
    put('tasks', patch);
  });
}
export function swapStar(removeId, addId, d = T()) {
  return change(() => {
    const a = S.tasks.get(removeId), b = S.tasks.get(addId);
    if (a) put('tasks', { ...a, star: null });
    if (b) put('tasks', { ...b, star: d, date: b.date && b.date <= d && b.dateKind === 'day' ? b.date : d, dateKind: 'day', inbox: false });
  });
}

/** Утренняя карточка: перенести всё на сегодня. */
export function carryAll(ids) {
  const d = T();
  return change(() => {
    let stars = mainOf(d).length;
    for (const id of ids) {
      const t = S.tasks.get(id);
      if (!t) continue;
      let star = null;
      if (t.star && t.star < d && stars < 3) { star = d; stars++; }
      if (t.isAnchor && t.groupId) { put('tasks', { ...t, date: d, star }); shiftChain(t.groupId, { date: d, time: t.time, dur: t.dur }); continue; }
      put('tasks', { ...t, date: d, dateKind: 'day', star: star || (t.star === d ? d : null) });
    }
  });
}
/** Отпустить: обычные задачи — в «Когда-нибудь», шаги цепочек — на сегодня. */
export function releaseAll(ids) {
  const d = T();
  return change(() => {
    for (const id of ids) {
      const t = S.tasks.get(id);
      if (!t) continue;
      if (t.groupId || t.repeat) put('tasks', { ...t, date: d, dateKind: 'day' });
      else put('tasks', { ...t, status: 'someday', date: null, dateKind: null, star: null, time: null, part: null });
    }
  });
}

/** Тихий уход в «Когда-нибудь»: без даты и срока, не тронуты 30 дней. */
export function sweepSomeday() {
  const limit = new Date(clock().getTime() - 30 * 86400000).toISOString();
  const list = activeTasks().filter((t) => !t.date && !t.deadline && !t.groupId && !t.repeat && !t.star && !t.waitFor && (t.touchedAt || t.createdAt) < limit);
  if (!list.length) return 0;
  change(() => { for (const t of list) put('tasks', { ...t, status: 'someday', inbox: false }); });
  return list.length;
}

// ——— области, люди, контексты ———
export function saveArea(a) {
  return change(() => put('areas', { ...a }));
}
export function newArea(name) {
  const list = areasList(true);
  return {
    id: uid(), name, kind: 'duty', private: false, pinLock: false, synonyms: [], color: COLORS[list.length % COLORS.length],
    order: list.length, archived: false, endDate: null,
  };
}
export function savePerson(p) { return change(() => put('people', { ...p })); }
export function newPerson(f = {}) {
  const n = S.people.size;
  return { id: uid(), code: '', areaId: null, color: COLORS[(n + 3) % COLORS.length], counter: 0, templateId: null, schedule: null, note: '', status: 'active', createdAt: iso(), ...f };
}
export function findPersonByCode(code) {
  const k = codeKey(code);
  return [...S.people.values()].find((p) => codeKey(p.code) === k) || null;
}
export const peopleOf = (areaId) => [...S.people.values()].filter((p) => p.areaId === areaId).sort((a, b) => a.code.localeCompare(b.code, 'ru'));
export const templatesList = () => [...S.templates.values()].filter((t) => !t.deletedAt).sort((a, b) => a.name.localeCompare(b.name, 'ru'));

// ——— шаблоны-цепочки ———
export function launchTemplate(tplId, { anchor, personId, detail, start } = {}) {
  const tpl = S.templates.get(tplId);
  if (!tpl) return null;
  let out;
  const r = change(() => {
    let p = personId ? S.people.get(personId) : null;
    let cycle;
    if (p) {
      cycle = (Number(p.counter) || 0) + 1;
      p = { ...p, counter: cycle, status: p.status === 'done' ? 'active' : p.status };
      put('people', p);
    } else {
      cycle = (Number(tpl.runs) || 0) + 1;
    }
    put('templates', { ...tpl, runs: (Number(tpl.runs) || 0) + 1 });
    const res = instantiate(tpl, { anchor, start: start || (anchor && anchor.date) || T(), person: p, cycle, detail, uid, areaId: p && p.areaId, today: T() });
    res.group.createdAt = iso();
    put('groups', res.group);
    for (const t of res.tasks) put('tasks', newTask({ ...t, inbox: false }));
    out = res;
  });
  return { ...r, group: out.group, tasks: out.tasks };
}

/** Отмена якоря. mode: 'delete' — удалить шаги, 'keep' — оставить шаги обычными задачами. */
export function cancelAnchor(gid, mode) {
  const g = S.groups.get(gid);
  if (!g) return null;
  return change(() => {
    for (const t of groupTasks(gid)) {
      if (t.status === 'done') continue;
      if (t.isAnchor || mode === 'delete') put('tasks', { ...t, deletedAt: iso() });
      else put('tasks', { ...t, groupId: null, stepOffset: null });
    }
    put('groups', { ...g, status: 'cancelled' });
    const p = person(g.personId);
    if (p && g.cycle === p.counter) put('people', { ...p, counter: Math.max(0, (p.counter || 0) - 1) });
  });
}

/** Ближайший слот регулярного расписания человека (строго в будущем). */
export function nextSlot(schedule, after = clock()) {
  let d = today(after);
  for (let i = 0; i < 15; i++) {
    if (dow(d) === Number(schedule.dow)) {
      const dt = dateTime(d, schedule.time || '12:00');
      if (dt > after) return { date: d, time: schedule.time || null };
    }
    d = addDays(d, 1);
  }
  return null;
}

/** Для людей с регулярным расписанием держим ровно один будущий цикл. */
export function ensureScheduledCycles() {
  const created = [];
  const d = T();
  for (const p of S.people.values()) {
    if (p.status !== 'active' || !p.schedule || !p.templateId) continue;
    const tpl = S.templates.get(p.templateId);
    if (!tpl || !tpl.anchor) continue;
    const future = [...S.groups.values()].some((g) => g.personId === p.id && g.status === 'active' && g.anchor && g.anchor.date >= d);
    if (future) continue;
    const slot = nextSlot(p.schedule);
    if (!slot) continue;
    const r = launchTemplate(p.templateId, { anchor: { date: slot.date, time: slot.time, dur: tpl.anchor.dur }, personId: p.id });
    if (r) created.push(r.group);
  }
  return created;
}

export function dismissAskNext(gid) {
  return change(() => setMeta('askNext', meta('askNext', []).filter((x) => x !== gid)));
}

/** Черновик шаблона из задачи с чек-листом или из пройденной цепочки. */
export function templateDraftFrom(source) {
  if (source.groupId || source.templateId) {
    const g = source.templateId ? source : S.groups.get(source.groupId);
    const tasks = groupTasks(g.id);
    const anchorT = tasks.find((t) => t.isAnchor);
    const anchor = anchorT ? { date: anchorT.date, time: anchorT.time } : null;
    const steps = suggestOffsets(tasks.filter((t) => !t.isAnchor).map((t) => ({
      text: t.text, date: t.doneAt ? ymd(new Date(t.doneAt)) : t.date, time: t.time, size: t.size, ctx: t.ctx, draft: t.draft,
    })), anchor);
    const orig = S.templates.get(g.templateId);
    return {
      id: uid(), name: (orig ? orig.name : g.templateName) + ' (копия)', areaId: g.areaId, synonyms: [],
      anchor: anchorT ? { label: anchorT.text, dur: anchorT.dur || 60 } : null,
      steps: steps.map((s) => ({ ...s, id: uid() })),
    };
  }
  const t = source;
  const anchorDate = t.deadline || t.date || null;
  const items = (t.checklist || []).map((c) => ({ text: c.text, date: c.doneAt ? ymd(new Date(c.doneAt)) : null }));
  const steps = suggestOffsets(items, anchorDate ? { date: anchorDate } : null);
  return {
    id: uid(), name: t.text.slice(0, 60), areaId: t.areaId || null, synonyms: [],
    anchor: anchorDate ? { label: t.text.slice(0, 60), dur: Number(t.dur) || 60 } : null,
    steps: steps.map((s) => ({ ...s, id: uid() })),
  };
}
export function saveTemplate(tpl) { return change(() => put('templates', { ...tpl })); }

// ——— нагрузка ———
/** Части постоянных блоков на дату (многодневный блок даёт часть на каждый затронутый день). */
export function blocksOn(d) {
  return segmentsOn(meta('blocks', []), dow(d), (b) => blockDur(b.areaId));
}
export function addBlocks(list) {
  return change(() => setMeta('blocks', [...meta('blocks', []), ...list]));
}
/** Длительность блока без окончания — по умолчанию для области (изначально 1 час). */
export const blockDur = (areaId) => Number((area(areaId) || {}).blockDur) || 60;

/** Задачи со временем на дату: [{t, a, b}] в минутах суток; без окончания — точка (a === b). */
export function timedOn(d, { activeOnly = true } = {}) {
  const res = [];
  for (const t of S.tasks.values()) {
    if (t.deletedAt || !t.time || t.waitFor || t.status === 'someday') continue;
    if (activeOnly && t.status !== 'active') continue;
    if (t.dateKind && t.dateKind !== 'day') continue;
    const a = toMin(t.time), dur = Number(t.dur) || 0;
    if (t.date === d) res.push({ t, a, b: Math.min(a + dur, 1440), cut: a + dur > 1440 });
    else if (t.date < d && a + dur > 1440) {
      // многодневная задача: часть, попадающая на этот день
      const off = diffDays(t.date, d) * 1440;
      if (a + dur > off) res.push({ t, a: 0, b: Math.min(a + dur - off, 1440), cont: true, cut: a + dur - off > 1440 });
    }
  }
  return res.sort((x, y) => x.a - y.a);
}

export function capacityOf(d) {
  const st = settings();
  const base = Number((st.capacity || [])[dow(d) - 1] ?? 8);
  const red = churchReduction(d, st.church, meta('specialDays', []));
  return Math.max(0, base - red) * 60;
}
export function loadOf(d) {
  let m = 0;
  for (const b of blocksOn(d)) m += b.min;
  for (const t of S.tasks.values()) {
    if (t.deletedAt || t.status === 'someday' || t.waitFor || t.time) continue;
    if (t.date === d && (t.dateKind === 'day' || !t.dateKind)) m += taskMin(t);
  }
  // со временем: отрезок — его часть в этот день (многодневные делятся по дням), точка — оценка усилия
  for (const x of timedOn(d, { activeOnly: false })) m += x.b > x.a ? x.b - x.a : x.cont ? 0 : taskMin(x.t);
  const cap = capacityOf(d);
  const ratio = cap ? m / cap : m ? 2 : 0;
  return { min: m, cap, ratio, level: ratio < 0.75 ? 'ok' : ratio <= 1 ? 'busy' : 'over' };
}

/** Проверка перегруза для набора новых задач (например, при запуске цепочки). */
export function overloadFor(tasks) {
  const add = new Map();
  for (const t of tasks) if (t.date) add.set(t.date, (add.get(t.date) || 0) + taskMin(t));
  const over = [];
  for (const [d, m] of add) {
    const l = loadOf(d);
    if (l.min + m > l.cap && l.cap > 0) over.push(d);
  }
  return over.sort();
}

/** Свободные окна дня между постоянными блоками и задачами со временем. */
export function freeWindows(d, from = '07:00', to = '22:00') {
  const busy = [];
  for (const b of blocksOn(d)) busy.push([toMin(b.start), toMin(b.end)]);
  // время задачи — начало; без окончания задача — точка и времени не занимает
  for (const x of timedOn(d)) if (x.b > x.a) busy.push([x.a, x.b]);
  busy.sort((a, b) => a[0] - b[0]);
  let cur = toMin(from);
  const end = toMin(to);
  if (d === T()) {
    const n = clock();
    cur = Math.max(cur, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15);
  }
  const res = [];
  for (const [a, b] of busy) {
    if (a - cur >= 30) res.push([cur, Math.min(a, end)]);
    cur = Math.max(cur, b);
    if (cur >= end) break;
  }
  if (end - cur >= 30) res.push([cur, end]);
  return res.filter(([a, b]) => b - a >= 30).map(([a, b]) => ({ start: fromMin(a), end: fromMin(b), min: b - a }));
}

/**
 * С чем пересекается период (начало — обязательно, конец — нет; без конца это точка).
 * Возвращает [{kind:'block'|'task', label, date, start, end}].
 */
export function overlapsFor(startDate, startTime, endDate, endTime, { exclude = [] } = {}) {
  const S0 = dateTime(startDate, startTime || '00:00').getTime();
  let E0 = endDate || endTime ? dateTime(endDate || startDate, endTime || startTime || '23:59').getTime() : S0;
  if (E0 < S0) E0 = S0;
  const hits = [];
  const hit = (a, b) => (E0 > S0 ? (b > a ? a < E0 && b > S0 : a >= S0 && a < E0) : (b > a ? S0 >= a && S0 < b : S0 === a));
  const seen = new Set();
  for (let d = startDate, i = 0; d <= today(new Date(E0)) && i < 8; d = addDays(d, 1), i++) {
    const base = dateTime(d, '00:00').getTime();
    for (const g of blocksOn(d)) {
      const a = base + toMin(g.start) * 60000, b = base + toMin(g.end) * 60000;
      if (hit(a, b) && !seen.has('b' + g.id)) {
        seen.add('b' + g.id);
        hits.push({ kind: 'block', label: g.title || (area(g.areaId) || {}).name || 'Постоянный блок', date: d, start: g.start, end: g.end, block: g.block });
      }
    }
    for (const x of timedOn(d)) {
      if (exclude.includes(x.t.id) || seen.has(x.t.id)) continue;
      const a = base + x.a * 60000, b = base + x.b * 60000;
      if (hit(a, b)) {
        seen.add(x.t.id);
        hits.push({ kind: 'task', label: x.t.text, task: x.t, date: x.t.date, start: x.t.time, end: x.t.dur ? hm(new Date(dateTime(x.t.date, x.t.time).getTime() + x.t.dur * 60000)) : null });
      }
    }
  }
  return hits;
}

// ——— обмен ———
export const receivedKey = (obj) => norm(obj.from || '?') + ':' + obj.id;
export const wasReceived = (obj) => meta('received', []).includes(receivedKey(obj));
export const contactByName = (name) => (settings().contacts || []).find((c) => norm(c.name) === norm(name)) || null;
export const privateAreas = () => areasList().filter((a) => a.private);

/** Минуты между началом и окончанием записи сессии (null — окончания нет). */
export function spanMin(start, end) {
  if (!end || !start.time) return null;
  if (!end.time && end.date === start.date) return null;
  const a = dateTime(start.date, start.time), b = dateTime(end.date, end.time || start.time);
  const m = Math.round((b - a) / 60000);
  return m > 0 ? m : null;
}

/** Куда ляжет запись сессии: контакт, область, человек, шаблон. */
export function sessionTargets(obj) {
  const contact = contactByName(obj.from);
  const person = obj.client ? findPersonByCode(obj.client) : null;
  const anchored = templatesList().filter((t) => t.anchor);
  const byName = (list) => list.find((t) => /сесс|консульт/i.test(t.name + ' ' + (t.synonyms || []).join(' '))) || null;
  const areaId = (contact && contact.areaId) || null;
  let tpl = person && person.templateId ? S.templates.get(person.templateId) : null;
  if (!tpl || tpl.deletedAt) tpl = byName(anchored.filter((t) => area(t.areaId) && area(t.areaId).private)) || byName(anchored) || null;
  const a = area(areaId);
  // новый клиент — всегда в закрытую область
  const privArea = (a && a.private && a) || (tpl && area(tpl.areaId) && area(tpl.areaId).private && area(tpl.areaId)) || privateAreas()[0] || null;
  return { contact, areaId: areaId || (tpl && tpl.areaId) || (privArea && privArea.id) || null, person, tpl, privArea };
}

/**
 * Запись сессии сразу в план (минуя «Входящие»): якорь цепочки или задача со временем.
 * when = {start:{date,time}, end:{date,time}|null}; opts.createPerson — создать человека по коду.
 */
export function addSession(obj, when, opts = {}) {
  const tg = sessionTargets(obj);
  let out = null;
  const r = change(() => {
    let p = tg.person;
    if (!p && opts.createPerson && obj.client && tg.privArea) {
      p = newPerson({ code: obj.client, areaId: tg.privArea.id, templateId: tg.tpl ? tg.tpl.id : null });
      put('people', p);
    }
    const dur = spanMin(when.start, when.end);
    if (tg.tpl) {
      const res = launchTemplate(tg.tpl.id, { anchor: { date: when.start.date, time: when.start.time, dur: dur || tg.tpl.anchor.dur }, personId: p ? p.id : null });
      out = { group: res.group, tasks: res.tasks };
    } else {
      const t = newTask({
        text: 'Сессия' + (obj.client ? ' · ' + obj.client : ''), date: when.start.date, dateKind: 'day', time: when.start.time,
        dur, areaId: (p && p.areaId) || tg.areaId, personId: p ? p.id : null, from: { name: obj.from || '' }, srcId: obj.id, isAnchor: false,
      });
      put('tasks', t);
      out = { task: t, tasks: [t] };
    }
    setMeta('received', [...meta('received', []), receivedKey(obj)].slice(-2000));
  });
  return { ...r, ...out };
}

/** «Не сейчас» — запись сессии сохраняется во «Входящие», чтобы не потерялась. */
export function sessionToInbox(obj) {
  const tg = sessionTargets(obj);
  const t = newTask({
    text: 'Сессия' + (obj.client ? ' · ' + obj.client : ''), date: obj.start.date, dateKind: 'day', time: obj.start.time,
    dur: spanMin(obj.start, obj.end), inbox: true, areaId: (tg.privArea && tg.privArea.id) || tg.areaId,
    from: { name: obj.from || '' }, srcId: obj.id, personId: tg.person ? tg.person.id : null,
  });
  return change(() => {
    put('tasks', t);
    setMeta('received', [...meta('received', []), receivedKey(obj)].slice(-2000));
  });
}

/** «Скрыть»: переносит пришедшую задачу в закрытую область. */
export function hideTask(id, areaId) {
  const t = S.tasks.get(id);
  if (!t) return null;
  return change(() => put('tasks', { ...t, areaId, touchedAt: iso() }));
}

export function receiveShared(obj) {
  const key = receivedKey(obj);
  const received = meta('received', []);
  if (obj.kind === 'done') {
    const t = [...S.tasks.values()].find((x) => (x.shareId === obj.id || x.id === obj.id) && x.waitFor);
    if (!t) return { type: 'unknown' };
    if (t.status === 'done') return { type: 'dup', task: t };
    const r = change(() => put('tasks', { ...t, status: 'done', doneAt: iso(), doneBy: obj.from || t.waitFor }));
    return { type: 'done', task: t, undo: r.undo };
  }
  if (received.includes(key) || [...S.tasks.values()].some((x) => x.srcId === obj.id && norm(x.from && x.from.name) === norm(obj.from))) {
    return { type: 'dup' };
  }
  const contact = (settings().contacts || []).find((c) => norm(c.name) === norm(obj.from));
  const t = newTask({
    text: obj.text, date: obj.date, dateKind: obj.date ? obj.dateKind || 'day' : null, time: obj.time, part: obj.part,
    dur: obj.dur, deadline: obj.deadline, size: obj.size, note: obj.note, draft: obj.draft,
    checklist: obj.checklist.map((x) => ({ id: uid(), text: x, done: false })),
    from: { name: obj.from || 'без имени' }, srcId: obj.id, inbox: true, areaId: contact ? contact.areaId || null : null,
  });
  const r = change(() => {
    put('tasks', t);
    setMeta('received', [...received, key].slice(-2000));
  });
  return { type: 'task', task: t, undo: r.undo };
}

export function markSent(id, contactName) {
  const t = S.tasks.get(id);
  if (!t) return null;
  return change(() => put('tasks', { ...t, shareId: t.shareId || t.id, waitFor: contactName, inbox: false, star: null }));
}

// ——— резервные копии ———
export async function exportSnapshot() {
  await flush();
  return db.dump();
}
export function markExported() {
  return change(() => setMeta('lastExport', iso()));
}
export async function importSnapshot(snap) {
  await flush();
  await db.saveBackup('before-import');
  await db.restore(snap);
  await load();
  emit();
}
export async function restoreBackup(b) {
  await flush();
  await db.saveBackup('before-restore');
  const s = db.migrateSnapshot(b.snapshot);
  await db.restore(s);
  await load();
  emit();
}
export async function dailyBackup() {
  const d = T();
  if (meta('lastDailyBackup') === d) return;
  await flush();
  if (!S.tasks.size) return;
  await db.saveBackup('daily');
  change(() => setMeta('lastDailyBackup', d));
}

// ——— PIN ———
export async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(salt + ':' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function setPin(pin) {
  const salt = uid();
  const hash = pin ? await hashPin(pin, salt) : null;
  return setSettings({ pinHash: hash, pinSalt: pin ? salt : null });
}
export async function checkPin(pin) {
  const st = settings();
  if (!st.pinHash) return true;
  return (await hashPin(pin, st.pinSalt)) === st.pinHash;
}

export { uid, groupTitle, addMonths, monthStart, hm };
