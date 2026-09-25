// Области, люди и шаблоны. Ничего не зашито: всё создаётся и правится здесь.
import { h, icon, sheet, toast, choose, prompt, confirmBox, pickDate, pickTime, clear } from '../ui.js';
import * as st from '../store.js';
import { S } from '../store.js';
import { COLORS } from '../seed.js';
import { fmtDay, DOW_SHORT, DOW_FULL, fmtShort } from '../dates.js';
import { app, taskRow, emptyState, sectionHead, hiddenArea, unlockArea, askPin } from './common.js';
import { OFFSET_KINDS, describeOffset, describeRule } from '../chain.js';

let showArchived = false;

export function renderAreas(root) {
  const list = st.areasList();
  root.append(h('div.list', list.map((a) => areaLine(a))));
  root.append(h('div.row-btns',
    h('button.btn', { onclick: async () => { const n = await prompt('Новая область', '', { placeholder: 'Название' }); if (n) { const a = st.newArea(n); st.saveArea(a); editArea(a.id); } } }, icon('plus', 18), 'Область'),
    h('button.btn', { onclick: () => templatesSheet() }, icon('chain', 18), 'Шаблоны'),
    list.length > 1 ? h('button.btn', { onclick: () => reorderSheet() }, 'Порядок') : null));
  const arch = st.areasList(true).filter((a) => a.archived);
  if (arch.length) {
    root.append(h('button.more-line', { onclick: () => { showArchived = !showArchived; app.render(); } }, icon(showArchived ? 'up' : 'down', 18), 'Архив · ' + arch.length));
    if (showArchived) root.append(h('div.list', arch.map((a) => areaLine(a))));
  }
}

function areaLine(a) {
  const n = st.activeTasks().filter((t) => t.areaId === a.id && !t.waitFor).length;
  return h('button.row', { onclick: () => app.go('area', { areaId: a.id }), style: { textAlign: 'left' } },
    h('div.row-inner', { style: { alignItems: 'center', paddingLeft: '1rem' } },
      h('span.dot', { style: { background: a.color, width: '.8rem', height: '.8rem' } }),
      h('div.t-main', { style: { paddingTop: 0 } }, h('div.t-text', a.name),
        h('div.t-meta', a.kind === 'heart' ? h('span.m', icon('heart', 14), 'сердце') : null, a.private ? h('span.m', icon('lock', 14), 'закрытая') : null,
          a.endDate && !a.archived ? h('span.m', 'до ' + fmtShort(a.endDate)) : null, a.archived ? h('span.m', 'в архиве') : null)),
      n ? h('span.muted.small', String(n)) : null,
      icon('right', 18)));
}

export function renderArea(root, areaId) {
  const a = st.area(areaId);
  if (!a) { root.append(emptyState('Область не найдена.')); return; }
  const locked = hiddenArea(a.id);
  if (a.private) {
    root.append(h('div.card.calm', h('div', icon('lock', 16), locked ? ' Закрытая область: текст скрыт.' : ' Закрытая область открыта до сворачивания приложения.'),
      locked ? h('div.chips', h('button.chip.on', { onclick: async () => { if (await unlockArea(a.id)) app.render(); } }, 'Показать')) : null));
  }
  const tasks = st.activeTasks().filter((t) => t.areaId === a.id && !t.waitFor);
  const ns = st.nextSteps();
  const own = tasks.filter((t) => !t.groupId);
  const undated = own.filter((t) => !t.date);
  const dated = own.filter((t) => t.date).sort((x, y) => (x.date < y.date ? -1 : 1));
  const groups = [...S.groups.values()].filter((g) => g.areaId === a.id && g.status === 'active');
  if (!tasks.length && !groups.length) root.append(emptyState('Задач пока нет.', 'Можно добавить через поле ввода: #' + a.name.split(' ')[0].toLowerCase(), 'areas'));
  if (dated.length) { root.append(sectionHead('Запланировано')); root.append(h('div.list', dated.map((t) => taskRow(t, { showDate: true, hideArea: true })))); }
  if (undated.length) { root.append(sectionHead('Без даты')); root.append(h('div.list', undated.map((t) => taskRow(t, { hideArea: true })))); }
  if (groups.length) {
    root.append(sectionHead('Цепочки'));
    root.append(h('div.list', groups.map((g) => {
      const next = ns.get(g.id);
      return h('button.row', { style: { textAlign: 'left' }, onclick: async () => { if (locked && !(await unlockArea(a.id))) return; app.render(); const { openGroup } = await import('./task.js'); openGroup(g.id); } },
        h('div.row-inner', { style: { paddingLeft: '1rem' } }, icon('chain', 18),
          h('div.t-main', h('div.t-text', locked ? '•••' : g.title),
            h('div.t-meta', g.anchor ? h('span.m', fmtDay(g.anchor.date, st.clock()) + (g.anchor.time ? ' ' + g.anchor.time : '')) : null,
              next ? h('span.m', 'дальше: ' + (locked ? '•••' : next.text)) : null))));
    })));
  }
  // люди
  const people = st.peopleOf(a.id);
  root.append(sectionHead('Люди', h('button.chip.small', { onclick: async () => { const p = await editPerson(st.newPerson({ areaId: a.id }), true); if (p) app.render(); } }, icon('plus', 14), 'Человек')));
  if (people.length) {
    root.append(h('div.list', people.map((p) => h('button.row', { style: { textAlign: 'left' }, onclick: async () => { if (locked && !(await unlockArea(a.id))) return; openPerson(p.id); } },
      h('div.row-inner', { style: { alignItems: 'center', paddingLeft: '1rem' } },
        h('span.dot', { style: { background: p.color, width: '.8rem', height: '.8rem' } }),
        h('div.t-main', { style: { paddingTop: 0 } }, h('div.t-text', locked ? '•••' : p.code),
          h('div.t-meta', h('span.m', { active: 'в работе', pause: 'пауза', done: 'завершён' }[p.status] || ''),
            p.counter ? h('span.m', '№' + p.counter) : null,
            p.schedule ? h('span.m', icon('repeat', 12), DOW_SHORT[p.schedule.dow - 1] + ' ' + (p.schedule.time || '')) : null)),
        icon('right', 18))))));
  } else root.append(h('p.muted.small', { style: { margin: '.25rem .5rem' } }, a.private ? 'Клиенты — только код или инициалы.' : 'Людей пока нет.'));
  // шаблоны области
  const tpls = st.templatesList().filter((t) => t.areaId === a.id);
  root.append(sectionHead('Шаблоны', h('button.chip.small', { onclick: () => editTemplate({ id: st.uid(), name: '', areaId: a.id, synonyms: [], anchor: null, steps: [] }, true) }, icon('plus', 14), 'Шаблон')));
  if (tpls.length) root.append(h('div.list', tpls.map((t) => templateLine(t))));
  root.append(h('div.row-btns', h('button.btn', { onclick: () => editArea(a.id) }, icon('gear', 18), 'Настройки области')));
}

function templateLine(t) {
  return h('div.row', h('div.row-inner', { style: { alignItems: 'center', paddingLeft: '1rem' } },
    icon('chain', 18),
    h('div.t-main', { style: { paddingTop: 0 } }, h('div.t-text', t.name), h('div.t-meta', h('span.m', (t.steps || []).length + ' шаг.'), t.anchor ? h('span.m', 'якорь: ' + t.anchor.label) : null)),
    h('button.chip.small', { onclick: () => launchSheet(t.id) }, 'Запустить'),
    h('button.icon-btn', { 'aria-label': 'Изменить шаблон', onclick: () => editTemplate(structuredClone(t), false) }, icon('edit', 18))));
}

// ——— настройки области ———
export function editArea(id) {
  const s = sheet(() => {
    const a = st.area(id);
    if (!a) return h('div');
    const save = (patch) => st.saveArea({ ...st.area(id), ...patch });
    const name = h('input.input', { value: a.name, maxlength: 60, 'aria-label': 'Название' });
    name.addEventListener('change', () => { if (name.value.trim()) save({ name: name.value.trim() }); });
    const syn = h('textarea.input', { value: (a.synonyms || []).join(', '), maxlength: 1000, 'aria-label': 'Ключевые слова' });
    syn.addEventListener('change', () => save({ synonyms: syn.value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) }));
    const sw = (on, label, fn, hint) => h('button.line-btn', { onclick: fn, role: 'switch', 'aria-checked': String(!!on) }, h('span.grow', label, hint ? h('div.muted.small', hint) : null), h('span.switch' + (on ? '.on' : '')));
    return h('div.form',
      h('div.field', h('label', 'Название'), name),
      h('div.field', h('label', 'Цвет'), h('div.colors', COLORS.map((c) => h('button' + (a.color === c ? '.sel' : ''), { style: { background: c }, 'aria-label': 'Цвет ' + c, onclick: () => save({ color: c }) })))),
      h('div.field', h('label', 'Тип'), h('div.seg', [['heart', 'Сердце — время защищено'], ['duty', 'Верность — минимально достаточно']].map(([k, l]) => h('button', { 'aria-pressed': String(a.kind === k), onclick: () => save({ kind: k }) }, l)))),
      sw(a.private, 'Закрытая область', () => save({ private: !a.private, pinLock: a.private ? false : a.pinLock }), 'Текст задач и имена скрыты, пока не коснёшься; нельзя отправить'),
      a.private ? sw(a.pinLock, 'Открывать по PIN', async () => {
        if (!a.pinLock && !st.settings().pinHash) {
          const pin = await prompt('Задайте PIN', '', { text: '4 цифры. Хранится только как хэш.', inputmode: 'numeric', max: 4, type: 'password' });
          if (!pin || !/^\d{4}$/.test(pin)) { if (pin) toast('Нужно ровно 4 цифры'); return; }
          await st.setPin(pin);
        }
        save({ pinLock: !a.pinLock });
      }) : null,
      h('button.line-btn', {
        onclick: async () => {
          const d = await pickDate({ now: st.clock(), value: a.endDate, title: 'Дата окончания', allowWeek: false, allowMonth: false, noneLabel: 'Без даты окончания' });
          if (d) save({ endDate: d.date });
        },
      }, icon('flag', 20), h('span.grow', 'Дата окончания'), h('span.val', a.endDate ? fmtDay(a.endDate, st.clock()) : 'нет')),
      h('div.field', h('label', 'Постоянный блок без окончания длится'), h('div.chips.wrap', [30, 60, 90, 120, 180, 240].map((m) => h('button.chip.small' + ((Number(a.blockDur) || 60) === m ? '.on' : ''), { onclick: () => save({ blockDur: m }) }, m < 60 ? m + ' мин' : m / 60 + ' ч')))),
      h('div.field', h('label', 'Ключевые слова для быстрого ввода (через запятую)'), syn),
      h('div.row-btns',
        a.archived ? h('button.btn', { onclick: () => { save({ archived: false }); toast('Возвращена из архива'); } }, 'Вернуть из архива')
          : h('button.btn', { onclick: async () => { if (await confirmBox('Архивировать?', 'Задачи и история сохранятся. Область можно вернуть.', 'В архив')) { save({ archived: true, archivedAt: st.clock().toISOString() }); s.close(); app.go('areas'); } } }, icon('archive', 18), 'В архив')),
    );
  }, { title: 'Область' });
  const un = st.subscribe(() => { if (!s.el.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') s.refresh(); });
  const prev = s.onClose; s.onClose = () => { un(); prev && prev(); };
}

function reorderSheet() {
  sheet((api) => {
    const list = st.areasList();
    const move = (i, d) => {
      const arr = [...list];
      const [x] = arr.splice(i, 1);
      arr.splice(i + d, 0, x);
      st.change(() => arr.forEach((a, k) => st.put('areas', { ...a, order: k })));
      api.refresh();
    };
    return h('div.list', list.map((a, i) => h('div.row', h('div.row-inner', { style: { alignItems: 'center', paddingLeft: '1rem' } },
      h('span.dot', { style: { background: a.color } }), h('div.t-main', { style: { paddingTop: 0 } }, a.name),
      h('button.icon-btn', { disabled: i === 0, 'aria-label': 'Выше', onclick: () => move(i, -1) }, icon('up', 18)),
      h('button.icon-btn', { disabled: i === list.length - 1, 'aria-label': 'Ниже', onclick: () => move(i, 1) }, icon('down', 18))))));
  }, { title: 'Порядок областей' });
}

// ——— люди ———
export function editPerson(p, isNew) {
  return new Promise((resolve) => {
    const draft = { ...p };
    let saved = false;
    const s = sheet(() => {
      const a = st.area(draft.areaId);
      const code = h('input.input', { value: draft.code, maxlength: 20, placeholder: a && a.private ? 'Код или инициалы, например А.К.' : 'Имя, код или инициалы', autofocus: isNew, 'aria-label': 'Код' });
      code.addEventListener('input', () => { draft.code = code.value; });
      const note = h('textarea.input', { value: draft.note || '', maxlength: 500, placeholder: 'Короткая заметка', 'aria-label': 'Заметка' });
      note.addEventListener('input', () => { draft.note = note.value; });
      const counter = h('input.input', { value: String(draft.counter || 0), inputmode: 'numeric', type: 'number', min: 0, 'aria-label': 'Счётчик циклов' });
      counter.addEventListener('input', () => { draft.counter = Math.max(0, parseInt(counter.value, 10) || 0); });
      const tpl = draft.templateId ? S.templates.get(draft.templateId) : null;
      const firstClient = isNew && a && a.private && !st.meta('clientHintShown');
      return h('div.form',
        firstClient ? h('div.card.calm', h('b', 'Про приватность'), h('p', { style: { margin: '.3rem 0 0' } }, 'Для клиентов используйте только код или инициалы — без имён и фамилий. В закрытой области всё скрыто, пока не коснёшься.')) : null,
        h('div.field', h('label', 'Код или инициалы'), code),
        h('div.field', h('label', 'Цвет'), h('div.colors', COLORS.map((c) => h('button' + (draft.color === c ? '.sel' : ''), { style: { background: c }, 'aria-label': 'Цвет', onclick: () => { draft.color = c; s.refresh(); } })))),
        h('button.line-btn', { onclick: async () => { const { pickArea } = await import('./pickers.js'); const v = await pickArea(draft.areaId); if (v !== undefined) { draft.areaId = v; s.refresh(); } } }, icon('areas', 20), h('span.grow', 'Область'), h('span.val', a ? a.name : '—')),
        h('div.field', h('label', 'Статус'), h('div.seg', [['active', 'В работе'], ['pause', 'Пауза'], ['done', 'Завершён']].map(([k, l]) => h('button', { 'aria-pressed': String(draft.status === k), onclick: () => { draft.status = k; s.refresh(); } }, l)))),
        h('button.line-btn', { onclick: async () => { const { pickTemplate } = await import('./pickers.js'); const v = await pickTemplate(); if (v) { draft.templateId = v; s.refresh(); } } }, icon('chain', 20), h('span.grow', 'Шаблон по умолчанию'), h('span.val', tpl ? tpl.name : '—')),
        h('button.line-btn', {
          onclick: async () => {
            const v = await choose('Регулярное расписание', [
              ...DOW_FULL.map((d, i) => ({ label: 'Каждый ' + (i === 2 ? 'среду' : i === 4 ? 'пятницу' : i === 5 ? 'субботу' : d), value: i + 1 })),
              { label: 'Без расписания', value: 'none' },
            ]);
            if (!v) return;
            if (v === 'none') { draft.schedule = null; s.refresh(); return; }
            const t = await pickTime({ title: 'Во сколько', value: draft.schedule && draft.schedule.time });
            if (t === null) return;
            draft.schedule = { dow: v, time: t.time || '12:00' };
            s.refresh();
          },
        }, icon('repeat', 20), h('span.grow', 'Регулярное расписание', h('div.muted.small', 'Следующий цикл создаётся сам, не больше одного вперёд')), h('span.val', draft.schedule ? DOW_SHORT[draft.schedule.dow - 1] + ' ' + draft.schedule.time : 'нет')),
        h('div.field', h('label', 'Счётчик циклов (№ сессии)'), counter),
        h('div.field', h('label', 'Заметка'), note),
        h('div.row-btns', h('button.btn.primary', {
          onclick: () => {
            if (!draft.code.trim()) { toast('Нужен код или инициалы'); return; }
            const dup = st.findPersonByCode(draft.code);
            if (dup && dup.id !== draft.id) { toast('Такой код уже есть'); return; }
            saved = true;
            const obj = { ...draft, code: draft.code.trim() };
            st.change(() => { st.put('people', obj); if (a && a.private) st.setMeta('clientHintShown', true); });
            st.ensureScheduledCycles();
            s.close();
            resolve(obj);
          },
        }, 'Сохранить')),
      );
    }, { title: isNew ? 'Новый человек' : 'Человек', onClose: () => { if (!saved) resolve(null); } });
  });
}

export function openPerson(id) {
  const s = sheet(() => {
    const p = S.people.get(id);
    if (!p) return h('div');
    const groups = [...S.groups.values()].filter((g) => g.personId === id).sort((a, b) => ((a.anchor && a.anchor.date) || a.start || '') < ((b.anchor && b.anchor.date) || b.start || '') ? 1 : -1);
    const tpl = p.templateId ? S.templates.get(p.templateId) : null;
    return h('div',
      h('div.kv', h('dt', 'Статус'), h('dd', { active: 'в работе', pause: 'пауза', done: 'завершён' }[p.status]),
        h('dt', 'Циклов'), h('dd', String(p.counter || 0)),
        p.schedule ? [h('dt', 'Расписание'), h('dd', DOW_SHORT[p.schedule.dow - 1] + ' ' + p.schedule.time)] : null,
        p.note ? [h('dt', 'Заметка'), h('dd', p.note)] : null),
      h('div.row-btns',
        h('button.btn.primary', { onclick: () => launchSheet(p.templateId || null, p.id) }, icon('chain', 18), tpl ? 'Запустить: ' + tpl.name : 'Запустить цепочку'),
        h('button.btn', { onclick: () => editPerson(S.people.get(id), false) }, icon('edit', 18), 'Изменить')),
      groups.length ? sectionHead('Цепочки') : null,
      h('div.list', groups.map((g) => h('button.line-btn', { onclick: async () => { const { openGroup } = await import('./task.js'); openGroup(g.id); } },
        h('span.grow', g.title), h('span.val', (g.anchor ? fmtDay(g.anchor.date, st.clock()) : '') + ' · ' + ({ active: 'идёт', done: 'пройдена', cancelled: 'отменена' }[g.status] || ''))))));
  }, { title: (S.people.get(id) || {}).code || 'Человек' });
  const un = st.subscribe(() => s.refresh());
  const prev = s.onClose; s.onClose = () => { un(); prev && prev(); };
}

// ——— запуск цепочки ———
export async function launchSheet(tplId, personId) {
  if (!tplId) {
    const { pickTemplate } = await import('./pickers.js');
    tplId = await pickTemplate();
    if (!tplId) return;
  }
  const tpl = S.templates.get(tplId);
  if (!tpl) return;
  const { launchFromParse } = await import('./compose.js');
  if (!personId && tpl.areaId && st.peopleOf(tpl.areaId).length) {
    const { pickPerson } = await import('./pickers.js');
    const v = await pickPerson(null, tpl.areaId);
    if (v === undefined) return;
    personId = v;
  }
  const r = await launchFromParse({ templateId: tplId, personId, text: '', date: null, time: null, dateKind: null });
  if (r) app.render();
}

// ——— шаблоны ———
export function templatesSheet() {
  const s = sheet(() => {
    const list = st.templatesList();
    return h('div',
      h('p.muted.small', 'Шаблон — это цепочка шагов с датами от якоря (например, сессии). Запускается фразой: «сессия с А.К. в чт в 18».'),
      h('div.list', list.map((t) => templateLine(t))),
      h('div.row-btns', h('button.btn', { onclick: () => editTemplate({ id: st.uid(), name: '', areaId: null, synonyms: [], anchor: null, steps: [] }, true) }, icon('plus', 18), 'Новый шаблон')));
  }, { title: 'Шаблоны' });
  const un = st.subscribe(() => s.refresh());
  const prev = s.onClose; s.onClose = () => { un(); prev && prev(); };
}

export function editTemplate(tpl, isNew) {
  const d = structuredClone(tpl);
  d.steps = d.steps || [];
  let openStep = null;
  const s = sheet(() => {
    const a = st.area(d.areaId);
    const name = h('input.input', { value: d.name, maxlength: 60, placeholder: 'Например: Сессия', 'aria-label': 'Название шаблона' });
    name.addEventListener('input', () => { d.name = name.value; });
    const syn = h('input.input', { value: (d.synonyms || []).join(', '), maxlength: 300, placeholder: 'сессия, консультация', 'aria-label': 'Синонимы' });
    syn.addEventListener('input', () => { d.synonyms = syn.value.split(',').map((x) => x.trim()).filter(Boolean); });
    const hasA = !!d.anchor;
    const anchorBox = h('div.card', { style: { margin: 0 } },
      h('button.line-btn', { role: 'switch', 'aria-checked': String(hasA), onclick: () => { d.anchor = hasA ? null : { label: d.name || 'Встреча', dur: 60 }; s.refresh(); } },
        h('span.grow', 'Якорь', h('div.muted.small', 'Событие со временем: шаги считаются от него. Без якоря — от даты запуска.')), h('span.switch' + (hasA ? '.on' : ''))),
      hasA ? h('div.form', { style: { marginTop: '.5rem' } },
        (() => { const i = h('input.input', { value: d.anchor.label, maxlength: 60, placeholder: 'Название события', 'aria-label': 'Название якоря' }); i.addEventListener('input', () => { d.anchor.label = i.value; }); return i; })(),
        h('div.chips.wrap', h('span.muted.small', 'Длительность:'), [15, 30, 45, 60, 90, 120, 180].map((m) => h('button.chip.small' + (d.anchor.dur === m ? '.on' : ''), { onclick: () => { d.anchor.dur = m; s.refresh(); } }, m < 60 ? m + ' мин' : m / 60 + ' ч')))) : null);

    const steps = d.steps.map((stp, i) => {
      const open = openStep === stp.id;
      const head = h('button.line-btn', { onclick: () => { openStep = open ? null : stp.id; s.refresh(); } },
        h('span.grow', stp.text || 'Новый шаг', h('div.muted.small', describeOffset(stp.offset, hasA) + ' · ' + (stp.size || '—') + ' · ' + describeRule(stp.rule))),
        icon(open ? 'up' : 'down', 18));
      if (!open) return h('div.card', { style: { margin: '.35rem 0', padding: '.2rem .8rem' } }, head);
      const text = h('input.input', { value: stp.text, maxlength: 200, placeholder: 'Что сделать', 'aria-label': 'Текст шага' });
      text.addEventListener('input', () => { stp.text = text.value; });
      const n = h('input.input', { value: String(stp.offset.n || 0), inputmode: 'numeric', type: 'number', min: 0, style: { width: '6rem' }, 'aria-label': 'N' });
      n.addEventListener('input', () => { stp.offset.n = Math.max(0, parseInt(n.value, 10) || 0); });
      const needsN = ['before_days', 'before_min', 'after_days'].includes(stp.offset.kind);
      const kinds = hasA ? OFFSET_KINDS : OFFSET_KINDS.filter(([k]) => k === 'after_days' || k === 'same_day');
      const draft = h('textarea.input', { value: stp.draft || '', maxlength: 8000, placeholder: 'Текст-заготовка (необязательно)', 'aria-label': 'Заготовка шага' });
      draft.addEventListener('input', () => { stp.draft = draft.value; stp.draftSlot = true; });
      const ruleN = h('input.input', { value: String((stp.rule && stp.rule.n) || 3), inputmode: 'numeric', type: 'number', min: 2, style: { width: '5rem' }, 'aria-label': 'Каждый N-й' });
      ruleN.addEventListener('input', () => { stp.rule = { kind: 'nth', n: Math.max(2, parseInt(ruleN.value, 10) || 2) }; });
      return h('div.card', { style: { margin: '.35rem 0' } }, head,
        h('div.form', { style: { marginTop: '.4rem' } },
          text,
          h('div.field', h('label', 'Когда'), h('div.chips.wrap', kinds.map(([k, l]) => h('button.chip.small' + (stp.offset.kind === k ? '.on' : ''), { onclick: () => { stp.offset = { kind: k, n: stp.offset.n || (k === 'before_min' ? 15 : 1) }; s.refresh(); } }, l)))),
          needsN ? h('div.field', h('label', stp.offset.kind === 'before_min' ? 'Минут' : 'Дней'), n) : null,
          h('div.field', h('label', 'Размер'), h('div.chips', ['S', 'M', 'L'].map((z) => h('button.chip.small' + (stp.size === z ? '.on' : ''), { onclick: () => { stp.size = stp.size === z ? null : z; s.refresh(); } }, z)))),
          h('div.field', h('label', 'Повторяемость'), h('div.chips.wrap',
            [['every', 'Каждый раз'], ['first', 'Только первый раз'], ['nth', 'Каждый N-й раз']].map(([k, l]) => h('button.chip.small' + ((stp.rule || { kind: 'every' }).kind === k ? '.on' : ''), { onclick: () => { stp.rule = k === 'nth' ? { kind: 'nth', n: (stp.rule && stp.rule.n) || 3 } : { kind: k }; s.refresh(); } }, l)))),
          stp.rule && stp.rule.kind === 'nth' ? h('div.field', h('label', 'N (по счётчику человека)'), ruleN) : null,
          h('div.field', h('label', 'Контекст'), h('div.chips.wrap', [null, ...st.contexts()].map((c) => h('button.chip.small' + ((stp.ctx || null) === (c ? c.id : null) ? '.on' : ''), { onclick: () => { stp.ctx = c ? c.id : null; s.refresh(); } }, c ? c.name : 'нет')))),
          h('div.field', h('div.section-h', { style: { margin: 0 } }, h('span', 'Заготовка'), h('span.grow'),
            h('button.chip.small', { onclick: async () => { const { copyText } = await import('../ui.js'); const ok = await copyText(draft.value); toast(ok ? 'Скопировано' : 'Не удалось скопировать'); } }, icon('copy', 14), 'Скопировать')),
            draft, a && a.private ? h('div.muted.small', 'Общий текст шаблона, без данных клиента: его можно копировать отсюда.') : null),
          h('div.row-btns',
            h('button.btn', { disabled: i === 0, onclick: () => { d.steps.splice(i - 1, 0, d.steps.splice(i, 1)[0]); s.refresh(); } }, icon('up', 16)),
            h('button.btn', { disabled: i === d.steps.length - 1, onclick: () => { d.steps.splice(i + 1, 0, d.steps.splice(i, 1)[0]); s.refresh(); } }, icon('down', 16)),
            h('button.btn.danger', { onclick: () => { d.steps.splice(i, 1); s.refresh(); } }, icon('trash', 16), 'Удалить шаг'))));
    });

    return h('div.form',
      isNew && d.steps.length ? h('div.card.calm', { style: { margin: 0 } }, 'Смещения шагов предложены по фактическим датам. Проверьте и сохраните.') : null,
      h('div.field', h('label', 'Название'), name),
      h('button.line-btn', { onclick: async () => { const { pickArea } = await import('./pickers.js'); const v = await pickArea(d.areaId); if (v !== undefined) { d.areaId = v; s.refresh(); } } }, icon('areas', 20), h('span.grow', 'Область'), h('span.val', a ? a.name : '—')),
      h('div.field', h('label', 'Синонимы для голоса (через запятую)'), syn),
      anchorBox,
      sectionHead('Шаги'),
      steps,
      h('button.btn', { onclick: () => { const id = st.uid(); d.steps.push({ id, text: '', offset: { kind: hasA ? 'before_days' : 'after_days', n: hasA ? 1 : 0 }, size: 'S', ctx: null, draft: '', rule: { kind: 'every' } }); openStep = id; s.refresh(); } }, icon('plus', 18), 'Шаг'),
      h('div.row-btns',
        h('button.btn.primary', {
          onclick: () => {
            if (!d.name.trim()) { toast('Нужно название'); return; }
            d.steps = d.steps.filter((x) => x.text.trim());
            st.saveTemplate({ ...d, name: d.name.trim() });
            toast('Шаблон сохранён');
            s.close();
          },
        }, 'Сохранить'),
        !isNew ? h('button.btn.danger', { onclick: async () => { if (await confirmBox('Удалить шаблон?', 'Уже созданные цепочки останутся.', 'Удалить')) { st.change(() => st.put('templates', { ...S.templates.get(d.id), deletedAt: st.clock().toISOString() })); s.close(); } } }, 'Удалить') : null),
    );
  }, { title: isNew ? 'Новый шаблон' : 'Шаблон', full: true });
}

export { clear, askPin };
