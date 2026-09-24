// Разбор по квадратам (Эйзенхауэр): инструмент, каждая зона — сразу действие.
import { h, icon, sheet, toast, choose, pickDate, buzz } from '../ui.js';
import * as st from '../store.js';
import { S } from '../store.js';
import { addDays, weekStart } from '../dates.js';
import { isHidden, app } from './common.js';

export const ZONES = [
  { id: 'q1', title: 'Важно и срочно', hint: 'на сегодня или эту неделю' },
  { id: 'q2', title: 'Важно, не срочно', hint: 'назначить день — это стоит защищать' },
  { id: 'q3', title: 'Срочно, не важно', hint: 'поручить' },
  { id: 'q4', title: 'Ни то ни другое', hint: '«Когда-нибудь» или удалить' },
];

export function openMatrix(ids) {
  const pool = [...ids];
  const placed = { q1: [], q2: [], q3: [], q4: [] };
  let sel = null;
  let drag = null;

  const s = sheet(() => {
    const items = pool.map((id) => S.tasks.get(id)).filter((t) => t && t.status === 'active');
    const zones = h('div.quad', ZONES.map((z) => h('button.q.' + z.id, {
      dataset: { zone: z.id }, 'aria-label': z.title,
      onclick: () => { if (sel) act(z.id, sel); },
    }, h('b', z.title), h('small', z.hint), placed[z.id].length ? h('small', '✓ ' + placed[z.id].length) : null)));
    const list = h('div', items.map((t) => {
      const el = h('div.pool-item' + (sel === t.id ? '.sel' : ''), { dataset: { id: t.id }, role: 'button', tabindex: '0' }, isHidden(t) ? '•••' : t.text);
      el.addEventListener('click', () => { sel = sel === t.id ? null : t.id; s.refresh(); });
      el.addEventListener('pointerdown', (e) => startDrag(e, t, el));
      return el;
    }));
    return h('div',
      h('p.muted.small', 'Коснитесь задачи, затем зоны — или перетащите.'),
      zones,
      items.length ? list : h('p.muted', { style: { textAlign: 'center', marginTop: '1rem' } }, 'Всё разобрано.'),
    );
  }, { title: 'Разбор по квадратам', full: true });

  function startDrag(e, t, el) {
    const x0 = e.clientX, y0 = e.clientY;
    let ghost = null, over = null, armed = false, cancelled = false;
    // перетаскивание — после короткого удержания, чтобы список можно было листать
    const hold = setTimeout(() => { if (!cancelled) { armed = true; buzz(10); } }, 220);
    const tm = (ev) => { if (armed) ev.preventDefault(); };
    el.addEventListener('touchmove', tm, { passive: false });
    const move = (ev) => {
      if (!armed) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) { cancelled = true; clearTimeout(hold); } return; }
      if (!ghost) { ghost = document.createElement('div'); ghost.className = 'drag-ghost'; ghost.textContent = el.textContent; document.body.append(ghost); }
      ghost.style.left = ev.clientX - 20 + 'px';
      ghost.style.top = ev.clientY - 20 + 'px';
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const z = target && target.closest('[data-zone]');
      if (over && over !== z) over.classList.remove('drop');
      over = z;
      if (z) z.classList.add('drop');
    };
    const up = () => {
      clearTimeout(hold);
      el.removeEventListener('touchmove', tm);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (ghost) {
        ghost.remove();
        if (over) { over.classList.remove('drop'); act(over.dataset.zone, t.id); }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  async function act(zone, id) {
    const t = S.tasks.get(id);
    if (!t) return;
    let ok = false;
    const T = st.T();
    if (zone === 'q1') {
      const v = await choose('Важно и срочно', [{ label: 'Сегодня', value: 'today', primary: true }, { label: 'На этой неделе', value: 'week' }]);
      if (v === 'today') { st.moveTasks([id], T); ok = true; }
      if (v === 'week') { st.moveTasks([id], weekStart(T), 'week'); ok = true; }
    } else if (zone === 'q2') {
      const d = await pickDate({ now: st.clock(), title: 'Назначить день — это стоит защищать', allowNone: false });
      if (d && d.date) { st.moveTasks([id], d.date, d.dateKind || 'day'); ok = true; }
    } else if (zone === 'q3') {
      const { sendTask } = await import('./share.js');
      ok = await sendTask(t);
    } else if (zone === 'q4') {
      const v = await choose('Ни то ни другое', [{ label: 'В «Когда-нибудь»', value: 'someday', primary: true }, { label: 'Удалить', value: 'del', danger: true }]);
      if (v === 'someday') { st.change(() => st.put('tasks', { ...S.tasks.get(id), status: 'someday', inbox: false, date: null, dateKind: null })); ok = true; }
      if (v === 'del') { st.deleteTask(id); ok = true; }
    }
    if (ok) {
      buzz(8);
      pool.splice(pool.indexOf(id), 1);
      placed[zone].push(id);
      sel = null;
    }
    s.refresh();
  }
  return s;
}

export { icon, toast, addDays, app };
