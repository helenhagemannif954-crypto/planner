// Точка входа: загрузка данных, каркас, навигация, ярлыки, «Поделиться», обновление.
import { h, icon, clear, toast, choose, initBack, closeAll, sheet } from './ui.js';
import * as st from './store.js';
import * as db from './db.js';
import { fmtLong, today, addDays } from './dates.js';
import { churchDay } from './church.js';
import { app, taskRow, reschedule } from './views/common.js';
import * as common from './views/common.js';
import { composer } from './views/compose.js';
import { renderToday } from './views/today.js';
import { renderInbox } from './views/inbox.js';
import { renderAreas, renderArea } from './views/areas.js';
import { openTask } from './views/task.js';
import { handleHash } from './views/share.js';

app.common = common;
app.openTask = openTask;

const root = document.getElementById('app');
const TABS = [
  ['today', 'Сегодня', 'sun'],
  ['inbox', 'Входящие', 'inbox'],
  ['plan', 'План', 'plan'],
  ['areas', 'Области', 'areas'],
];

let viewEl, headEl, tabsEl, compEl, selEl;
let lastDay = null;
const scrolls = {};

function buildShell() {
  clear(root);
  headEl = h('header.top');
  viewEl = h('main#view', { tabindex: '-1' });
  compEl = composer('inline', {});
  app.composer = compEl;
  tabsEl = h('nav.tabs', { 'aria-label': 'Разделы' }, TABS.map(([id, label, ic]) => h('button.tab', {
    dataset: { tab: id }, onclick: () => go(id),
  }, icon(ic, 24), h('span', label))));
  selEl = h('div.selbar.hidden');
  root.append(headEl, viewEl, compEl, tabsEl, selEl);
}

export function go(screen, params = {}) {
  if (app.screen !== screen || params.areaId) scrolls[app.screen] = viewEl ? viewEl.scrollTop : 0;
  const prev = app.screen;
  app.screen = screen;
  Object.assign(app, params);
  app.selection = null;
  if (screen === 'area' && prev !== 'area') history.pushState({ screen: 'area' }, '');
  render(true);
}
app.go = go;

let pending = false;
export function render(resetScroll) {
  if (!viewEl) return;
  if (pending && !resetScroll) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    draw(resetScroll);
  });
}
app.render = () => render(false);

function draw(resetScroll) {
  const keep = resetScroll ? (scrolls[app.screen] || 0) : viewEl.scrollTop;
  const T = st.T();
  lastDay = T;
  clear(headEl);
  const tabId = app.screen === 'area' ? 'areas' : app.screen;
  for (const b of tabsEl.children) b.setAttribute('aria-current', b.dataset.tab === tabId ? 'page' : 'false');
  let title = '', sub = null;
  if (app.screen === 'today') {
    title = 'Сегодня';
    const cd = churchDay(T);
    const bits = [fmtLong(T)];
    const f = cd.feasts.find((x) => x.kind !== 'memorial') || cd.feasts[0];
    if (f) bits.push(f.title);
    else if (cd.eveOf.length) bits.push('канун: ' + cd.eveOf[0].title);
    else if (cd.periods.length) bits.push(cd.periods[0].title);
    sub = bits.join(' · ');
  } else if (app.screen === 'inbox') title = 'Входящие';
  else if (app.screen === 'plan') title = 'План';
  else if (app.screen === 'areas') title = 'Области';
  else if (app.screen === 'area') title = (st.area(app.areaId) || {}).name || 'Область';
  if (app.screen === 'area') headEl.append(h('button.icon-btn', { 'aria-label': 'Назад', onclick: () => history.back() }, icon('back')));
  headEl.append(h('h1', title, sub ? h('span.sub', sub) : null));
  headEl.append(h('button.icon-btn', { 'aria-label': 'Поиск', onclick: async () => { const { searchSheet } = await import('./views/settings.js'); searchSheet(); } }, icon('search')));
  headEl.append(h('button.icon-btn', { 'aria-label': 'Меню', onclick: menu }, icon('more')));

  clear(viewEl);
  const body = h('div');
  try {
    if (app.screen === 'today') renderToday(body);
    else if (app.screen === 'inbox') renderInbox(body);
    else if (app.screen === 'plan') { planRender(body); }
    else if (app.screen === 'areas') renderAreas(body);
    else if (app.screen === 'area') renderArea(body, app.areaId);
  } catch (e) {
    console.error(e);
    body.append(h('p.muted', 'Не получилось показать экран. Данные в порядке.'));
  }
  viewEl.append(body);
  viewEl.scrollTop = keep;
  drawSelection();
}

let planModule = null;
function planRender(body) {
  if (planModule) { planModule.renderPlan(body); return; }
  import('./views/plan.js').then((m) => { planModule = m; render(false); });
}

function drawSelection() {
  const sel = app.selection;
  selEl.classList.toggle('hidden', !sel);
  compEl.classList.toggle('hidden', !!sel);
  clear(selEl);
  if (!sel) return;
  const ids = [...sel];
  selEl.append(
    h('button.icon-btn', { 'aria-label': 'Снять выбор', onclick: () => { app.selection = null; render(); } }, icon('close')),
    h('span.grow', 'Выбрано: ' + ids.length),
    h('button.btn', { onclick: async () => { await reschedule(ids); app.selection = null; render(); } }, 'Перенести'),
    h('button.btn', {
      onclick: async () => {
        const { pickArea } = await import('./views/pickers.js');
        const a = await pickArea(null);
        if (a === undefined) return;
        const r = st.change(() => { for (const id of ids) { const t = st.S.tasks.get(id); if (t) st.put('tasks', { ...t, areaId: a, inbox: false }); } });
        app.selection = null;
        toast('Область изменена', { action: 'Отменить', onAction: () => r.undo() });
      },
    }, 'Область'),
    h('button.btn.primary', {
      onclick: () => {
        const r = st.change(() => { for (const id of ids) st.completeTask(id); });
        app.selection = null;
        toast('Сделано: ' + ids.length, { action: 'Отменить', onAction: () => r.undo() });
      },
    }, 'Закрыть'));
}

async function menu() {
  const v = await choose('Меню', [
    { label: 'Недельный обзор', value: 'review', icon: 'list' },
    { label: 'Разбор по квадратам', value: 'matrix', icon: 'grid' },
    { label: 'Что сейчас?', value: 'now', icon: 'clock' },
    { label: 'Шаблоны', value: 'tpl', icon: 'chain' },
    { label: 'Журнал сделанного', value: 'journal', icon: 'check' },
    { label: 'Вставить задачу', value: 'paste', icon: 'copy' },
    { label: 'Резервная копия', value: 'backup', icon: 'download' },
    { label: 'Настройки', value: 'settings', icon: 'gear' },
  ]);
  if (!v) return;
  const S = await import('./views/settings.js');
  if (v === 'settings') S.openSettings();
  if (v === 'backup') S.backupSheet();
  if (v === 'journal') S.journalSheet();
  if (v === 'tpl') (await import('./views/areas.js')).templatesSheet();
  if (v === 'paste') (await import('./views/share.js')).pasteTask();
  if (v === 'now') (await import('./views/today.js')).whatNow();
  if (v === 'matrix') {
    const ids = st.inboxList().map((t) => t.id);
    if (!ids.length) { toast('Во «Входящих» пусто'); return; }
    (await import('./views/matrix.js')).openMatrix(ids);
  }
  if (v === 'review') (await import('./views/review.js')).openReview();
}

// ——— только ввод (ярлыки «Добавить» и «Голосом») ———
function addOnly(voice) {
  clear(root);
  const box = h('div.addonly');
  const showForm = () => {
    clear(box);
    const c = composer('full', { onAdded: (r) => showAdded(r) });
    box.append(h('h1', 'Новая задача'), c,
      h('p.muted.small', 'Например: «позвонить владыке завтра в 15», «сессия с А.К. в чт в 18», «отчёт по гранту до 15.10»'));
    root.append(box);
    setTimeout(() => { if (voice) c.listen(); else c.focusInput(); }, 150);
  };
  const showAdded = async (r) => {
    // «Добавлено» — только когда запись действительно легла в хранилище
    try { await r.saved; } catch { toast('Не удалось сохранить. Попробуйте ещё раз.', { duration: 8000 }); return; }
    clear(box);
    box.append(h('div.added',
      h('div.okmark', icon('check')),
      h('h2', 'Добавлено'),
      h('p.muted', r.message || ''),
      h('p.muted.small', 'Можно закрыть — всё сохранено.'),
      h('div.row-btns', { style: { justifyContent: 'center' } },
        h('button.btn.primary', { onclick: showForm }, 'Ещё одну'),
        h('button.btn', { onclick: () => { history.replaceState(null, '', location.pathname); startShell(); } }, 'Открыть приложение'))));
  };
  showForm();
}

function startShell() {
  buildShell();
  app.screen = 'today';
  render(true);
}

// ——— обновление приложения ———
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (w) => {
      const bar = h('div.update-bar', 'Доступна новая версия', h('button.btn.primary', {
        onclick: () => { w.postMessage('skipWaiting'); bar.remove(); },
      }, 'Обновить'), h('button.icon-btn', { 'aria-label': 'Позже', onclick: () => bar.remove() }, icon('close', 18)));
      document.body.append(bar);
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 6 * 3600 * 1000);
  }).catch(() => {});
  // первая установка тоже меняет controller — перезагружаемся только при обновлении
  let hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (!reloading) { reloading = true; location.reload(); }
  });
}

// ——— запуск ———
async function boot() {
  st.setOnError(() => toast('Не удалось сохранить. Попробуйте ещё раз.', { duration: 8000 }));
  if (window.__clock) st.setClock(() => new Date(window.__clock()));
  try {
    const info = await st.load();
    if (info.migrated) toast('Данные обновлены до новой версии. Копия сохранена.');
    if (info.newer) toast('Данные созданы более новой версией. Обновите приложение.', { duration: 8000 });
  } catch (e) {
    console.error(e);
    clear(root);
    root.append(h('div.onb', h('h1', 'Хранилище недоступно'), h('p.muted', 'Браузер не дал доступ к данным (например, в режиме инкогнито). Данные не потеряны — попробуйте открыть приложение обычным способом.'), h('p.faint.small', String(e && e.message || e))));
    return;
  }
  if (!st.meta('persistAsked')) {
    const ok = await db.persistStorage();
    st.change(() => { st.setMeta('persistAsked', true); st.setMeta('persisted', ok); });
  } else db.persistStorage().then((ok) => { if (ok !== st.meta('persisted')) st.change(() => st.setMeta('persisted', ok)); });
  st.sweepSomeday();
  st.ensureScheduledCycles();
  st.dailyBackup().catch(() => {});

  st.subscribe(() => { if (viewEl && document.body.contains(viewEl)) render(false); });
  initBack(() => { if (app.screen === 'area') go('areas'); });
  registerSW();

  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  const shared = params.get('text') || params.get('title') || params.get('url');
  const hasCode = /^#(t|d)=v1\./.test(location.hash);

  if (action === 'add' || action === 'voice') { addOnly(action === 'voice'); window.__ready = true; return; }

  const afterOnboarding = () => {
    startShell();
    handleHash();
    if (shared) {
      const txt = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join(' ').slice(0, 13000);
      history.replaceState(null, '', location.pathname);
      import('./views/share.js').then(({ findCode, decode, acceptShared }) => {
        const code = findCode(txt);
        const obj = code && decode(code);
        if (obj) acceptShared(obj);
        else { compEl.setText(txt.slice(0, 1000)); compEl.focusInput(); }
      });
    }
    if (params.get('paste')) {
      history.replaceState(null, '', location.pathname);
      import('./views/share.js').then(({ pasteTask }) => {
        choose('Задача из буфера', [{ label: 'Вставить задачу', value: true, primary: true, icon: 'copy' }, { label: 'Не сейчас', value: false }]).then((v) => { if (v) pasteTask(); });
      });
    }
  };
  if (!st.settings().onboarded && !hasCode) {
    const { onboarding } = await import('./views/onboarding.js');
    onboarding(root, afterOnboarding);
  } else afterOnboarding();

  window.addEventListener('hashchange', () => handleHash());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      app.unlocked.clear();
      app.revealed.clear();
      st.flush();
    } else {
      if (st.T() !== lastDay) {
        st.sweepSomeday();
        st.ensureScheduledCycles();
        st.dailyBackup().catch(() => {});
      }
      render(false);
    }
  });
  window.__ready = true;
}

boot();
export { app, taskRow, today, addDays, sheet, closeAll };
