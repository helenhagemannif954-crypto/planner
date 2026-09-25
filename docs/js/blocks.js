// Постоянные блоки недели. Блок: {dow, start, end?, endDays? | endDow?}. Окончание необязательно и может
// приходиться на другой день («пн 16:00 → вт 16:00»). Без окончания — длительность по умолчанию.
export const DAY = 1440;
export const WEEK = 7 * DAY;

const toM = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
export const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

/** Интервал блока в минутах от понедельника 00:00; конец может выходить за неделю. */
export function blockRange(b, defaultDur = 60) {
  const s = (Number(b.dow) - 1) * DAY + toM(b.start);
  let e;
  if (b.end && b.endDays != null) {
    // окончание через N дней после дня начала (0 — в тот же день)
    e = (Number(b.dow) - 1 + Number(b.endDays)) * DAY + toM(b.end);
    if (e <= s) e += DAY;
    e = Math.min(e, s + WEEK);
  } else if (b.end) {
    const endDow = Number(b.endDow || b.dow);
    e = (endDow - 1) * DAY + toM(b.end);
    if (e <= s) e += b.endDow && Number(b.endDow) !== Number(b.dow) ? WEEK : DAY;
    e = Math.min(e, s + WEEK);
  } else e = s + (Number(defaultDur) || 60);
  return { s, e, explicit: !!b.end };
}

/**
 * Части блоков, попадающие на день недели dow (1..7).
 * Возвращает [{id, title, areaId, start, end, min, cont, cut, explicit, block}], end может быть «24:00».
 */
export function segmentsOn(blocks, dowN, defaultDur = () => 60) {
  const d0 = (dowN - 1) * DAY, d1 = d0 + DAY;
  const out = [];
  for (const b of blocks || []) {
    const r = blockRange(b, defaultDur(b));
    for (const shift of [0, -WEEK]) {
      const a = Math.max(r.s + shift, d0), z = Math.min(r.e + shift, d1);
      if (z > a) {
        out.push({
          id: b.id, title: b.title, areaId: b.areaId, block: b, explicit: r.explicit,
          start: hhmm(a - d0), end: hhmm(z - d0), min: z - a,
          cont: r.s + shift < d0, cut: r.e + shift > d1,
        });
      }
    }
  }
  return out.sort((x, y) => (x.start < y.start ? -1 : 1));
}

const DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
/** «пн 16:00 → вт 16:00», «ср 18:00–19:30», «чт 10:00 (1 ч)». */
export function describeBlock(b, defaultDur = 60) {
  const d = DOW[Number(b.dow) - 1] + ' ' + b.start;
  if (!b.end) return d + ' · ' + (defaultDur % 60 ? defaultDur + ' мин' : defaultDur / 60 + ' ч') + ' по умолчанию';
  const r = blockRange(b, defaultDur);
  if (r.e - r.s <= DAY && Math.floor(r.s / DAY) === Math.floor((r.e - 1) / DAY)) return d + '–' + b.end;
  const endDow = ((Math.floor(r.e / DAY) % 7) + 7) % 7;
  return d + ' → ' + DOW[endDow] + ' ' + b.end;
}
