// Карточка задачи: необязательные поля раскрываются по требованию.
import { h, icon, sheet, toast, choose, prompt, pickDate, pickTime, copyText, linkify, shareOut, clear } from '../ui.js';
import * as st from '../store.js';
import { S } from '../store.js';
import { fmtDay, fmtShort, fmtDur, addDays } from '../dates.js';
import { dateLabel, partLabel } from '../parse.js';
import { describe as describeRepeat } from '../recur.js';
import { app, isHidden, reveal, complete, reschedule, deadlineLabel, personLabel, hiddenArea } from './common.js';
import { pickArea, pickPerson, pickRepeat, pickContext, pickSize } from './pickers.js';
import { describeOffset } from '../chain.js';
import { calendarKind, calendarLink, calendarSheet, stepsBlock, taskIcs, CHECK_HINT } from './calendar.js';

export function openTask(id) {
  let t = S.tasks.get(id);
  if (!t) return;
  if (isHidden(t)) { reveal(t); return; }
  let showAll = false;
  let calShown = null;
  let unsub = null;
  const s = sheet((api) => {
    t = S.tasks.get(id);
    if (!t) { setTimeout(() => api.close(), 0); return h('div'); }
    return body(t, api);
  }, { title: '', onClose: () => unsub && unsub() });
  unsub = st.subscribe(() => { if (!document.activeElement || !s.el.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') s.refresh(); });

  function upd(patch) {
    const r = st.updateTask(id, patch);
    return r;
  }

  function body(t, api) {
    const now = st.clock();
    const done = t.status === 'done';
    const g = t.groupId ? S.groups.get(t.groupId) : null;
    const text = h('textarea.input', { value: t.text, rows: 2, maxlength: 1000, 'aria-label': 'Текст задачи', style: { fontSize: '1.1rem', minHeight: '3.2rem' } });
    text.addEventListener('change', () => { if (text.value.trim()) upd({ text: text.value.trim() }); });
    text.addEventListener('blur', () => { if (text.value.trim() && text.value.trim() !== S.tasks.get(id).text) upd({ text: text.value.trim() }); });

    const rows = [];
    const line = (ic, label, val, onClick, filled) => {
      if (!filled && !showAll) return null;
      return h('button.line-btn', { onclick: onClick }, icon(ic, 20), h('span.grow', label), h('span.val', val || '—'));
    };
    const whenVal = t.date ? dateLabel(t.date, t.dateKind, now) : '';
    rows.push(line('cal', 'Когда', whenVal, async () => {
      const p = await pickDate({ now, value: t.date });
      if (p) upd({ date: p.date, dateKind: p.dateKind });
    }, !!t.date || true));
    rows.push(line('clock', 'Время', t.time ? t.time + (t.dur ? ' · ' + fmtDur(t.dur) : '') : t.part ? partLabel(t.part) : (t.dur ? fmtDur(t.dur) : ''), async () => {
      const p = await pickTime({ value: t.time, part: t.part, withDur: true, dur: t.dur });
      if (p) upd({ time: p.time, part: p.part, dur: p.dur || null, ...(p.time || p.part) && !t.date ? { date: st.T(), dateKind: 'day' } : {} });
    }, !!(t.time || t.part || t.dur)));
    const a = st.area(t.areaId);
    rows.push(line('areas', 'Область', a ? a.name : '', async () => {
      const v = await pickArea(t.areaId);
      if (v !== undefined) upd({ areaId: v });
    }, true));
    const p = st.person(t.personId);
    rows.push(line('person', 'Человек', p ? personLabel(p, t.areaId) : '', async () => {
      const v = await pickPerson(t.personId, t.areaId);
      if (v !== undefined) upd({ personId: v });
    }, !!p));
    rows.push(line('flag', 'Жёсткий срок', t.deadline ? fmtDay(t.deadline, now) + ' · ' + deadlineLabel(t.deadline) : '', async () => {
      const v = await pickDate({ now, value: t.deadline, title: 'Жёсткий срок', allowWeek: false, allowMonth: false, noneLabel: 'Без срока' });
      if (v) upd({ deadline: v.date });
    }, !!t.deadline));
    rows.push(line('grid', 'Размер', t.size ? { S: 'S · 15 мин', M: 'M · 1 ч', L: 'L · 3 ч' }[t.size] : '', async () => {
      const v = await pickSize(t.size);
      if (v === undefined) return;
      upd({ size: v });
      if (v === 'L' && !(t.checklist || []).length) askFirstStep(id);
    }, !!t.size));
    rows.push(line('repeat', 'Повтор', t.repeat ? describeRepeat(t.repeat) : '', async () => {
      const v = await pickRepeat(t.repeat, t.date);
      if (v !== undefined) upd({ repeat: v, ...(v && !t.date ? { date: st.T(), dateKind: 'day' } : {}) });
    }, !!t.repeat));
    const cx = st.contexts().find((c) => c.id === t.ctx);
    rows.push(line('phone', 'Где / чем', cx ? cx.name : '', async () => {
      const v = await pickContext(t.ctx);
      if (v !== undefined) upd({ ctx: v });
    }, !!cx));

    // чек-лист
    const cl = t.checklist || [];
    let checklist = null;
    if (cl.length || showAll) {
      const addInp = h('input', { type: 'text', placeholder: 'Добавить шаг', maxlength: 300, 'aria-label': 'Новый шаг' });
      const addItem = () => {
        const v = addInp.value.trim();
        if (!v) return;
        upd({ checklist: [...(S.tasks.get(id).checklist || []), { id: st.uid(), text: v, done: false }] });
        addInp.value = '';
        setTimeout(() => { const n = s.el.querySelector('.cl-add input'); if (n) n.focus(); }, 30);
      };
      addInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
      const total = cl.length, dn = cl.filter((c) => c.done).length;
      checklist = h('div.section',
        h('div.section-h', h('span', st.isProject(t) ? 'Проект' : 'Шаги'), h('span.grow')),
        st.isProject(t) ? h('div.progress', { style: { maxWidth: 'none', marginBottom: '.4rem' } }, h('i', { style: { width: (dn / total) * 100 + '%' } })) : null,
        cl.map((c) => h('div.checkline',
          h('button.check' + (c.done ? '.done' : ''), {
            'aria-label': c.done ? 'Снять отметку' : 'Отметить шаг',
            onclick: () => upd({ checklist: S.tasks.get(id).checklist.map((x) => x.id === c.id ? { ...x, done: !x.done, doneAt: !x.done ? st.clock().toISOString() : null } : x) }),
          }, h('span.box', icon('check'))),
          (() => {
            const i = h('input', { type: 'text', value: c.text, maxlength: 300, 'aria-label': 'Шаг' });
            i.addEventListener('change', () => {
              const v = i.value.trim();
              upd({ checklist: S.tasks.get(id).checklist.map((x) => x.id === c.id ? { ...x, text: v } : x).filter((x) => x.text) });
            });
            return i;
          })(),
          h('button.icon-btn', { 'aria-label': 'Удалить шаг', onclick: () => upd({ checklist: S.tasks.get(id).checklist.filter((x) => x.id !== c.id) }) }, icon('close', 18)))),
        h('div.checkline.cl-add', h('span.check', icon('plus', 18)), addInp, h('button.icon-btn', { 'aria-label': 'Добавить шаг', onclick: addItem }, icon('check', 18))));
    }

    // заметка
    let note = null;
    if (t.note || showAll) {
      let editing = !t.note;
      const wrap = h('div.section');
      const draw = () => {
        clear(wrap);
        wrap.append(h('div.section-h', h('span', 'Заметка'), h('span.grow'), t.note && !editing ? h('button.chip.small', { onclick: () => { editing = true; draw(); } }, 'Изменить') : null));
        if (editing) {
          const ta = h('textarea.input', { value: t.note || '', maxlength: 5000, placeholder: 'Телефоны, ссылки, адреса — станут кликабельными', 'aria-label': 'Заметка' });
          ta.addEventListener('change', () => upd({ note: ta.value }));
          wrap.append(ta);
        } else wrap.append(h('div.note-view.card', linkify(t.note)));
      };
      draw();
      note = wrap;
    }
    // заготовка
    let draft = null;
    if (t.draft || t.draftSlot || showAll) {
      const ta = h('textarea.input', { value: t.draft || '', maxlength: 8000, placeholder: 'Текст-заготовка (промт, письмо, сообщение)', 'aria-label': 'Заготовка' });
      ta.addEventListener('change', () => upd({ draft: ta.value }));
      // из закрытой области заготовка наружу не копируется: в ней могут быть данные задачи
      const privDraft = st.isPrivate(t);
      const tpl = g ? S.templates.get(g.templateId) : null;
      draft = h('div.section',
        h('div.section-h', h('span', 'Заготовка'), h('span.grow'),
          privDraft ? null : h('button.chip.small', { onclick: async () => { const ok = await copyText(ta.value); toast(ok ? 'Скопировано' : 'Не удалось скопировать'); } }, icon('copy', 16), 'Скопировать')),
        ta,
        privDraft ? h('p.muted.small', icon('lock', 14), ' Из закрытой области заготовка не копируется наружу.',
          tpl && !tpl.deletedAt ? h('button.chip.small', { style: { marginLeft: '.4rem' }, onclick: async () => { const { editTemplate } = await import('./areas.js'); editTemplate(structuredClone(tpl), false); } }, 'Общий текст — в шаблоне') : null) : null);
    }

    const info = [];
    if (g) {
      info.push(h('button.line-btn', { onclick: () => openGroup(g.id) }, icon('chain', 20), h('span.grow', hiddenArea(g.areaId) ? 'Цепочка' : g.title), h('span.val', 'шаги')));
    }
    if (t.from && t.from.name) info.push(h('div.line-btn', icon('person', 20), h('span.grow', 'От: ' + t.from.name)));
    if (t.waitFor) info.push(h('div.line-btn', icon('clock', 20), h('span.grow', 'Жду от: ' + t.waitFor),
      h('button.chip.small', { onclick: () => upd({ waitFor: null }) }, 'Вернуть себе')));

    const priv = st.isPrivate(t);
    const actions = [];
    if (!done) actions.push(h('button.btn.primary', { onclick: () => { api.close(); complete(t, null); } }, icon('check', 18), st.isProject(t) && st.nextItem(t) ? 'Шаг сделан' : 'Готово'));
    else actions.push(h('button.btn', { onclick: () => st.uncompleteTask(id) }, icon('undo', 18), 'Вернуть'));
    if (!done) actions.push(h('button.btn', { onclick: () => reschedule([id]) }, 'Перенести'));
    if (!done) actions.push(h('button.btn' + (t.star ? '.on' : ''), {
      onclick: async () => {
        const r = st.setStar(id, !t.star);
        if (r && r.full) {
          const v = await choose('Уже три главных', r.full.map((x) => ({ label: 'Вместо: ' + (isHidden(x) ? '•••' : x.text), value: x.id })), { text: 'Четвёртое главное — только вместо одного из трёх.' });
          if (v) st.swapStar(v, id);
        }
      },
    }, t.star ? '★ Главное' : '☆ Главное'));
    const more = [];
    // пересылка ссылкой — только для дел без даты и времени; всё, что с датой, — через общий календарь
    if (!done && !priv && !t.date && !t.time) more.push({ label: 'Отправить задачу', value: 'send', icon: 'send' });
    if (t.from && !priv && st.privateAreas().length) more.push({ label: 'Скрыть в закрытую область', value: 'hide', icon: 'lock' });
    if (t.from && done) more.push({ label: 'Сообщить, что сделано', value: 'report', icon: 'send' });
    if ((cl.length || g)) more.push({ label: 'Сохранить как шаблон', value: 'tpl', icon: 'chain' });
    if (!showAll) more.push({ label: 'Все поля', value: 'all', icon: 'list' });
    more.push({ label: 'Удалить', value: 'del', icon: 'trash', danger: true });
    actions.push(h('button.btn', {
      'aria-label': 'Ещё', onclick: async () => {
        const v = await choose('Действия', more);
        if (v === 'all') { showAll = true; s.refresh(); }
        else if (v === 'send') { const { sendTask } = await import('./share.js'); sendTask(S.tasks.get(id)); }
        else if (v === 'report') { const { reportDone } = await import('./share.js'); reportDone(S.tasks.get(id)); }
        else if (v === 'hide') { const { hideIncoming } = await import('./common.js'); await hideIncoming(S.tasks.get(id)); api.close(); }
        else if (v === 'tpl') { const { editTemplate } = await import('./areas.js'); editTemplate(st.templateDraftFrom(S.tasks.get(id)), true); }
        else if (v === 'del') {
          if (t.isAnchor && g) { api.close(); cancelAnchorFlow(g.id); return; }
          const r = st.deleteTask(id);
          api.close();
          toast('Удалено', { action: 'Отменить', onAction: () => r.undo() });
        }
      },
    }, icon('more', 18)));

    // «Добавить в календарь» — всегда видно у задачи с датой (или сроком), не спрятано в меню
    const calKind = calendarKind(t);
    const calFile = calKind && !done ? taskIcs(t, calKind) : null;
    const calBox = calFile ? h('div.cal-box',
      calShown ? stepsBlock() : null,
      calendarLink(calFile.text, calFile.name, {
        label: calShown ? 'Скачать файл ещё раз' : 'Добавить в календарь', cls: '.btn.block', source: 'task',
        onDone: () => { calShown = true; s.refresh(); },
      }),
      h('p.muted.small.cal-hint', CHECK_HINT)) : null;

    return h('div.form',
      priv ? h('div.muted.small', icon('lock', 14), ' Закрытая область: задачу нельзя отправить; в календарь уйдёт нейтральный текст «Встреча».') : null,
      text,
      h('div.row-btns', { style: { marginTop: 0 } }, actions),
      calBox,
      h('div', rows),
      !showAll ? h('button.more-line', { onclick: () => { showAll = true; s.refresh(); } }, icon('plus', 18), 'Ещё поля: срок, размер, повтор, шаги, заметка…') : null,
      checklist, note, draft, info.length ? h('div.section', info) : null,
      t.status === 'done' && t.doneAt ? h('p.muted.small', 'Сделано ' + fmtDay(t.doneAt.slice(0, 10), now)) : null,
    );
  }
}

async function askFirstStep(id) {
  const step = await prompt('Большая задача', '', { text: 'Какой первый маленький шаг?', placeholder: 'Например: набросать план' });
  if (step) {
    const t = S.tasks.get(id);
    st.updateTask(id, { checklist: [{ id: st.uid(), text: step, done: false }, ...(t.checklist || [])] });
  }
}

export function icsFor(t) {
  return calendarSheet(t);
}

// ——— цепочка ———
export function openGroup(gid) {
  const s = sheet(() => {
    const g = S.groups.get(gid);
    if (!g) return h('p', 'Цепочка не найдена');
    const tasks = st.groupTasks(gid);
    const hidden = hiddenArea(g.areaId);
    const anchor = tasks.find((t) => t.isAnchor);
    const { taskRow } = app.common;
    return h('div',
      h('h3', hidden ? '•••' : g.title),
      g.anchor ? h('p.muted', (anchor ? anchor.text : 'Якорь') + ': ' + fmtDay(g.anchor.date, st.clock()) + (g.anchor.time ? ' в ' + g.anchor.time : '')) : null,
      h('div.list', tasks.map((t) => taskRow(t, { showDate: true, hideGroup: true, hideArea: true, noSelect: true, hideStar: true }))),
      h('div.row-btns',
        anchor && anchor.status === 'active' ? h('button.btn', { onclick: () => moveAnchorFlow(gid) }, 'Перенести якорь') : null,
        anchor && anchor.status === 'active' ? h('button.btn', { onclick: () => cancelAnchorFlow(gid) }, 'Отменить') : null,
        h('button.btn', { onclick: async () => { const { editTemplate } = await import('./areas.js'); editTemplate(st.templateDraftFrom(g), true); } }, 'Сохранить как шаблон')));
  }, { title: 'Цепочка' });
  const un = st.subscribe(() => s.refresh());
  const prev = s.onClose;
  s.onClose = () => { un(); prev && prev(); };
}

export async function moveAnchorFlow(gid) {
  const g = S.groups.get(gid);
  if (!g || !g.anchor) return;
  const d = await pickDate({ now: st.clock(), value: g.anchor.date, title: 'Новая дата', allowWeek: false, allowMonth: false, allowNone: false });
  if (!d || !d.date) return;
  const t = await pickTime({ value: g.anchor.time, title: 'Новое время' });
  if (t === null) return;
  const r = st.moveAnchor(gid, { date: d.date, time: t.time || g.anchor.time, dur: g.anchor.dur });
  if (r) toast('Цепочка сдвинута', { action: 'Отменить', onAction: () => r.undo() });
}

export async function cancelAnchorFlow(gid) {
  const v = await choose('Отменить встречу', [
    { label: 'Перенести на другой день', value: 'move', primary: true },
    { label: 'Удалить все невыполненные шаги', value: 'delete' },
    { label: 'Оставить шаги как обычные задачи', value: 'keep' },
  ], { text: 'Что сделать с шагами цепочки?' });
  if (!v) return;
  if (v === 'move') return moveAnchorFlow(gid);
  const r = st.cancelAnchor(gid, v);
  if (r) toast('Отменено', { action: 'Отменить', onAction: () => r.undo() });
}

export { describeOffset, addDays };
