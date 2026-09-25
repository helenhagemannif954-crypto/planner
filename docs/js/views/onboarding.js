// Первый запуск — не дольше двух минут: имя, контакты, взгляд на области, постоянные блоки.
import { h, icon, clear } from '../ui.js';
import * as st from '../store.js';
import { describeBlock } from '../blocks.js';

export function onboarding(root, onDone) {
  let step = 0;
  let name = st.settings().myName || '';
  const contacts = [...(st.settings().contacts || [])];
  const draw = () => {
    clear(root);
    const box = h('div.onb');
    box.append(h('div.stepper', [0, 1, 2, 3].map((i) => h('i' + (i <= step ? '.on' : '')))));
    const next = h('button.btn.primary.block', { onclick: () => go(1) }, 'Дальше');
    const skip = h('button.btn.ghost.block', { onclick: () => go(1) }, 'Пропустить');
    if (step === 0) {
      const inp = h('input.input', { value: name, placeholder: 'Например: о. Иоанн', maxlength: 60, autofocus: true, 'aria-label': 'Ваше имя' });
      inp.addEventListener('input', () => { name = inp.value; });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(1); });
      box.append(h('h1', 'Добро пожаловать'),
        h('p.muted', 'Планировщик работает без интернета. Данные — только на этом телефоне.'),
        h('div.field', h('label', 'Как вас подписывать, когда вы отправляете задачу?'), inp),
        h('div.grow'), next);
      setTimeout(() => inp.focus(), 50);
    } else if (step === 1) {
      const fam = st.areasList().find((a) => /семь/i.test(a.name));
      const has = (n) => contacts.some((c) => c.name.toLowerCase() === n.toLowerCase());
      const inp = h('input.input', { placeholder: 'Имя контакта', maxlength: 60, 'aria-label': 'Имя контакта' });
      const add = () => { const v = inp.value.trim(); if (v && !has(v)) contacts.push({ id: st.uid(), name: v, areaId: null }); inp.value = ''; draw(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      box.append(h('h1', 'С кем обмениваться задачами'),
        h('p.muted', 'Задачи уходят обычной ссылкой через мессенджер. Никаких аккаунтов.'),
        !has('Жена') ? h('button.chip', { onclick: () => { contacts.push({ id: st.uid(), name: 'Жена', areaId: fam ? fam.id : null }); draw(); } }, icon('plus', 16), 'Жена → «Семья»') : null,
        h('div.list', contacts.map((c) => h('div.line-btn', h('span.grow', c.name, c.areaId ? h('div.muted.small', 'входящие → ' + ((st.area(c.areaId) || {}).name || '')) : null),
          h('button.icon-btn', { 'aria-label': 'Убрать', onclick: () => { contacts.splice(contacts.indexOf(c), 1); draw(); } }, icon('close', 18))))),
        h('div.searchbar', inp, h('button.round.soft', { 'aria-label': 'Добавить контакт', onclick: add }, icon('plus'))),
        h('div.grow'), next);
    } else if (step === 2) {
      const all = st.areasList(true);
      box.append(h('h1', 'Области'),
        h('p.muted', 'Уберите лишнее — потом всё можно вернуть, переименовать и добавить в разделе «Области».'),
        h('div', all.map((a) => h('button.line-btn', {
          role: 'switch', 'aria-checked': String(!a.archived),
          onclick: () => { st.saveArea({ ...a, archived: !a.archived }); draw(); },
        }, h('span.dot', { style: { background: a.color } }), h('span.grow', a.name, a.private ? h('div.muted.small', 'закрытая: текст скрыт') : null), h('span.switch' + (!a.archived ? '.on' : ''))))),
        h('div.grow'), next);
    } else if (step === 3) {
      const blocks = st.meta('blocks', []);
      box.append(h('h1', 'Постоянные блоки'),
        h('p.muted', 'Службы, приёмы, пары — что повторяется каждую неделю. Можно пропустить и добавить позже.'),
        h('div', blocks.map((b) => h('div.line-btn', h('span.grow', b.title, h('div.muted.small', describeBlock(b, st.blockDur(b.areaId))))))),
        h('button.btn', { onclick: async () => { const { addBlock } = await import('./settings.js'); await addBlock(); draw(); } }, icon('plus', 18), 'Добавить блок'),
        h('div.grow'),
        h('button.btn.primary.block', { onclick: finish }, 'Готово'));
    }
    if (step < 3 && step > 0) box.append(skip);
    root.append(box);
  };
  const go = (d) => {
    if (step === 0) st.setSettings({ myName: name.trim() });
    if (step === 1) st.setSettings({ contacts });
    step += d;
    draw();
  };
  const finish = () => {
    st.setSettings({ onboarded: true, myName: name.trim(), contacts });
    onDone();
  };
  draw();
}
