// Быстрая запись сессии ассистентом и её приём: отдельный заметный экран, проверка наложений.
import { h, icon, sheet, toast, choose, prompt, pickDate, pickTime, shareOut, quickDays, buzz } from '../ui.js';
import * as st from '../store.js';
import { S } from '../store.js';
import { fmtDay, fmtLong, fmtShort, addDays, dow, DOW_SHORT, dateTime, hm, ymd } from '../dates.js';
import { encodeSetup, sessionText, linkFor } from '../share.js';
import { app, isHidden, askPin } from './common.js';
import { calendarLink, stepsBlock, CHECK_HINT } from './calendar.js';
import { buildIcs } from '../ics.js';
import { appBase } from './share.js';

// ——— у ассистента: «Записать сессию» ———
export const recordTargets = () => (st.settings().contacts || []).filter((c) => c.iRecord);

export function openRecordForm() {
  const targets = recordTargets();
  if (!targets.length) { toast('Сначала включите у контакта «Я записываю ему сессии»'); return; }
  const T = st.T();
  const f = { to: targets[0].id, client: '', sd: T, stime: null, hasEnd: false, ed: T, etime: null };
  let saved = null; // запись после сохранения — экран-подтверждение
  const s = sheet(() => (saved ? confirmView() : formView()), { title: 'Записать сессию', full: true });

  function dayChips(value, set, extra = []) {
    return h('div.chips.wrap', extra, quickDays(st.clock()).map((q) => h('button.chip' + (value === q.date ? '.on' : ''), { onclick: () => { set(q.date); s.refresh(); } }, q.label)),
      h('button.chip', { onclick: async () => { const d = await pickDate({ now: st.clock(), value, allowWeek: false, allowMonth: false, allowNone: false }); if (d && d.date) { set(d.date); s.refresh(); } } }, quickDays(st.clock()).some((q) => q.date === value) ? 'Выбрать…' : fmtDay(value, st.clock())));
  }
  function timeBtn(value, set, label) {
    return h('button.btn', { 'aria-label': label, onclick: async () => { const t = await pickTime({ value, title: label }); if (t) { set(t.time); s.refresh(); } } }, icon('clock', 18), value || 'Время…');
  }

  function formView() {
    const client = h('input.input', { value: f.client, maxlength: 80, placeholder: 'Как вы его называете: имя, фамилия', autofocus: true, 'aria-label': 'Клиент', autocomplete: 'off', style: { fontSize: '1.15rem' } });
    client.addEventListener('input', () => { f.client = client.value; });
    return h('div.form',
      targets.length > 1 ? h('div.field', h('label', 'Для кого'), h('div.chips.wrap', targets.map((c) => h('button.chip' + (f.to === c.id ? '.on' : ''), { onclick: () => { f.to = c.id; s.refresh(); } }, c.name)))) : null,
      h('div.field', h('label', 'Клиент'), client),
      h('div.field', h('label', 'Начало'), dayChips(f.sd, (d) => { f.sd = d; if (!f.hasEnd || f.ed < d) f.ed = d; }), h('div', timeBtn(f.stime, (t) => { f.stime = t; }, 'Время начала'))),
      h('div.field', h('label', 'Окончание (необязательно)'),
        h('div.chips.wrap',
          h('button.chip' + (!f.hasEnd ? '.on' : ''), { onclick: () => { f.hasEnd = false; s.refresh(); } }, 'Без окончания'),
          h('button.chip' + (f.hasEnd ? '.on' : ''), { onclick: () => { f.hasEnd = true; if (f.ed < f.sd) f.ed = f.sd; s.refresh(); } }, 'Указать')),
        f.hasEnd ? h('div',
          h('div.chips.wrap',
            h('button.chip' + (f.ed === f.sd ? '.on' : ''), { onclick: () => { f.ed = f.sd; s.refresh(); } }, 'Тот же день'),
            h('button.chip' + (f.ed === addDays(f.sd, 1) ? '.on' : ''), { onclick: () => { f.ed = addDays(f.sd, 1); s.refresh(); } }, 'Следующий день'),
            h('button.chip', { onclick: async () => { const d = await pickDate({ now: st.clock(), value: f.ed, allowWeek: false, allowMonth: false, allowNone: false }); if (d && d.date) { f.ed = d.date; s.refresh(); } } }, f.ed !== f.sd && f.ed !== addDays(f.sd, 1) ? fmtDay(f.ed, st.clock()) : 'Выбрать…')),
          timeBtn(f.etime, (t) => { f.etime = t; }, 'Время окончания')) : null),
      h('button.btn.primary.block', { style: { minHeight: '3.5rem', fontSize: '1.1rem', marginTop: '.5rem' }, onclick: save }, 'Сохранить'),
    );
  }

  function save() {
    if (!f.client.trim()) { toast('Напишите, кто клиент'); return; }
    if (f.hasEnd && f.stime && f.etime && dateTime(f.ed, f.etime) <= dateTime(f.sd, f.stime)) { toast('Окончание должно быть позже начала'); return; }
    const to = targets.find((c) => c.id === f.to) || targets[0];
    const rec = {
      id: st.uid(), to: to.name, client: f.client.trim(), at: st.clock().toISOString(), sent: false,
      start: { date: f.sd, time: f.stime }, end: f.hasEnd ? { date: f.ed, time: f.etime } : null,
    };
    st.change(() => st.setMeta('recordedSessions', [rec, ...st.meta('recordedSessions', [])].slice(0, 30)));
    buzz(10);
    saved = rec;
    s.refresh();
  }

  // После сохранения — единственное действие: в общий Яндекс.Календарь (его видят оба).
  let calDone = null;
  function confirmView() {
    const r = saved;
    return h('div.added',
      h('div.okmark', icon('check')),
      h('h2', 'Записано'),
      h('p', { style: { fontSize: '1.1rem', margin: 0 } }, r.client),
      h('p.muted', { style: { margin: 0 } }, sessionText(r, '', st.clock()).replace(/^сессия [^—]*— /, '')),
      calDone ? h('div', { style: { maxWidth: '22rem', marginTop: '1rem' } }, stepsBlock()) : null,
      h('div', { style: { marginTop: '1rem', width: '100%', maxWidth: '22rem' } },
        calendarLink(sessionIcs(r, st.clock()), 'sessiya-' + r.start.date + '.ics', {
          label: calDone ? 'Скачать файл ещё раз' : 'Добавить в Яндекс.Календарь', source: 'session',
          onDone: () => {
            st.change(() => st.setMeta('recordedSessions', st.meta('recordedSessions', []).map((x) => (x.id === r.id ? { ...x, sent: true } : x))));
            calDone = true;
            s.refresh();
          },
        })),
      h('p.muted.small.cal-hint', { style: { maxWidth: '22rem' } }, CHECK_HINT));
  }
}

/** Событие сессии для общего календаря: без имени клиента, только инициалы. */
export function sessionIcs(r, now) {
  const dur = st.spanMin(r.start, r.end);
  const t = { id: r.id, text: 'Сессия' + (r.client ? ' · ' + st.suggestCode(r.client) : ''), date: r.start.date, time: r.start.time || null, dur };
  return buildIcs(t, { kind: t.time ? 'time' : 'day', now });
}

// ——— у меня: заметный экран записи сессии ———
export function sessionScreen(obj) {
  if (st.wasReceived(obj)) { toast('Эта запись уже в плане'); return; }
  const tg = st.sessionTargets(obj);
  const areaObj = st.area(tg.areaId);
  const priv = !!(areaObj && areaObj.private) || !!(tg.privArea && (!areaObj || areaObj.private));
  let shown = !priv;
  let busy = false;
  const now = st.clock();
  const when = (p) => (p ? fmtLong(p.date) + (p.time ? ', ' + p.time : '') : 'не указан');
  const s = sheet(() => {
    const p = tg.person;
    const clientEl = shown ? h('b', obj.client || 'не указан') : h('button.masked', {
      'aria-label': 'Показать клиента',
      onclick: async () => {
        const a = tg.privArea || areaObj;
        if (a && a.pinLock && st.settings().pinHash && !(await askPin('Показать клиента'))) return;
        shown = true; s.refresh();
      },
    }, '•••');
    return h('div.form',
      h('div.card.calm', { style: { margin: 0 } },
        h('div.muted.small', 'Запись сессии' + (obj.from ? ' от ' + obj.from : '')),
        h('dl.kv', { style: { fontSize: '1.05rem', marginTop: '.5rem' } },
          h('dt', 'Клиент'), h('dd', clientEl, !shown ? null : p ? h('span.muted', ' · ' + p.code + ', сессия №' + ((p.counter || 0) + 1))
            : tg.candidates.length ? h('span.muted', ' · похоже на: ' + tg.candidates.map((x) => x.code).join(', ')) : obj.client ? h('span.muted', ' · новый') : null),
          h('dt', 'Начало'), h('dd', when(obj.start)),
          h('dt', 'Конец'), h('dd', obj.end ? when(obj.end) : 'не указан'),
          h('dt', 'Область'), h('dd', areaObj ? [areaObj.private ? icon('lock', 14) : null, ' ' + areaObj.name] : '—'))),
      h('button.btn.primary.block', { style: { minHeight: '3.75rem', fontSize: '1.15rem' }, disabled: busy, onclick: () => addFlow() }, icon('plan', 20), 'Добавить в план'),
      h('button.btn.ghost.block', {
        onclick: () => { const r = st.sessionToInbox(obj); s.close(); toast('Во «Входящие»', { action: 'Отменить', onAction: () => r.undo() }); },
      }, 'Не сейчас — во «Входящие»'));
  }, { title: 'Запись сессии', full: true });

  async function addFlow() {
    const cur = { start: { ...obj.start }, end: obj.end ? { ...obj.end } : null };
    const dur0 = st.spanMin(cur.start, cur.end);
    for (let guard = 0; guard < 10; guard++) {
      // проверяем период начало–конец (без конца — длительность якоря из шаблона)
      const effDur = dur0 || (tg.tpl && tg.tpl.anchor ? Number(tg.tpl.anchor.dur) || 0 : 0);
      let endD = null, endT = null;
      if (cur.start.time && effDur) {
        const e = new Date(dateTime(cur.start.date, cur.start.time).getTime() + effDur * 60000);
        endD = ymd(e); endT = hm(e);
      }
      const hits = st.overlapsFor(cur.start.date, cur.start.time, endD, endT);
      if (!hits.length) break;
      const lines = hits.map((x) => {
        const label = x.task && isHidden(x.task) ? '•••' : x.label;
        return label + ' — ' + DOW_SHORT[dow(x.date) - 1] + ' ' + fmtShort(x.date) + ', ' + x.start + (x.end ? '–' + x.end : '');
      });
      const v = await choose('Накладывается по времени', [
        { label: 'Добавить всё равно', value: 'add', primary: true },
        { label: 'Изменить время', value: 'change' },
      ], { text: 'Время сессии пересекается с: ' + lines.join('; ') + '.' });
      if (!v) return;
      if (v === 'add') break;
      const d = await pickDate({ now: st.clock(), value: cur.start.date, title: 'Дата сессии', allowWeek: false, allowMonth: false, allowNone: false });
      if (!d || !d.date) return;
      const t = await pickTime({ value: cur.start.time, title: 'Начало' });
      if (t === null) return;
      cur.start = { date: d.date, time: t.time || cur.start.time };
      if (dur0) {
        const e = new Date(dateTime(cur.start.date, cur.start.time).getTime() + dur0 * 60000);
        cur.end = { date: ymd(e), time: hm(e) };
      }
    }
    // кто это: точное совпадение имени — сразу; похожие — короткий выбор; иначе новый человек
    const opts = {};
    if (!tg.person && obj.client && tg.privArea) {
      const lock = tg.privArea.pinLock && st.settings().pinHash;
      if (lock && !shown && !(await askPin('Клиент'))) return;
      let pick = 'new';
      if (tg.candidates.length) {
        const names = tg.candidates.map((p) => '«' + p.code + '»');
        pick = await choose('Кто это?', [
          ...tg.candidates.map((p) => ({ label: 'Это ' + p.code, value: p.id, hint: 'сессия №' + ((p.counter || 0) + 1) })),
          { label: 'Новый человек', value: 'new' },
        ], { text: 'Имя «' + obj.client + '» похоже на ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' или ' + names[names.length - 1] : names[0]) + '.' });
        if (!pick) return;
      }
      if (pick === 'new') {
        const code = await prompt('Новый клиент', st.suggestCode(obj.client), {
          text: '«' + obj.client + '» — новый человек в «' + tg.privArea.name + '». Как отметить его у себя? Код или инициалы — только для вас, ' + (obj.from || 'ассистенту') + ' их знать не нужно.',
          placeholder: 'Например: А.К.', max: 20, ok: 'Создать',
        });
        if (code === null) return;
        if (code) opts.createCode = code;
      } else opts.personId = pick;
    }
    const r = st.addSession(obj, cur, opts);
    buzz(10);
    s.close();
    const label = r.group ? (st.isPrivate({ areaId: r.group.areaId }) ? r.group.templateName : r.group.title) : 'Сессия';
    // и сразу — в общий календарь (для закрытой области там будет просто «Встреча»)
    const { offerCalendar } = await import('./calendar.js');
    const anchorT = (r.tasks || []).find((x) => x.isAnchor) || (r.tasks || [])[0];
    const cal = anchorT && offerCalendar(S.tasks.get(anchorT.id));
    toast('В плане: ' + label + ' — ' + fmtDay(cur.start.date, now) + (cur.start.time ? ' ' + cur.start.time : ''), { extra: cal, action: 'Отменить', onAction: () => r.undo(), duration: cal ? 12000 : undefined });
  }
}

// ——— настройка контакта ———
export async function sendSetup(contact) {
  const me = st.settings().myName || '';
  const url = linkFor(encodeSetup(st.uid(), me, true), appBase(), 't');
  const res = await shareOut({ title: 'Настройка', text: (me || 'Я') + ' просит записывать ему сессии: откройте ссылку в планировщике.', url });
  if (res === 'copied') toast('Ссылка скопирована — отправьте её ' + contact.name);
}

/** У ассистента: ссылка-настройка от «начальника». */
export function setupScreen(obj) {
  const from = obj.from || 'Контакт';
  choose(from + ' просит записывать ему сессии', [
    { label: obj.recordSessions ? 'Включить «Записать сессию»' : 'Выключить', value: true, primary: true },
    { label: 'Не сейчас', value: false },
  ], { text: 'На экране «Сегодня» появится крупный пункт «Записать сессию»: кто клиент, начало и окончание — и одна кнопка «Добавить в Яндекс.Календарь».' }).then((v) => {
    if (!v) return;
    const contacts = [...(st.settings().contacts || [])];
    const c = st.contactByName(from);
    if (c) contacts.splice(contacts.indexOf(c), 1, { ...c, iRecord: obj.recordSessions });
    else contacts.push({ id: st.uid(), name: from, areaId: null, iRecord: obj.recordSessions });
    st.setSettings({ contacts });
    toast(obj.recordSessions ? 'Готово: «Записать сессию» — на экране «Сегодня»' : 'Выключено');
    app.go('today');
  });
}

export { S };
