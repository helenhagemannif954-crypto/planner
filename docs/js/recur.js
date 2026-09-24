// Правила повторов. Следующий экземпляр создаётся после закрытия текущего.
import { addDays, addMonths, dow, daysInMonth, mkDate, diffDays, DOW_SHORT, MONTHS, plural } from './dates.js';

/*
 Правило:
  {kind:'daily', n?}                 — каждый день (или каждые n дней от даты задачи)
  {kind:'weekly', days:[1..7]}      — по дням недели
  {kind:'interval', n}               — раз в n дней (от плановой даты)
  {kind:'monthly', day: 1..31|'last'}— ежемесячно
  {kind:'yearly', month, day}        — ежегодно
  {kind:'after', n}                  — через n дней после выполнения
*/

function matches(rule, date) {
  switch (rule.kind) {
    case 'weekly': return (rule.days || []).includes(dow(date));
    case 'monthly': {
      const [y, m, d] = date.split('-').map(Number);
      const dim = daysInMonth(y, m);
      if (rule.day === 'last') return d === dim;
      return d === Math.min(Number(rule.day), dim);
    }
    case 'yearly': {
      const [y, m, d] = date.split('-').map(Number);
      if (m !== Number(rule.month)) return false;
      return d === Math.min(Number(rule.day), daysInMonth(y, m));
    }
    default: return true;
  }
}

/** Первое вхождение правила строго после даты after. */
export function occurrenceAfter(rule, after, base) {
  switch (rule.kind) {
    case 'daily':
    case 'interval': {
      const n = Math.max(1, Number(rule.n) || 1);
      if (n === 1 || !base) return addDays(after, 1);
      // шаг n от base
      let d = base;
      if (d > after) return d;
      const diff = diffDays(d, after);
      d = addDays(d, (Math.floor(diff / n) + 1) * n);
      return d;
    }
    case 'weekly':
    case 'monthly':
    case 'yearly': {
      let d = addDays(after, 1);
      for (let i = 0; i < 800; i++) {
        if (matches(rule, d)) return d;
        d = addDays(d, 1);
      }
      return null;
    }
    default: return addDays(after, 1);
  }
}

/** Первое вхождение правила начиная с даты from (включительно). */
export function firstOccurrence(rule, from) {
  if (rule.kind === 'daily' || rule.kind === 'interval' || rule.kind === 'after') return from;
  return matches(rule, from) ? from : occurrenceAfter(rule, from);
}

/**
 * Дата следующего экземпляра после закрытия задачи.
 * date — плановая дата текущего, doneDate — день выполнения.
 */
export function nextDate(rule, date, doneDate) {
  if (!rule) return null;
  if (rule.kind === 'after') return addDays(doneDate, Math.max(1, Number(rule.n) || 1));
  const from = !date || date < doneDate ? doneDate : date;
  return occurrenceAfter(rule, from, date);
}

export function describe(rule) {
  if (!rule) return '';
  switch (rule.kind) {
    case 'daily': return rule.n > 1 ? `раз в ${rule.n} ${plural(rule.n, 'день', 'дня', 'дней')}` : 'каждый день';
    case 'interval': return `раз в ${rule.n} ${plural(rule.n, 'день', 'дня', 'дней')}`;
    case 'weekly': {
      const d = [...(rule.days || [])].sort();
      if (d.join() === '1,2,3,4,5') return 'по будням';
      if (d.length === 7) return 'каждый день';
      return 'каждый ' + d.map((x) => DOW_SHORT[x - 1]).join(', ');
    }
    case 'monthly': return rule.day === 'last' ? 'ежемесячно, в последний день' : `ежемесячно, ${rule.day}-го`;
    case 'yearly': return `ежегодно, ${rule.day} ${MONTHS[rule.month - 1]}`;
    case 'after': return `через ${rule.n} ${plural(rule.n, 'день', 'дня', 'дней')} после выполнения`;
  }
  return '';
}

export { addMonths, mkDate };
