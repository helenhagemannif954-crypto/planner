// Отрисовка чина. Во время молитвы — только текст: источник и действия
// появляются мелко под текстом по касанию.

import { h, phrases } from './util.js';
import * as store from './store.js';
import { swapBlock, markCircleShown, markReadingShown } from './office.js';

/** Строки с пустой строкой как разделителем строф → абзацы */
function stanzas(lines, cls = 'stanza') {
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) out.push(h('p', { class: cls }, cur)); cur = []; };
  for (const l of lines || []) {
    if (l === '') { flush(); continue; }
    cur.push(h('span', { class: 'ln' }, l));
  }
  flush();
  return out;
}

function rubric(text, sub) {
  if (!text && !sub) return null;
  return h('h2', { class: 'rubric' }, text || '', sub ? h('span', { class: 'sub' }, sub) : null);
}

function fmt(sec) {
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m} мин`;
}

// ——— тишина ———
let audioCtx = null;
function softBell() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    for (const [f, g] of [[528, 0.12], [792, 0.04]]) {
      const o = audioCtx.createOscillator();
      const v = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      v.gain.setValueAtTime(0, t);
      v.gain.linearRampToValueAtTime(g, t + 0.02);
      v.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
      o.connect(v).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 3.6);
    }
  } catch { /* звука нет — и не надо */ }
}

export function timer(seconds, label = 'Тишина') {
  const R = 15, L = 2 * Math.PI * R;
  const ring = h('span', { class: 'ring', 'aria-hidden': 'true', html: `<svg viewBox="0 0 36 36"><circle class="track" cx="18" cy="18" r="${R}"/><circle class="arc" cx="18" cy="18" r="${R}" stroke-dasharray="${L}" stroke-dashoffset="${L}"/></svg>` });
  const txt = h('span', { class: 'tt' }, fmt(seconds));
  const btn = h('button', { class: 'timer', type: 'button', 'aria-label': `${label}, ${fmt(seconds)}: начать` }, ring, txt);
  let iv = null, left = seconds;
  const arc = () => ring.querySelector('.arc');
  const stop = (done) => {
    clearInterval(iv); iv = null;
    btn.classList.remove('run');
    if (done) {
      btn.classList.add('done');
      txt.textContent = '·';
      const st = store.settings();
      if (st.silenceVibrate && navigator.vibrate) navigator.vibrate(40);
      if (st.silenceSound) softBell();
    } else {
      txt.textContent = fmt(seconds);
      arc().style.transition = 'none';
      arc().style.strokeDashoffset = L;
    }
    btn.setAttribute('aria-label', `${label}, ${fmt(seconds)}: начать`);
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (iv) { stop(false); return; }
    btn.classList.remove('done');
    btn.classList.add('run');
    left = seconds;
    txt.textContent = fmt(left);
    arc().style.transition = 'none';
    arc().style.strokeDashoffset = L;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      arc().style.transition = `stroke-dashoffset ${seconds}s linear`;
      arc().style.strokeDashoffset = 0;
    }));
    btn.setAttribute('aria-label', `${label}: идёт, коснитесь, чтобы остановить`);
    iv = setInterval(() => {
      left -= 1;
      if (left <= 0) stop(true);
      else txt.textContent = fmt(left);
    }, 1000);
  });
  return btn;
}

// ——— строка источника и действий ———
function metaRow(block, onSwap) {
  const m = block.meta || {};
  const row = h('div', { class: 'meta', hidden: true });
  const src = [m.source, m.century].filter(Boolean).join(' · ');
  if (src) row.append(h('p', { class: 'src' }, src));
  if (m.note) row.append(h('p', { class: 'note' }, m.note));
  const acts = h('div', { class: 'acts' });
  if (block.swap && onSwap) acts.append(h('button', { type: 'button', class: 'act', onclick: (e) => { e.stopPropagation(); onSwap(); } }, 'Другая'));
  if (block.fav) acts.append(favButton(block.fav));
  if (acts.childNodes.length) row.append(acts);
  return row;
}

function favButton(fav) {
  const b = h('button', { type: 'button', class: 'act fav' });
  const paint = () => {
    const on = store.isFavorite(fav.kind, fav.id);
    b.textContent = on ? '★ В избранном' : '☆ В избранное';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  b.addEventListener('click', (e) => { e.stopPropagation(); store.toggleFavorite(fav); paint(); });
  paint();
  return b;
}

/** Секция, у которой по касанию открывается источник */
function tappable(sec, block, onSwap) {
  const row = metaRow(block, onSwap);
  sec.append(row);
  sec.classList.add('tap');
  sec.addEventListener('click', (e) => {
    if (e.target.closest('button, input, a, .verse')) return;
    row.hidden = !row.hidden;
    sec.classList.toggle('open', !row.hidden);
  });
  return sec;
}

// ——— блоки ———
const B = {
  text(b, ctx) {
    const sec = h('section', { class: 'block text' }, rubric(b.rubric), stanzas(b.lines));
    return tappable(sec, b, b.swap ? () => ctx.swap(b, sec) : null);
  },

  psalm(b, ctx) {
    const sec = h('section', { class: 'block psalm' }, rubric(b.rubric, b.sub));
    if (b.title) sec.append(h('p', { class: 'superscription' }, b.title));
    const box = h('div', { class: 'verses' });
    for (const v of b.verses) {
      const ve = h('div', { class: 'verse', dataset: { n: v.n } }, v.l.map((l) => h('span', { class: 'ln' }, l)));
      box.append(ve);
    }
    sec.append(box);
    // стих можно сохранить в избранное: касание стиха выделяет его
    const vrow = h('div', { class: 'meta vmeta', hidden: true });
    box.addEventListener('click', (e) => {
      const ve = e.target.closest('.verse');
      if (!ve || !b.fav || b.fav.kind !== 'psalm') return;
      const was = ve.classList.contains('sel');
      box.querySelectorAll('.verse.sel').forEach((x) => x.classList.remove('sel'));
      vrow.replaceChildren();
      if (was) { vrow.hidden = true; return; }
      ve.classList.add('sel');
      const ref = `Пс ${b.fav.id}:${ve.dataset.n}`;
      vrow.append(h('div', { class: 'acts' }, h('span', { class: 'src' }, ref), favButton({ kind: 'verse', id: ref, title: ref })));
      vrow.hidden = false;
      ve.after(vrow);
    });
    tappable(sec, b, b.swap ? () => ctx.swap(b, sec) : null);
    if (b.circleKey) { sec.dataset.circle = b.circleKey; ctx.observe(sec, () => markCircleShown(b.circleKey)); }
    return sec;
  },

  reading(b, ctx) {
    const p = b.passage;
    const sec = h('section', { class: 'block reading' }, rubric('Чтение', p.ref));
    if (p.title) sec.append(h('p', { class: 'ptitle' }, p.title));
    const body = (slow) => {
      const text = (p.verses || []).map((v) => v[2]).join(' ');
      if (!slow) return h('div', { class: 'scripture' }, (p.verses || []).map((v) => h('span', { class: 'sv' }, v[2] + ' ')));
      const ph = phrases(text);
      const box = h('div', { class: 'scripture slow', role: 'button', tabindex: '0', 'aria-label': 'Медленное чтение: коснитесь, чтобы открыть следующую фразу' });
      ph.forEach((t, i) => box.append(h('span', { class: 'ph' + (i === 0 ? ' on' : '') }, t + ' ')));
      const hint = h('p', { class: 'hint' }, 'коснитесь — следующая фраза');
      const step = (e) => {
        if (e && e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        const next = box.querySelector('.ph:not(.on)');
        if (next) next.classList.add('on');
        if (!box.querySelector('.ph:not(.on)')) { hint.remove(); box.classList.add('all'); }
      };
      box.addEventListener('click', step);
      box.addEventListener('keydown', step);
      return h('div', {}, box, hint);
    };
    sec.append(body(b.slow));
    if (!b.plain) {
      if (b.questions?.length) sec.append(h('ul', { class: 'questions' }, b.questions.map((q) => h('li', {}, q))));
      if (b.silence > 0) sec.append(h('div', { class: 'pause' }, timer(b.silence)));
      if (b.double) {
        sec.append(h('h3', { class: 'again' }, 'Ещё раз, медленно'));
        sec.append(body(b.slow));
      }
      if (b.after) sec.append(h('p', { class: 'after' }, b.after));
    }
    tappable(sec, { meta: { source: `${p.ref} · Синодальный перевод`, century: '', note: '' }, fav: { kind: 'reading', id: p.ref, title: p.ref } });
    ctx.observe(sec, () => markReadingShown(b.special));
    return sec;
  },

  intercession(b, ctx) {
    const sec = h('section', { class: 'block intercession' });
    if (b.prayer) sec.append(B.text(b.prayer, ctx));
    const L = b.lines;
    const part = (list, head, open, close) => {
      const box = h('div', { class: 'names' }, rubric(head));
      const names = store.get().names[list];
      box.append(h('p', { class: 'stanza' }, h('span', { class: 'ln' }, names.length ? open : close.empty)));
      const ul = h('p', { class: 'stanza namelist' }, names.map((n) => h('span', { class: 'ln nm' }, n)));
      if (names.length) box.append(ul, h('p', { class: 'stanza' }, h('span', { class: 'ln' }, close.full)));
      // помянник прямо во время молитвы: добавить имя
      const add = h('button', { type: 'button', class: 'act addname' }, '+ имя');
      add.addEventListener('click', () => {
        const inp = h('input', { type: 'text', class: 'nameinput', 'aria-label': list === 'living' ? 'Имя о здравии' : 'Имя об упокоении', enterkeyhint: 'done', autocomplete: 'off' });
        const form = h('form', { class: 'nameform' }, inp);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (store.addName(list, inp.value)) {
            const nb = part(list, head, open, close);
            box.replaceWith(nb);
          }
        });
        add.replaceWith(form);
        inp.focus();
      });
      box.append(h('div', { class: 'acts' }, add));
      return box;
    };
    sec.append(part('living', L.livingTitle, L.livingOpen, { full: L.livingClose, empty: L.livingEmpty }));
    if (b.silence) sec.append(h('div', { class: 'pause' }, timer(b.silence)));
    if (b.departed) sec.append(part('departed', L.departedTitle, L.departedOpen, { full: L.departedClose, empty: L.departedEmpty }));
    return sec;
  },

  own(b, ctx) {
    if (ctx.plain) return null;
    return h('section', { class: 'block own' }, rubric('Своими словами'), h('p', { class: 'direction' }, b.line), b.seconds ? h('div', { class: 'pause' }, timer(b.seconds, 'Своими словами')) : null);
  },

  question(b, ctx) {
    return h('section', { class: 'block own' }, h('p', { class: 'direction' }, b.line), !ctx.plain && b.seconds ? h('div', { class: 'pause' }, timer(b.seconds, 'Пауза')) : null);
  },

  silence(b, ctx) {
    if (ctx.plain) return null;
    return h('section', { class: 'block silence' }, rubric('Тишина'), h('div', { class: 'pause' }, timer(b.seconds)));
  },

  review(b, ctx) {
    const sec = h('section', { class: 'block review' }, rubric(b.rubric));
    for (const s of b.steps) {
      sec.append(h('h3', { class: 'step' }, s.title), h('p', { class: 'direction' }, s.line));
      if (!ctx.plain && s.seconds) sec.append(h('div', { class: 'pause' }, timer(s.seconds, s.title)));
    }
    return sec;
  },

  verse(b, ctx) {
    const sec = h('section', { class: 'block verse-b' }, rubric(b.rubric), stanzas(b.lines), h('p', { class: 'ref' }, b.ref));
    return tappable(sec, { meta: { source: b.ref, century: '', note: '' }, fav: b.fav });
  },

  word(b) {
    return h('section', { class: 'block word' }, rubric(b.rubric), stanzas(b.lines), h('p', { class: 'ref' }, b.ref));
  },

  remembrance(b, ctx) {
    const sec = h('section', { class: 'block remembrance' }, rubric(b.rubric), h('p', { class: 'direction' }, b.line));
    if (b.quote) sec.append(B.text(b.quote, ctx));
    return sec;
  },

  line(b) {
    if (!b.line) return null;
    return h('section', { class: 'block line' }, rubric(b.rubric), h('p', { class: 'direction' }, b.line));
  },

  dismissal(b) {
    const sec = h('section', { class: 'block dismissal' });
    if (b.bless) sec.append(stanzas(b.bless.lines, 'stanza bless'), h('p', { class: 'ref' }, b.bless.ref));
    if (b.line) sec.append(h('p', { class: 'direction end' }, b.line));
    return sec;
  },

  theme(b) {
    return h('p', { class: 'block themeline' }, `Седмица · ${b.theme.title}`);
  },
};

export function renderBlock(b, ctx) {
  const f = B[b.t];
  if (!f) return null;
  const el = f(b, ctx);
  if (el) el.dataset.bkey = b.bkey || '';
  return el;
}

/** Весь чин в контейнер. Возвращает функцию очистки. */
export function renderOffice(office, root, { onClose } = {}) {
  const st = store.settings();
  const seen = new Map();
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) {
      const f = seen.get(e.target);
      if (f) { f(); seen.delete(e.target); io.unobserve(e.target); }
    }
  }, { threshold: 0.15 }) : null;
  const ctx = {
    plain: st.readMode === 'plain',
    observe(el, f) { if (io) { seen.set(el, f); io.observe(el); } else f(); },
    swap(block, el) {
      const nb = swapBlock(office, block);
      if (!nb) return;
      const i = office.blocks.indexOf(block);
      if (i >= 0) office.blocks[i] = nb;
      const ne = renderBlock(nb, ctx);
      el.replaceWith(ne);
      const meta = ne.querySelector('.meta');
      if (meta) { meta.hidden = false; ne.classList.add('open'); }
    },
  };
  for (const b of office.blocks) {
    const el = renderBlock(b, ctx);
    if (el) root.append(el);
  }
  root.append(h('footer', { class: 'office-end' }, h('p', { class: 'amen' }, 'Аминь.'), h('button', { type: 'button', class: 'btn quiet', onclick: () => onClose && onClose() }, 'Закрыть')));
  return () => io && io.disconnect();
}
