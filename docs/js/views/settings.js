// Настройки, резервная копия, контексты, постоянные блоки, особые дни, журнал, поиск.
import { h, icon, sheet, toast, choose, prompt, confirmBox, pickDate, pickTime, shareOut, clear } from '../ui.js';
import * as st from '../store.js';
import { S } from '../store.js';
import * as db from '../db.js';
import { fmtDay, DOW_SHORT, DOW_FULL, ymd, fmtShort } from '../dates.js';
import { app, taskRow, emptyState, sectionHead, hiddenArea, unlockArea } from './common.js';
import { describeBlock } from '../blocks.js';

export function openSettings() {
  const s = sheet(() => {
    const cfg = st.settings();
    const line = (ic, label, val, fn) => h('button.line-btn', { onclick: fn }, icon(ic, 20), h('span.grow', label), val != null ? h('span.val', val) : icon('right', 18));
    return h('div',
      line('person', 'Моё имя', cfg.myName || '—', async () => { const v = await prompt('Моё имя', cfg.myName, { text: 'Так вас увидят получатели задач.', max: 60 }); if (v !== null) st.setSettings({ myName: v }); }),
      line('send', 'Контакты для обмена', String((cfg.contacts || []).length), () => contactsSheet()),
      line('phone', 'Контексты', String(st.contexts().length), () => contextsSheet()),
      line('clock', 'Постоянные блоки недели', String(st.meta('blocks', []).length), () => blocksSheet()),
      line('grid', 'Ёмкость дня', (cfg.capacity || []).join(' · ') + ' ч', () => capacitySheet()),
      line('sun', 'Церковный календарь', cfg.church && cfg.church.enabled !== false ? 'учитывать' : 'не учитывать', () => churchSheet()),
      line('cal', 'Особые дни', String(st.meta('specialDays', []).length), () => specialDaysSheet()),
      line('plan', 'Начало года', cfg.yearStart === 1 ? '1 января' : '1 сентября', async () => {
        const v = await choose('Начало года', [{ label: '1 сентября — церковное новолетие, учебный год', value: 9 }, { label: '1 января', value: 1 }]);
        if (v) st.setSettings({ yearStart: v });
      }),
      line('lock', 'PIN для закрытых областей', cfg.pinHash ? 'задан' : 'нет', () => pinSheet()),
      line('download', 'Резервная копия', st.meta('lastExport') ? fmtDay(st.meta('lastExport').slice(0, 10), st.clock()) : 'не было', () => backupSheet()),
      line('check', 'Журнал сделанного', null, () => journalSheet()),
      h('p.muted.small', { style: { marginTop: '1rem' } }, 'Данные хранятся только на этом устройстве. Никаких серверов и аккаунтов.'),
      h('p.muted.small', st.meta('persisted') ? 'Хранилище защищено от автоматической очистки браузером.' : 'Браузер пока не подтвердил защиту хранилища от очистки — тем важнее регулярная копия. Обычно защита включается после установки на рабочий стол.'),
      h('p.faint.small', 'Версия данных: ' + db.SCHEMA),
    );
  }, { title: 'Настройки' });
  const un = st.subscribe(() => s.refresh());
  const prev = s.onClose; s.onClose = () => { un(); prev && prev(); };
}

function listSheet(title, render) {
  const s = sheet((api) => render(api), { title });
  const un = st.subscribe(() => { if (!s.el.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') s.refresh(); });
  const prev = s.onClose; s.onClose = () => { un(); prev && prev(); };
  return s;
}

export function contactsSheet() {
  listSheet('Контакты', () => {
    const cfg = st.settings();
    const list = cfg.contacts || [];
    const save = (contacts) => st.setSettings({ contacts });
    return h('div',
      h('p.muted.small', 'Просто имена. Область — куда попадают задачи от этого человека.'),
      list.map((c) => {
        const ar = st.area(c.areaId);
        const upd = (patch) => save(st.settings().contacts.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
        const sw = (on, label, hint, fn) => h('button.line-btn', { role: 'switch', 'aria-checked': String(!!on), 'aria-label': label + ' — ' + c.name, onclick: fn },
          h('span.grow', label, h('div.muted.small', hint)), h('span.switch' + (on ? '.on' : '')));
        return h('div.card', { style: { margin: '.4rem 0' } },
          h('div.line-btn',
            h('span.grow', h('b', c.name), h('div.muted.small', ar && ar.private ? icon('lock', 12) : null, ' входящие → ' + (ar ? ar.name + (ar.private ? ' (закрытая: скрыто сразу)' : '') : 'без области'))),
            h('button.chip.small', { 'aria-label': 'Область для ' + c.name, onclick: async () => { const { pickArea } = await import('./pickers.js'); const v = await pickArea(c.areaId, { title: 'Входящие от «' + c.name + '» — в область' }); if (v !== undefined) upd({ areaId: v }); } }, 'Область'),
            h('button.icon-btn', { 'aria-label': 'Переименовать', onclick: async () => { const v = await prompt('Имя', c.name, { max: 60 }); if (v) upd({ name: v }); } }, icon('edit', 18)),
            h('button.icon-btn', { 'aria-label': 'Удалить', onclick: () => save(st.settings().contacts.filter((x) => x.id !== c.id)) }, icon('trash', 18))),
          sw(c.recordsForMe, 'Записывает мне сессии', 'У неё в приложении появится «Записать сессию»', async () => {
            upd({ recordsForMe: !c.recordsForMe });
            if (!c.recordsForMe) {
              const v = await choose('Отправить ' + c.name + ' настройку?', [{ label: 'Отправить ' + c.name, value: true, primary: true, icon: 'send' }, { label: 'Позже', value: false }],
                { text: 'Ссылка включит у неё крупный пункт «Записать сессию».' });
              if (v) { const { sendSetup } = await import('./session.js'); sendSetup(c); }
            }
          }),
          sw(c.iRecord, 'Я записываю ему сессии', 'На «Сегодня» — крупный пункт «Записать сессию»', () => upd({ iRecord: !c.iRecord })));
      }),
      h('div.row-btns', h('button.btn', { onclick: async () => { const v = await prompt('Новый контакт', '', { placeholder: 'Например: Жена', max: 60 }); if (v) save([...list, { id: st.uid(), name: v, areaId: null }]); } }, icon('plus', 18), 'Контакт')));
  });
}

export function contextsSheet() {
  listSheet('Контексты', () => {
    const list = st.contexts();
    const save = (v) => st.change(() => st.setMeta('contexts', v));
    return h('div',
      h('p.muted.small', 'Где или чем можно сделать. Слова — для распознавания при вводе.'),
      list.map((c) => {
        const syn = h('input.input', { value: (c.synonyms || []).join(', '), maxlength: 500, 'aria-label': 'Слова для ' + c.name });
        syn.addEventListener('change', () => save(st.contexts().map((x) => x.id === c.id ? { ...x, synonyms: syn.value.split(',').map((y) => y.trim()).filter(Boolean) } : x)));
        return h('div.card', h('div.line-btn', h('b.grow', c.name),
          h('button.icon-btn', { 'aria-label': 'Переименовать', onclick: async () => { const v = await prompt('Название', c.name, { max: 40 }); if (v) save(st.contexts().map((x) => x.id === c.id ? { ...x, name: v } : x)); } }, icon('edit', 18)),
          h('button.icon-btn', { 'aria-label': 'Удалить', onclick: () => save(st.contexts().filter((x) => x.id !== c.id)) }, icon('trash', 18))), syn);
      }),
      h('div.row-btns', h('button.btn', { onclick: async () => { const v = await prompt('Новый контекст', '', { max: 40 }); if (v) save([...list, { id: st.uid(), name: v, synonyms: [] }]); } }, icon('plus', 18), 'Контекст')));
  });
}

export function blocksSheet() {
  listSheet('Постоянные блоки', () => {
    const list = [...st.meta('blocks', [])].sort((a, b) => a.dow - b.dow || (a.start < b.start ? -1 : 1));
    const save = (v) => st.change(() => st.setMeta('blocks', v));
    return h('div',
      h('p.muted.small', 'Службы, приёмы, пары — то, что повторяется каждую неделю. Учитываются в нагрузке и видны на ленте дня.'),
      list.map((b) => h('div.line-btn',
        h('span.dot', { style: { background: (st.area(b.areaId) || {}).color || 'var(--faint)' } }),
        h('span.grow', b.title || (st.area(b.areaId) || {}).name || 'Блок', h('div.muted.small', describeBlock(b, st.blockDur(b.areaId)))),
        h('button.icon-btn', { 'aria-label': 'Удалить блок', onclick: () => save(st.meta('blocks', []).filter((x) => x.id !== b.id)) }, icon('trash', 18)))),
      h('div.row-btns', h('button.btn', { onclick: () => addBlock() }, icon('plus', 18), 'Блок')));
  });
}

export async function addBlock() {
  const title = await prompt('Что это', '', { placeholder: 'Например: Литургия', max: 60 });
  if (title === null) return;
  const { pickArea } = await import('./pickers.js');
  const areaId = await pickArea(null);
  if (areaId === undefined) return;
  const days = await new Promise((resolve) => {
    let sel = [];
    let done = false;
    const s = sheet(() => h('div', h('div.chips.wrap', DOW_SHORT.map((d, i) => h('button.chip' + (sel.includes(i + 1) ? '.on' : ''), { onclick: () => { sel = sel.includes(i + 1) ? sel.filter((x) => x !== i + 1) : [...sel, i + 1]; s.refresh(); } }, d))),
      h('div.row-btns', h('button.btn.primary', { disabled: !sel.length, onclick: () => { done = true; s.close(); resolve(sel); } }, 'Дальше'))), { title: 'Дни недели', onClose: () => { if (!done) resolve(null); } });
  });
  if (!days) return;
  const a = await pickTime({ title: 'Начало' });
  if (!a || !a.time) return;
  // окончание необязательно; может быть и на следующий день («пн 16:00 → вт 16:00»)
  const dflt = st.blockDur(areaId);
  const kind = await choose('Окончание', [
    { label: 'Без окончания', hint: 'по умолчанию ' + (dflt % 60 ? dflt + ' мин' : dflt / 60 + ' ч'), value: 'none', primary: true },
    { label: 'В тот же день…', value: 'same' },
    { label: 'На следующий день…', value: 'next' },
  ]);
  if (!kind) return;
  let end = null, next = false;
  if (kind !== 'none') {
    const b = await pickTime({ title: kind === 'next' ? 'Конец (на следующий день)' : 'Конец', value: a.time });
    if (!b || !b.time) return;
    if (kind === 'same' && b.time <= a.time) { toast('Конец должен быть позже начала'); return; }
    end = b.time;
    next = kind === 'next';
  }
  st.change(() => st.setMeta('blocks', [...st.meta('blocks', []), ...days.map((d) => ({
    id: st.uid(), title, areaId, dow: d, start: a.time,
    ...(end ? { end, endDow: next ? (d % 7) + 1 : d } : {}),
  }))]));
}

function capacitySheet() {
  listSheet('Ёмкость дня', () => {
    const cap = [...(st.settings().capacity || [8, 8, 8, 8, 8, 6, 5])];
    return h('div',
      h('p.muted.small', 'Сколько часов в день реально есть на дела — включая постоянные блоки.'),
      DOW_FULL.map((d, i) => h('div.line-btn', h('span.grow', d),
        h('button.icon-btn', { 'aria-label': 'Меньше', onclick: () => { cap[i] = Math.max(0, cap[i] - 1); st.setSettings({ capacity: cap }); } }, '−'),
        h('b', { style: { minWidth: '3rem', textAlign: 'center' } }, cap[i] + ' ч'),
        h('button.icon-btn', { 'aria-label': 'Больше', onclick: () => { cap[i] = Math.min(16, cap[i] + 1); st.setSettings({ capacity: cap }); } }, '+'))));
  });
}

function churchSheet() {
  listSheet('Церковный календарь', () => {
    const c = { enabled: true, feast: 3, eve: 2, holy: 3, ...(st.settings().church || {}) };
    const set = (patch) => st.setSettings({ church: { ...c, ...patch } });
    const stepper = (label, key) => h('div.line-btn', h('span.grow', label),
      h('button.icon-btn', { 'aria-label': 'Меньше', onclick: () => set({ [key]: Math.max(0, c[key] - 1) }) }, '−'),
      h('b', { style: { minWidth: '3rem', textAlign: 'center' } }, '−' + c[key] + ' ч'),
      h('button.icon-btn', { 'aria-label': 'Больше', onclick: () => set({ [key]: Math.min(12, c[key] + 1) }) }, '+'));
    return h('div',
      h('button.line-btn', { role: 'switch', 'aria-checked': String(c.enabled !== false), onclick: () => set({ enabled: c.enabled === false }) }, h('span.grow', 'Уменьшать ёмкость в праздники'), h('span.switch' + (c.enabled !== false ? '.on' : ''))),
      stepper('Двунадесятые, великие, Пасха', 'feast'),
      stepper('Накануне (всенощная)', 'eve'),
      stepper('Страстная седмица', 'holy'),
      h('p.muted.small', 'Пасхалия юлианская, даты в новом стиле. Посты и праздники видны в плане месяца и года.'));
  });
}

function specialDaysSheet() {
  listSheet('Особые дни', () => {
    const list = [...st.meta('specialDays', [])].sort((a, b) => (a.date < b.date ? -1 : 1));
    const save = (v) => st.change(() => st.setMeta('specialDays', v));
    return h('div',
      h('p.muted.small', 'Архиерейская служба, престольный праздник — дни, когда времени меньше.'),
      list.map((d) => h('div.line-btn', h('span.grow', d.title, h('div.muted.small', fmtShort(d.date) + (d.yearly ? ' · ежегодно' : '') + ' · −' + d.hours + ' ч')),
        h('button.icon-btn', { 'aria-label': 'Удалить', onclick: () => save(st.meta('specialDays', []).filter((x) => x.id !== d.id)) }, icon('trash', 18)))),
      h('div.row-btns', h('button.btn', {
        onclick: async () => {
          const title = await prompt('Особый день', '', { placeholder: 'Например: Престольный праздник', max: 80 });
          if (!title) return;
          const d = await pickDate({ now: st.clock(), allowWeek: false, allowMonth: false, allowNone: false });
          if (!d || !d.date) return;
          const yearly = await choose('Повторять каждый год?', [{ label: 'Да, ежегодно', value: 'y', primary: true }, { label: 'Только в этот раз', value: 'n' }]);
          if (!yearly) return;
          const hours = await choose('Насколько меньше времени?', [2, 4, 6, 8].map((x) => ({ label: '−' + x + ' ч', value: x })));
          if (!hours) return;
          save([...st.meta('specialDays', []), { id: st.uid(), title, date: d.date, yearly: yearly === 'y', hours }]);
        },
      }, icon('plus', 18), 'Особый день')));
  });
}

async function pinSheet() {
  const cfg = st.settings();
  if (cfg.pinHash) {
    const v = await choose('PIN', [{ label: 'Сменить PIN', value: 'change' }, { label: 'Убрать PIN', value: 'remove', danger: true }]);
    if (!v) return;
    const { askPin } = await import('./common.js');
    if (!(await askPin('Текущий PIN'))) return;
    if (v === 'remove') {
      await st.setPin(null);
      st.change(() => { for (const a of st.areasList(true)) if (a.pinLock) st.put('areas', { ...a, pinLock: false }); });
      toast('PIN убран');
      return;
    }
  }
  const pin = await prompt('Новый PIN', '', { text: '4 цифры. Хранится только как хэш — если забудете, PIN можно убрать, лишь зная его; данные при этом не теряются из резервной копии.', inputmode: 'numeric', type: 'password', max: 4 });
  if (!pin) return;
  if (!/^\d{4}$/.test(pin)) { toast('Нужно ровно 4 цифры'); return; }
  await st.setPin(pin);
  toast('PIN сохранён');
}

// ——— резервная копия ———
export async function exportData() {
  const snap = await st.exportSnapshot();
  const json = JSON.stringify(snap);
  const name = 'planner-' + ymd(st.clock()) + '.json';
  const file = new File([json], name, { type: 'application/json' });
  const r = await shareOut({ file, title: 'Резервная копия планировщика' });
  if (r === 'aborted') return false;
  st.markExported();
  toast(r === 'downloaded' ? 'Копия сохранена в «Загрузки»' : 'Копия сохранена');
  return true;
}

export function backupSheet() {
  const s = sheet(() => {
    const last = st.meta('lastExport');
    const wrap = h('div');
    wrap.append(
      h('p.muted', last ? 'Последняя копия: ' + fmtDay(last.slice(0, 10), st.clock()) : 'Копий пока не было.'),
      h('div.row-btns', h('button.btn.primary', { onclick: () => exportData() }, icon('download', 18), 'Сохранить копию (JSON)')),
      h('p.muted.small', 'Один файл со всеми задачами, областями, людьми и шаблонами. Храните его в облаке или отправьте себе.'),
      sectionHead('Восстановить'),
      h('div.row-btns', h('button.btn', { onclick: () => importFlow() }, 'Загрузить из файла…')),
      sectionHead('Внутренние копии'),
      h('p.muted.small', 'Приложение само делает копию раз в день и перед каждым обновлением данных.'),
    );
    const list = h('div');
    wrap.append(list);
    db.listBackups().then((items) => {
      if (!items.length) { list.append(h('p.faint.small', 'Пока нет.')); return; }
      for (const b of items) {
        const t = b.snapshot && b.snapshot.data && b.snapshot.data.tasks ? b.snapshot.data.tasks.length : 0;
        list.append(h('div.line-btn',
          h('span.grow', new Date(b.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
            h('div.muted.small', ({ daily: 'ежедневная', 'before-import': 'перед загрузкой', 'before-restore': 'перед восстановлением' }[b.reason] || (b.reason.startsWith('before-migration') ? 'перед обновлением' : b.reason)) + ' · задач: ' + t)),
          h('button.chip.small', {
            onclick: async () => {
              if (!(await confirmBox('Восстановить эту копию?', 'Текущие данные сначала сохранятся во внутреннюю копию.', 'Восстановить'))) return;
              await st.restoreBackup(b);
              toast('Восстановлено');
              s.close();
              app.render();
            },
          }, 'Восстановить')));
      }
    });
    return wrap;
  }, { title: 'Резервная копия' });
}

export function importFlow(file) {
  const run = async (f) => {
    if (!f) return;
    if (f.size > 30 * 1024 * 1024) { toast('Файл слишком большой'); return; }
    const text = await f.text();
    const v = db.validateImport(text);
    if (!v.ok) { toast(v.error); return; }
    const sm = v.summary;
    const ok = await choose('Загрузить копию?', [
      { label: 'Загрузить', value: true, primary: true },
      { label: 'Отмена', value: false },
    ], { text: 'Будет загружено: задач в работе — ' + sm.tasks + ', сделанных — ' + sm.done + ', областей — ' + sm.areas + ', людей — ' + sm.people + ', шаблонов — ' + sm.templates + (sm.exportedAt ? '. Копия от ' + new Date(sm.exportedAt).toLocaleDateString('ru-RU') : '') + '. Текущие данные заменятся, но сначала сохранятся во внутреннюю копию.' });
    if (!ok) return;
    await st.importSnapshot(v.snapshot);
    toast('Данные загружены');
    app.render();
  };
  if (file) return run(file);
  const inp = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  inp.addEventListener('change', () => { run(inp.files[0]); inp.remove(); });
  document.body.append(inp);
  inp.click();
}

// ——— журнал и поиск ———
export function journalSheet() {
  let q = '';
  sheet(() => {
    const inp = h('input.input', { value: q, placeholder: 'Поиск по сделанному', 'aria-label': 'Поиск по сделанному', type: 'search' });
    inp.addEventListener('input', () => { q = inp.value; draw(); });
    const box = h('div');
    const draw = () => {
      clear(box);
      const nq = q.trim().toLowerCase().replace(/ё/g, 'е');
      const all = [...S.tasks.values()].filter((t) => t.status === 'done' && !t.deletedAt && t.doneAt && (!hiddenArea(t.areaId) || !nq))
        .filter((t) => !nq || (t.text + ' ' + (t.note || '')).toLowerCase().replace(/ё/g, 'е').includes(nq))
        .sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1)).slice(0, 300);
      let cur = '';
      for (const t of all) {
        const d = ymd(new Date(t.doneAt));
        if (d !== cur) { cur = d; box.append(sectionHead(fmtDay(d, st.clock()))); }
        box.append(taskRow(t, { noSelect: true }));
      }
      if (!all.length) box.append(emptyState(nq ? 'Ничего не нашлось.' : 'Сделанное появится здесь.', null, 'check'));
    };
    draw();
    return h('div', inp, box);
  }, { title: 'Журнал сделанного', full: true });
}

export function searchSheet() {
  let q = '';
  sheet(() => {
    const inp = h('input.input', { value: q, placeholder: 'Поиск по всем задачам', autofocus: true, type: 'search', 'aria-label': 'Поиск' });
    const box = h('div');
    const draw = () => {
      clear(box);
      const nq = q.trim().toLowerCase().replace(/ё/g, 'е');
      if (!nq) { box.append(h('p.muted.small', 'Ищет по тексту, заметкам и шагам, включая сделанное. Закрытые области — только после открытия.')); }
      else {
        const res = [...S.tasks.values()].filter((t) => !t.deletedAt && !hiddenArea(t.areaId))
          .filter((t) => [t.text, t.note, t.draft, ...(t.checklist || []).map((c) => c.text), (st.person(t.personId) || {}).code].join(' ').toLowerCase().replace(/ё/g, 'е').includes(nq))
          .sort((a, b) => (a.status === 'done') - (b.status === 'done') || ((a.date || '9') < (b.date || '9') ? -1 : 1)).slice(0, 200);
        if (res.length) box.append(h('div.list', res.map((t) => taskRow(t, { showDate: true, showDone: true, noSelect: true }))));
        else box.append(emptyState('Ничего не нашлось.', null, 'search'));
      }
      const locked = st.areasList(true).filter((a) => a.private && hiddenArea(a.id));
      if (locked.length && nq) box.append(h('div.chips.wrap', { style: { marginTop: '1rem' } }, locked.map((a) => h('button.chip.small', { onclick: async () => { if (await unlockArea(a.id)) draw(); } }, icon('lock', 14), 'Искать в «' + a.name + '»'))));
    };
    inp.addEventListener('input', () => { q = inp.value; draw(); });
    draw();
    return h('div', inp, box);
  }, { title: 'Поиск', full: true });
}
