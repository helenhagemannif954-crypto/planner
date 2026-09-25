// «Входящие»: всё нераспознанное и пришедшее от других; «Жду от…»; «Когда-нибудь».
import { h, icon, toast } from '../ui.js';
import * as st from '../store.js';
import { app, taskRow, emptyState, sectionHead } from './common.js';

let openWait = new Set(), openSomeday = false;

export function renderInbox(root) {
  const list = st.inboxList();
  const tools = [];
  if (list.length) tools.push(h('button.chip', { onclick: async () => { const { openMatrix } = await import('./matrix.js'); openMatrix(list.map((t) => t.id)); } }, icon('grid', 16), 'Разобрать по квадратам'));
  tools.push(h('button.chip', { onclick: async () => { const { pasteTask } = await import('./share.js'); pasteTask(); } }, icon('copy', 16), 'Вставить задачу'));
  root.append(h('div.chips', { style: { margin: '.25rem 0 .5rem' } }, tools));
  if (list.length) root.append(h('div.list', list.map((t) => taskRow(t, { hideIncoming: true }))));
  else root.append(emptyState('Здесь пусто.', 'Всё разложено по местам.', 'inbox'));

  // Жду от <имя>
  const waiting = st.waitingList();
  const byName = new Map();
  for (const t of waiting) {
    if (!byName.has(t.waitFor)) byName.set(t.waitFor, []);
    byName.get(t.waitFor).push(t);
  }
  for (const [name, arr] of byName) {
    const open = openWait.has(name);
    root.append(h('button.more-line', { onclick: () => { open ? openWait.delete(name) : openWait.add(name); app.render(); } }, icon(open ? 'up' : 'down', 18), 'Жду от ' + name + ' · ' + arr.length));
    if (open) root.append(h('div.list', arr.map((t) => taskRow(t, { showDate: true }))));
  }
  const some = st.somedayList();
  if (some.length) {
    root.append(h('button.more-line', { onclick: () => { openSomeday = !openSomeday; app.render(); } }, icon(openSomeday ? 'up' : 'down', 18), 'Когда-нибудь · ' + some.length));
    if (openSomeday) root.append(h('div.list', some.map((t) => taskRow(t))));
  }
}

export { toast, sectionHead };
