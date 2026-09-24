// Выбор области, человека, повтора, контекста, шаблона.
import { h, sheet, choose, prompt } from '../ui.js';
import * as st from '../store.js';
import { S } from '../store.js';
import { DOW_SHORT, MONTHS } from '../dates.js';
import { describe as describeRepeat } from '../recur.js';
import { hiddenArea } from './common.js';

export async function pickArea(current, opts = {}) {
  const list = st.areasList();
  const v = await choose(opts.title || 'Область', [
    ...list.map((a) => ({ label: a.name, value: a.id, primary: a.id === current })),
    ...(opts.allowNone === false ? [] : [{ label: 'Без области', value: '__none' }]),
  ]);
  if (v === null) return undefined;
  return v === '__none' ? null : v;
}

export async function pickPerson(current, areaId) {
  const list = [...S.people.values()].filter((p) => p.status !== 'archived' && (!areaId || p.areaId === areaId || !p.areaId));
  const v = await choose('Человек', [
    ...list.map((p) => ({ label: hiddenArea(p.areaId) ? '••• (' + (st.area(p.areaId) || {}).name + ')' : p.code, value: p.id, primary: p.id === current })),
    { label: 'Новый…', value: '__new' },
    { label: 'Без человека', value: '__none' },
  ]);
  if (v === null) return undefined;
  if (v === '__none') return null;
  if (v === '__new') {
    const { editPerson } = await import('./areas.js');
    const p = await editPerson(st.newPerson({ areaId: areaId || null }), true);
    return p ? p.id : undefined;
  }
  return v;
}

export async function pickContext(current) {
  const v = await choose('Где / чем', [
    ...st.contexts().map((c) => ({ label: c.name, value: c.id, primary: c.id === current })),
    { label: 'Без контекста', value: '__none' },
  ]);
  if (v === null) return undefined;
  return v === '__none' ? null : v;
}

export async function pickTemplate() {
  const list = st.templatesList();
  if (!list.length) return undefined;
  const v = await choose('Шаблон', list.map((t) => ({ label: t.name, value: t.id })));
  return v === null ? undefined : v;
}

/** Повтор → rule | null (нет) | undefined (отмена) */
export function pickRepeat(current, date) {
  return new Promise((resolve) => {
    let done = false;
    let days = current && current.kind === 'weekly' ? [...current.days] : [];
    const finish = (v) => { done = true; s.close(); resolve(v); };
    const dayOfMonth = date ? Number(date.slice(8, 10)) : new Date().getDate();
    const month = date ? Number(date.slice(5, 7)) : new Date().getMonth() + 1;
    const s = sheet(() => h('div.choices',
      h('button.choice', { onclick: () => finish({ kind: 'daily' }) }, 'Каждый день'),
      h('div.card', { style: { margin: 0 } },
        h('div.lbl', 'По дням недели'),
        h('div.chips.wrap', DOW_SHORT.map((d, i) => h('button.chip' + (days.includes(i + 1) ? '.on' : ''), {
          onclick: () => { days = days.includes(i + 1) ? days.filter((x) => x !== i + 1) : [...days, i + 1].sort(); s.refresh(); },
        }, d))),
        h('div.row-btns', h('button.btn.primary', { disabled: !days.length, onclick: () => finish({ kind: 'weekly', days }) }, 'Готово'))),
      h('button.choice', {
        onclick: async () => {
          const n = await prompt('Раз в сколько дней?', '3', { inputmode: 'numeric', type: 'number' });
          const k = parseInt(n, 10);
          if (k > 0) finish({ kind: 'interval', n: k });
        },
      }, 'Раз в N дней'),
      h('button.choice', { onclick: () => finish({ kind: 'monthly', day: dayOfMonth }) }, `Ежемесячно, ${dayOfMonth}-го`),
      h('button.choice', { onclick: () => finish({ kind: 'monthly', day: 'last' }) }, 'Ежемесячно, в последний день'),
      h('button.choice', { onclick: () => finish({ kind: 'yearly', month, day: dayOfMonth }) }, `Ежегодно, ${dayOfMonth} ${MONTHS[month - 1]}`),
      h('button.choice', {
        onclick: async () => {
          const n = await prompt('Через сколько дней после выполнения?', '7', { inputmode: 'numeric', type: 'number' });
          const k = parseInt(n, 10);
          if (k > 0) finish({ kind: 'after', n: k });
        },
      }, 'Через N дней после выполнения'),
      h('button.choice.danger', { onclick: () => finish(null) }, 'Без повтора'),
      current ? h('p.muted', 'Сейчас: ' + describeRepeat(current)) : null,
    ), { title: 'Повтор', onClose: () => { if (!done) resolve(undefined); } });
  });
}

export async function pickSize(current) {
  const v = await choose('Размер', [
    { label: 'S — быстро, минут 15', value: 'S', primary: current === 'S' },
    { label: 'M — около часа', value: 'M', primary: current === 'M' },
    { label: 'L — большое, часа 3', value: 'L', primary: current === 'L' },
    { label: 'Не указывать', value: '__none' },
  ]);
  if (v === null) return undefined;
  return v === '__none' ? null : v;
}
