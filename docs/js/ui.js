// Мини-набор для интерфейса: построение DOM (только textContent), листы, тосты, выбор даты и времени.
import {
  today, addDays, dow, weekStart, monthStart, daysInMonth, mkDate, fmtShort, DOW_SHORT, MONTHS_NOM, parseYmd, fromMin,
} from './dates.js';

/** h('div.cls', {on:{click}}, 'текст', child) — строки всегда становятся текстовыми узлами. */
export function h(tag, props, ...kids) {
  const [nameId, ...cls] = tag.split('.');
  const [name, id] = nameId.split('#');
  const el = document.createElement(name || 'div');
  if (id) el.id = id;
  if (cls.length) el.className = cls.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    kids.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = (el.className ? el.className + ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'autofocus' || k === 'hidden') el[k] = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) append(el, k);
    else if (k instanceof Node) el.appendChild(k);
    else el.appendChild(document.createTextNode(String(k)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// ——— значки (собственные контуры) ———
const P = {
  check: 'M5 12.5l4.2 4.2L19 7',
  plus: 'M12 5v14M5 12h14',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5L20 20',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  sun: 'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z',
  inbox: 'M4 13l2.5-7h11L20 13v5H4zM4 13h4.5l1 2h5l1-2H20',
  plan: 'M5 5h14v15H5zM5 9h14M9 3v4M15 3v4',
  areas: 'M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z',
  star: 'M12 4l2.4 5 5.3.6-4 3.7 1.1 5.3L12 16l-4.8 2.6 1.1-5.3-4-3.7 5.3-.6z',
  clock: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8v4.5l3 2',
  flag: 'M6 20V4M6 5h10l-2 3.5L16 12H6',
  repeat: 'M5 10a6 6 0 0 1 10.5-3.5L18 9M18 4v5h-5M19 14a6 6 0 0 1-10.5 3.5L6 15M6 20v-5h5',
  person: 'M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20a7 7 0 0 1 14 0',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z',
  cal: 'M5 6h14v14H5zM5 10h14M9 4v4M15 4v4M9 14h2',
  list: 'M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01',
  grid: 'M4.5 4.5h15v15h-15zM12 4.5v15M4.5 12h15',
  heart: 'M12 19s-7-4.4-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 2.5C19 14.6 12 19 12 19z',
  chain: 'M8 8h3M13 8h3M8 16h3M13 16h3M6 8a2 2 0 1 0 0 .01M18 8a2 2 0 1 0 0 .01M6 16a2 2 0 1 0 0 .01M18 16a2 2 0 1 0 0 .01M12 8v8',
  phone: 'M6 4h3l1.5 4-2 1.5a10 10 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4 6a2 2 0 0 1 2-2z',
  undo: 'M9 7L4 12l5 5M4 12h10a5 5 0 0 1 0 10h-2',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  archive: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4',
  down: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  right: 'M9 6l6 6-6 6',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  gear: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8',
};
export function icon(name, size = 22) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('ico');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', P[name] || P.more);
  s.appendChild(p);
  return s;
}

// ——— вибрация и движение ———
export function buzz(ms = 12) { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* нет */ } }
export const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ——— листы (нижние панели) и кнопка «Назад» на Android ———
const stack = [];
let armed = false; // есть ли в истории наша запись для листов
let ignorePops = 0;
export function sheet(build, opts = {}) {
  // тост с «Отменить» не прячем, а поднимаем наверх, чтобы не закрывал лист
  if (toastEl) { toastEl.style.top = 'calc(env(safe-area-inset-top, 0px) + .75rem)'; toastEl.style.bottom = 'auto'; }
  const overlay = h('div.overlay' + (opts.full ? '.full' : ''));
  const panel = h('div.sheet' + (opts.full ? '.full' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || '' });
  const body = h('div.sheet-body');
  const api = { el: panel, body, close: () => close(api, true), refresh: null, onClose: opts.onClose };
  if (opts.title !== undefined || opts.full) {
    const head = h('div.sheet-head',
      opts.full ? h('button.icon-btn', { 'aria-label': 'Назад', onclick: () => api.close() }, icon('back')) : h('div.grab'),
      opts.title ? h('h2', opts.title) : h('span'),
      opts.headRight || h('span'));
    panel.append(head);
  } else panel.append(h('div.grab'));
  panel.append(body);
  overlay.append(panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay && !opts.modal) api.close(); });
  document.body.append(overlay);
  stack.push(api);
  if (!armed) { history.pushState({ sheet: 1 }, ''); armed = true; }
  const render = () => { clear(body); append(body, [build(api)]); };
  api.refresh = render;
  render();
  requestAnimationFrame(() => overlay.classList.add('open'));
  const f = panel.querySelector('[autofocus]');
  if (f) setTimeout(() => f.focus(), 60);
  return api;
}
function close(api, viaUser) {
  const i = stack.indexOf(api);
  if (i < 0) return;
  stack.splice(i, 1);
  const overlay = api.el.parentNode;
  overlay.classList.remove('open');
  setTimeout(() => overlay.remove(), reducedMotion() ? 0 : 200);
  if (viaUser && !stack.length && armed) { armed = false; ignorePops++; history.back(); }
  if (api.onClose) api.onClose();
}
export function closeAll() { while (stack.length) close(stack[stack.length - 1], true); }
export function topSheet() { return stack[stack.length - 1] || null; }
export function initBack(onBack) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) { e.preventDefault(); close(stack[stack.length - 1], true); }
  });
  window.addEventListener('popstate', () => {
    if (ignorePops) {
      ignorePops--;
      // пока ждали «назад», открылся новый лист — вернём ему запись в истории
      if (stack.length) { history.pushState({ sheet: 1 }, ''); armed = true; }
      return;
    }
    armed = false;
    const top = stack[stack.length - 1];
    if (top) {
      close(top, false);
      if (stack.length) { history.pushState({ sheet: 1 }, ''); armed = true; }
    } else if (onBack) onBack();
  });
}

// ——— тост с «Отменить» ———
let toastEl = null, toastTimer = null;
export function toast(msg, opts = {}) {
  if (!toastEl) {
    toastEl = h('div.toast', { role: 'status', 'aria-live': 'polite' });
    document.body.append(toastEl);
  }
  clear(toastEl);
  toastEl.append(h('span.toast-msg', msg));
  if (opts.action) {
    toastEl.append(h('button.toast-act', {
      onclick: () => { hideToast(); opts.onAction && opts.onAction(); },
    }, opts.action));
  }
  // над полем ввода; когда открыт лист — вверху, чтобы не закрывать его кнопки
  const comp = document.querySelector('.composer:not(.hidden)');
  if (stack.length || !comp) { toastEl.style.top = 'calc(env(safe-area-inset-top, 0px) + .75rem)'; toastEl.style.bottom = 'auto'; }
  else { toastEl.style.top = 'auto'; toastEl.style.bottom = Math.max(16, window.innerHeight - comp.getBoundingClientRect().top + 10) + 'px'; }
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.duration || (opts.action ? 6000 : 2600));
}
export function hideToast() { if (toastEl) toastEl.classList.remove('show'); }

// ——— выбор из вариантов ———
export function choose(title, options, opts = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(() => h('div.choices',
      opts.text ? h('p.muted', opts.text) : null,
      options.map((o) => h('button.choice' + (o.primary ? '.primary' : '') + (o.danger ? '.danger' : ''), {
        onclick: () => { done = true; s.close(); resolve(o.value); },
      }, o.icon ? icon(o.icon, 20) : null, h('span', o.label), o.hint ? h('small', o.hint) : null)),
    ), { title, onClose: () => { if (!done) resolve(null); } });
  });
}
export function confirmBox(title, text, yes = 'Да', no = 'Отмена') {
  return choose(title, [{ label: yes, value: true, primary: true }, { label: no, value: false }], { text }).then((v) => !!v);
}
export function prompt(title, value = '', opts = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(() => {
      const inp = h(opts.multiline ? 'textarea.input' : 'input.input', { value, placeholder: opts.placeholder || '', autofocus: true, maxlength: opts.max || 500, inputmode: opts.inputmode || null, type: opts.type || null, 'aria-label': title });
      const ok = () => { done = true; s.close(); resolve(inp.value.trim()); };
      if (!opts.multiline) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      return h('div.form', opts.text ? h('p.muted', opts.text) : null, inp, h('div.row-btns', h('button.btn.primary', { onclick: ok }, opts.ok || 'Готово')));
    }, { title, onClose: () => { if (!done) resolve(null); } });
  });
}

// ——— выбор даты ———
export function quickDays(now = new Date()) {
  const t = today(now);
  const res = [{ label: 'Сегодня', date: t }, { label: 'Завтра', date: addDays(t, 1) }];
  for (let i = 2; i <= 4; i++) {
    const d = addDays(t, i);
    res.push({ label: DOW_SHORT[dow(d) - 1] + ' ' + parseYmd(d).getDate(), date: d });
  }
  return res;
}

/** Лист выбора даты: → {date, dateKind} | {date:null} | null (отмена) */
export function pickDate(opts = {}) {
  const now = opts.now || new Date();
  return new Promise((resolve) => {
    let done = false;
    const t = today(now);
    let view = monthStart(opts.value || t);
    const finish = (v) => { done = true; s.close(); resolve(v); };
    const s = sheet(() => {
      const [y, m] = view.split('-').map(Number);
      const first = dow(view);
      const cells = [];
      for (let i = 1; i < first; i++) cells.push(h('span.cal-cell.empty'));
      for (let d = 1; d <= daysInMonth(y, m); d++) {
        const ds = mkDate(y, m, d);
        const extra = opts.decorate ? opts.decorate(ds) : null;
        cells.push(h('button.cal-cell' + (ds === t ? '.today' : '') + (ds === opts.value ? '.sel' : '') + (ds < t ? '.past' : ''), {
          onclick: () => finish({ date: ds, dateKind: 'day' }), 'aria-label': ds,
        }, String(d), extra));
      }
      return h('div.datepick',
        h('div.chips.wrap', quickDays(now).map((q) => h('button.chip', { onclick: () => finish({ date: q.date, dateKind: 'day' }) }, q.label)),
          opts.allowWeek !== false ? h('button.chip', { onclick: () => finish({ date: weekStart(t), dateKind: 'week' }) }, 'Эта неделя') : null,
          opts.allowWeek !== false ? h('button.chip', { onclick: () => finish({ date: addDays(weekStart(t), 7), dateKind: 'week' }) }, 'След. неделя') : null),
        h('div.cal-nav',
          h('button.icon-btn', { 'aria-label': 'Предыдущий месяц', onclick: () => { view = monthStart(addDays(view, -1)); s.refresh(); } }, icon('back')),
          h('b', MONTHS_NOM[m - 1] + ' ' + y),
          opts.allowMonth !== false ? h('button.chip.small', { onclick: () => finish({ date: view, dateKind: 'month' }) }, 'весь месяц') : null,
          h('button.icon-btn', { 'aria-label': 'Следующий месяц', onclick: () => { view = mkDate(y, m, daysInMonth(y, m)); view = addDays(view, 1); s.refresh(); } }, icon('right'))),
        h('div.cal-grid', DOW_SHORT.map((d) => h('span.cal-dow', d)), cells),
        opts.allowNone !== false ? h('div.row-btns', h('button.btn', { onclick: () => finish({ date: null, dateKind: null }) }, opts.noneLabel || 'Без даты')) : null,
      );
    }, { title: opts.title || 'Когда', onClose: () => { if (!done) resolve(null); } });
  });
}

/** Лист выбора времени: → {time, part, dur?} | {time:null, part:null} | null */
export function pickTime(opts = {}) {
  return new Promise((resolve) => {
    let done = false;
    let dur = opts.dur || null;
    const finish = (v) => { done = true; s.close(); resolve(v && opts.withDur ? { ...v, dur } : v); };
    const s = sheet(() => {
      const grid = [];
      for (let hh = 6; hh <= 23; hh++) {
        const row = [];
        for (let q = 0; q < 60; q += 15) {
          const t = fromMin(hh * 60 + q);
          row.push(h('button.tcell' + (t === opts.value ? '.sel' : '') + (q === 0 ? '.hour' : ''), { onclick: () => finish({ time: t, part: null }) }, q === 0 ? t : ':' + String(q).padStart(2, '0')));
        }
        grid.push(h('div.trow', row));
      }
      const g = h('div.tgrid', grid);
      setTimeout(() => {
        const sel = g.querySelector('.sel') || g.children[Math.max(0, (Number((opts.value || '09').slice(0, 2)) - 6))];
        if (sel) g.scrollTop = Math.max(0, (sel.offsetTop || 0) - 60);
      }, 30);
      return h('div.timepick',
        h('div.chips', [['morning', 'Утро'], ['day', 'День'], ['evening', 'Вечер']].map(([p, l]) => h('button.chip' + (opts.part === p ? '.on' : ''), { onclick: () => finish({ time: null, part: p }) }, l))),
        opts.withDur ? h('div.chips.wrap', h('span.muted', 'Длительность:'), [15, 30, 60, 90, 120, 180].map((m) => h('button.chip.small' + (dur === m ? '.on' : ''), { onclick: () => { dur = dur === m ? null : m; s.refresh(); } }, m < 60 ? m + ' мин' : m / 60 + ' ч'))) : null,
        g,
        h('div.row-btns', h('button.btn', { onclick: () => finish({ time: null, part: null }) }, 'Без времени')));
    }, { title: opts.title || 'Время', onClose: () => { if (!done) resolve(null); } });
  });
}

// ——— свайпы и долгое нажатие для строк ———
export function swipeable(row, { onRight, onLeft, onLong, onTap }) {
  let x0 = 0, y0 = 0, dx = 0, active = false, decided = false, horiz = false, timer = null, moved = false, pid = null;
  const inner = row.querySelector('.row-inner') || row;
  const reset = () => { inner.style.transform = ''; row.classList.remove('sw-right', 'sw-left'); };
  row.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, a, input, textarea, select')) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; active = true; decided = false; horiz = false; moved = false; pid = e.pointerId;
    clearTimeout(timer);
    if (onLong) timer = setTimeout(() => { if (active && !moved) { active = false; buzz(20); onLong(); row.dataset.longed = '1'; } }, 520);
  });
  row.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== pid) return;
    const ddx = e.clientX - x0, ddy = e.clientY - y0;
    if (!decided && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) {
      decided = true; moved = true; clearTimeout(timer);
      horiz = Math.abs(ddx) > Math.abs(ddy) * 1.3 && (onRight || onLeft);
      if (horiz) { try { row.setPointerCapture(pid); } catch { /* */ } }
      else { active = false; return; }
    }
    if (horiz) {
      dx = ddx;
      if ((dx > 0 && !onRight) || (dx < 0 && !onLeft)) dx = 0;
      inner.style.transform = `translateX(${dx}px)`;
      row.classList.toggle('sw-right', dx > 30);
      row.classList.toggle('sw-left', dx < -30);
    }
  });
  const end = (e) => {
    clearTimeout(timer);
    if (row.dataset.longed) { delete row.dataset.longed; active = false; return; }
    if (!active) { reset(); return; }
    active = false;
    const w = row.offsetWidth || 300;
    if (horiz && dx > w * 0.28 && onRight) { inner.style.transform = ''; onRight(); }
    else if (horiz && dx < -w * 0.28 && onLeft) { reset(); onLeft(); }
    else if (!moved && e.type === 'pointerup' && onTap) { reset(); onTap(e); }
    else reset();
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', () => { clearTimeout(timer); active = false; reset(); });
  row.addEventListener('contextmenu', (e) => { if (onLong) e.preventDefault(); });
}

/** Кликабельные телефоны, ссылки и адреса в заметке. Возвращает фрагмент DOM. */
export function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /(https?:\/\/[^\s<>"']+)|(\+?\d[\d\s\-()]{8,}\d)|((?:ул\.|улица|пр\.|проспект|пер\.|переулок|шоссе|бульвар|б-р|пл\.|площадь)\s[^\n,;]{2,60}(?:,\s*(?:д\.|дом)?\s*\d+[^\n,;]{0,10})?)/giu;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(document.createTextNode(text.slice(last, m.index)));
    let href;
    if (m[1]) href = m[1].replace(/[.,;:!?)]+$/, '');
    else if (m[2]) href = 'tel:' + m[2].replace(/[^\d+]/g, '');
    else href = 'geo:0,0?q=' + encodeURIComponent(m[3]);
    const shown = m[1] ? href : m[0];
    const a = h('a', { href, target: m[1] ? '_blank' : null, rel: 'noopener noreferrer' }, shown);
    frag.append(a);
    last = m.index + shown.length;
    re.lastIndex = last;
  }
  if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
  return frag;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* */ }
    ta.remove();
    return ok;
  }
}

/** Поделиться текстом или файлом; иначе — скачивание / копирование. */
export async function shareOut({ title, text, url, file }) {
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: title || file.name });
      return 'shared';
    }
    if (!file && navigator.share) {
      await navigator.share({ title, text: url ? text + '\n' + url : text });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'aborted';
  }
  if (file) {
    const a = h('a', { href: URL.createObjectURL(file), download: file.name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return 'downloaded';
  }
  await copyText(url ? text + '\n' + url : text);
  return 'copied';
}

export { fmtShort };
