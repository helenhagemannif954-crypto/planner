// Загрузка текстов из content/*.json и указатели по ним.

const FILES = ['psalms', 'odes', 'prayers', 'scripture', 'orders', 'themes'];

export const C = {};

export async function loadContent() {
  const base = new URL('../content/', import.meta.url);
  const data = await Promise.all(FILES.map(async (f) => {
    const r = await fetch(new URL(f + '.json', base));
    if (!r.ok) throw new Error('Не загрузился ' + f + '.json');
    return r.json();
  }));
  FILES.forEach((f, i) => { C[f] = data[i]; });
  index();
  return C;
}

function index() {
  C.psalm = {};
  for (const p of C.psalms.psalms) C.psalm[p.n] = p;
  C.portions = [];
  for (const p of C.psalms.psalms) for (const part of portionsOf(p)) C.portions.push(part);

  C.ode = {};
  for (const o of C.odes.odes) C.ode[o.id] = o;

  C.text = {};
  for (const [id, t] of Object.entries(C.prayers.fixed || {})) C.text[id] = { id, ...t };
  for (const t of C.prayers.pool || []) C.text[t.id] = t;

  C.office = {};
  for (const o of C.orders.offices) C.office[o.id] = o;

  C.theme = {};
  for (const t of C.themes.themes) C.theme[t.id] = t;

  C.passage = {};
  for (const p of C.scripture.plan) C.passage[p.id] = p;
  for (const list of Object.values(C.scripture.special || {})) for (const p of list) C.passage[p.id] = p;
  for (const list of Object.values(C.scripture.readingPools || {})) for (const p of list) C.passage[p.id] = p;
}

/** Части псалма для чтения по кругу */
export function portionsOf(p) {
  const vs = p.verses;
  if (!vs.length) return [];
  const mk = (from, to, part, parts) => ({ ps: p.n, from, to, part, parts });
  if (Array.isArray(p.parts) && p.parts.length) return p.parts.map(([a, b], i) => mk(a, b, i + 1, p.parts.length));
  if (vs.length <= 30) return [mk(vs[0].n, vs[vs.length - 1].n, 1, 1)];
  const k = Math.ceil(vs.length / 22);
  const size = Math.ceil(vs.length / k);
  const out = [];
  for (let i = 0; i < k; i++) {
    const chunk = vs.slice(i * size, (i + 1) * size);
    if (chunk.length) out.push(mk(chunk[0].n, chunk[chunk.length - 1].n, i + 1, k));
  }
  return out;
}

/** Псалом целиком или его часть: стихи с номерами */
export function psalmVerses(n, from, to) {
  const p = C.psalm[n];
  if (!p) return [];
  return p.verses.filter((v) => (from == null || v.n >= from) && (to == null || v.n <= to));
}

/**
 * Стих(и) по ссылке. «Пс 4:9», «Пс 30:6», «Пс 62:2–3» — из нашей Псалтири,
 * остальное — из Синодального текста в scripture.json → verses.
 * Возвращает {ref, lines:[...]} или null.
 */
export function verseText(ref) {
  const m = /^Пс (\d+):(\d+)(?:[–-](\d+))?$/.exec(ref);
  if (m) {
    const vs = psalmVerses(+m[1], +m[2], +(m[3] || m[2]));
    if (!vs.length) return null;
    return { ref, lines: vs.flatMap((v) => v.l), psalm: true };
  }
  const t = C.scripture.verses?.[ref];
  if (!t) return null;
  return { ref, lines: Array.isArray(t) ? t : [t] };
}

/** «Мк 1:9–11» → человекочитаемая подпись рубрики */
export function bookTitle(ref) {
  const books = C.scripture.books || {};
  const m = /^(\S+)\s/.exec(ref);
  return (m && books[m[1]]) || '';
}
