// Движок шаблонов-цепочек. Чистый модуль: из шаблона и якоря получает группу и шаги.
import { addDays, shiftDateTime, diffDays, toMin, plural } from './dates.js';

export const OFFSET_KINDS = [
  ['before_days', 'за N дней'],
  ['before_min', 'за N минут'],
  ['at', 'в момент якоря'],
  ['after', 'сразу после'],
  ['same_day', 'в тот же день'],
  ['after_days', 'через N дней'],
];

export function describeOffset(o, hasAnchor = true) {
  const n = Number(o.n) || 0;
  const base = hasAnchor ? '' : ' от старта';
  switch (o.kind) {
    case 'before_days': return n ? `за ${n} ${plural(n, 'день', 'дня', 'дней')}` : 'в тот же день';
    case 'before_min': return n >= 60 && n % 60 === 0 ? `за ${n / 60} ч` : `за ${n} мин`;
    case 'at': return hasAnchor ? 'в момент якоря' : 'в день старта';
    case 'after': return hasAnchor ? 'сразу после' : 'в день старта';
    case 'same_day': return hasAnchor ? 'в тот же день' : 'в день старта';
    case 'after_days': return n ? `через ${n} ${plural(n, 'день', 'дня', 'дней')}${base}` : (hasAnchor ? 'в тот же день' : 'в день старта');
  }
  return '';
}

export function describeRule(rule) {
  if (!rule || rule.kind === 'every') return 'каждый раз';
  if (rule.kind === 'first') return 'только первый раз';
  if (rule.kind === 'nth') return `каждый ${rule.n}-й раз`;
  return '';
}

/** Применяется ли шаг в цикле номер cycle (1, 2, …). */
export function stepApplies(rule, cycle) {
  if (!rule || rule.kind === 'every') return true;
  if (rule.kind === 'first') return cycle === 1;
  if (rule.kind === 'nth') {
    const n = Math.max(1, Number(rule.n) || 1);
    return cycle > 0 && cycle % n === 0;
  }
  return true;
}

/** Дата и время шага по смещению. anchor = {date, time, dur} | null; start — дата запуска. */
export function computeStep(offset, anchor, start) {
  const n = Number(offset && offset.n) || 0;
  const kind = offset ? offset.kind : 'same_day';
  if (!anchor || !anchor.date) {
    const base = start;
    if (kind === 'after_days') return { date: addDays(base, n), time: null };
    if (kind === 'before_days') return { date: base, time: null };
    return { date: base, time: null };
  }
  const { date, time } = anchor;
  const dur = Number(anchor.dur) || 0;
  switch (kind) {
    case 'before_days': return { date: addDays(date, -n), time: null };
    case 'before_min': return time ? shiftDateTime(date, time, -n) : { date, time: null };
    case 'at': return { date, time: time || null };
    case 'after': return time ? shiftDateTime(date, time, dur) : { date, time: null };
    case 'same_day': return { date, time: null, after: true };
    case 'after_days': return { date: addDays(date, n), time: null };
  }
  return { date, time: null };
}

function sortKey(t) {
  return (t.date || '9999') + ' ' + (t.time || (t.after ? '23:58' : t.isAnchor ? '' : '00:00')) + ' ' + String(t.order).padStart(3, '0');
}

export function groupTitle(tplName, personCode, cycle, detail) {
  const parts = [tplName];
  if (personCode) parts.push(personCode);
  if (detail) parts.push(detail);
  if (personCode && cycle) parts.push('№' + cycle);
  return parts.join(' · ');
}

/**
 * Создаёт группу и её задачи.
 * opts: {anchor:{date,time,dur}|null, start, person:{id,code,areaId}|null, cycle, detail, uid, now}
 */
export function instantiate(tpl, opts) {
  const uid = opts.uid;
  const cycle = opts.cycle || 1;
  const person = opts.person || null;
  const hasAnchor = !!tpl.anchor;
  const anchor = hasAnchor ? { date: opts.anchor.date, time: opts.anchor.time || null, dur: Number(opts.anchor.dur ?? tpl.anchor.dur) || 60 } : null;
  const start = opts.start || (anchor && anchor.date);
  const areaId = tpl.areaId || (person && person.areaId) || opts.areaId || null;
  const groupId = uid();
  const title = groupTitle(tpl.name, person && person.code, person ? cycle : null, opts.detail);
  const group = {
    id: groupId, templateId: tpl.id, templateName: tpl.name, title, personId: person ? person.id : null,
    cycle: person ? cycle : null, areaId, anchor, start, status: 'active', detail: opts.detail || '',
  };
  const tasks = [];
  let order = 0;
  for (const s of tpl.steps || []) {
    order++;
    if (!stepApplies(s.rule, cycle)) continue;
    const pos = computeStep(s.offset, anchor, start);
    // шаги, которые «должны были» быть до запуска, ставим на день запуска
    if (opts.today && pos.date < opts.today) { pos.date = opts.today; pos.time = null; }
    tasks.push({
      id: uid(), text: s.text, areaId, personId: group.personId, date: pos.date, dateKind: 'day', time: pos.time,
      size: s.size || null, ctx: s.ctx || null, draft: s.draft || '', draftSlot: !!(s.draftSlot || s.draft), note: '', checklist: [],
      groupId, stepOffset: { ...s.offset }, order, after: !!pos.after,
    });
  }
  if (anchor) {
    const pos = { date: anchor.date, time: anchor.time };
    tasks.push({
      id: uid(), text: tpl.anchor.label || tpl.name, areaId, personId: group.personId, date: pos.date, dateKind: 'day',
      time: pos.time, dur: anchor.dur, size: null, ctx: null, draft: '', note: '', checklist: [],
      groupId, isAnchor: true, order: 0,
    });
  }
  tasks.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  tasks.forEach((t, i) => { t.order = i + 1; delete t.after; });
  return { group, tasks };
}

/** Пересчитывает невыполненные шаги группы под новый якорь. Возвращает изменённые копии. */
export function reanchor(group, tasks, newAnchor) {
  const changed = [];
  for (const t of tasks) {
    if (t.status === 'done') continue;
    let pos;
    if (t.isAnchor) pos = { date: newAnchor.date, time: newAnchor.time || null };
    else if (t.stepOffset) pos = computeStep(t.stepOffset, newAnchor, group.start);
    else continue;
    if (pos.date !== t.date || (pos.time || null) !== (t.time || null)) {
      changed.push({ ...t, date: pos.date, time: pos.time || null, dur: t.isAnchor ? newAnchor.dur : t.dur });
    }
  }
  return changed;
}

/**
 * Предлагает смещения по фактическим датам: items = [{text, date, time, size, ctx, draft}],
 * anchor = {date, time} | null. Если якоря нет — от самой ранней даты.
 */
export function suggestOffsets(items, anchor) {
  const dated = items.filter((i) => i.date).map((i) => i.date).sort();
  const base = anchor ? anchor.date : dated[0] || null;
  return items.map((it) => {
    let offset = { kind: anchor ? 'same_day' : 'after_days', n: 0 };
    if (base && it.date) {
      const d = diffDays(base, it.date);
      if (anchor && d < 0) offset = { kind: 'before_days', n: -d };
      else if (anchor && d === 0 && it.time && anchor.time) {
        const m = toMin(anchor.time) - toMin(it.time);
        offset = m > 0 ? { kind: 'before_min', n: m } : m === 0 ? { kind: 'at', n: 0 } : { kind: 'same_day', n: 0 };
      } else if (d === 0) offset = { kind: anchor ? 'same_day' : 'after_days', n: 0 };
      else offset = { kind: 'after_days', n: d };
    }
    return { text: it.text, offset, size: it.size || 'S', ctx: it.ctx || null, draft: it.draft || '', rule: { kind: 'every' } };
  });
}
