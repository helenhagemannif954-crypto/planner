// Текст Писания и вообще текст каждого блока: на каждый день года, в каждом чине и состоянии
// у блока с заголовком или ссылкой есть сам текст, а у чтения он совпадает со ссылкой.
import { test, expect } from '@playwright/test';
import { open, errorsOf } from './helpers.mjs';

test.setTimeout(240000);

// весь год по юлианской пасхалии 2026 (Пасха 12 апреля): Четыредесятница, Страстная, Пасха,
// Пятидесятница, Богоявление, рядовые седмицы
test('каждый день года: у каждого блока каждого чина есть текст, чтение совпадает со ссылкой', async ({ page }) => {
  await open(page, 'now', '2026-01-01T08:00');
  const problems = await page.evaluate(async () => {
    const { buildOffice } = await import('./js/office.js');
    const { C } = await import('./js/content.js');
    const store = await import('./js/store.js');
    const REF = /^((?:[1-4] )?[А-Яа-яё]+) (\d+):(\d+)(?:–(?:(\d+):)?(\d+))?$/;
    const filled = (a) => Array.isArray(a) && a.some((x) => String(x || '').trim());
    const out = [];
    const bad = (where, b, why) => { if (out.length < 30) out.push(`${where} · ${b.t} «${b.rubric || b.ref || ''}»: ${why}`); };
    const check = (where, b) => {
      switch (b.t) {
        case 'reading': {
          const p = b.passage;
          const vs = p?.verses || [];
          if (!vs.length || vs.some((v) => !String(v[2] || '').trim())) return bad(where, b, `нет текста у ${p?.ref}`);
          const m = REF.exec(p.ref);
          if (!m) return bad(where, b, `ссылка не разобрана: ${p.ref}`);
          const [, book, c1, v1, c2, v2] = m;
          const first = [+c1, +v1], last = [c2 ? +c2 : +c1, v2 ? +v2 : +v1];
          if (book !== p.book || vs[0][0] !== first[0] || vs[0][1] !== first[1] || vs.at(-1)[0] !== last[0] || vs.at(-1)[1] !== last[1]) bad(where, b, `текст не совпадает со ссылкой ${p.ref}`);
          return;
        }
        case 'psalm':
          if (!b.verses?.length || b.verses.some((v) => !filled(v.l))) bad(where, b, 'нет стихов');
          return;
        case 'text': case 'word': case 'verse':
          if (!filled(b.lines)) bad(where, b, 'нет текста');
          return;
        case 'dismissal':
          if (!b.line) bad(where, b, 'нет строки отпуста');
          if (b.bless && !filled(b.bless.lines)) bad(where, b, `нет текста благословения ${b.bless.ref}`);
          return;
        case 'remembrance':
          if (!b.line) bad(where, b, 'нет строки часа');
          if (b.quote && !filled(b.quote.lines)) bad(where, b, 'нет текста слова отцов');
          return;
        case 'intercession':
          if (b.prayer && !filled(b.prayer.lines)) bad(where, b, 'нет текста молитвы');
          return;
      }
    };
    let n = 0;
    for (const vol of ['short', 'normal', 'full']) {
      store.setSetting('volume', vol);
      for (let d = new Date(2026, 0, 1, 8); d.getFullYear() === 2026; d.setDate(d.getDate() + (vol === 'normal' ? 1 : 3))) {
        for (const off of C.orders.offices) {
          for (const state of Array.isArray(off.states) ? off.states : off.states === false ? ['normal'] : ['normal', 'weary', 'hard']) {
            const o = buildOffice(off.id, state, new Date(d));
            if (!o.blocks.length) bad(`${d.toISOString().slice(0, 10)} ${off.id}/${state}`, { t: '—' }, 'пустой чин');
            for (const b of o.blocks) { check(`${d.toISOString().slice(0, 10)} ${off.id}/${state}/${vol}`, b); n++; }
          }
        }
      }
    }
    return { n, out };
  });
  expect(problems.n).toBeGreaterThan(20000);
  expect(problems.out).toEqual([]);
});

// то же на экране: в утрене и вечерне блок чтения и «слово» показывают текст, а не только ссылку
const days = { 'рядовой день': '2026-10-27', 'Пасха': '2026-04-12', 'Великая пятница': '2026-04-10', 'Четыредесятница': '2026-03-04', 'Пятидесятница': '2026-05-31', 'Богоявление': '2026-01-19' };
for (const [label, day] of Object.entries(days)) {
  test(`${label}: на экране у чтения и у «слова» есть текст`, async ({ page }) => {
    const errors = errorsOf(page);
    for (const [off, t] of [['morning', '07:30'], ['evening', '19:00']]) {
      for (const state of ['normal', 'weary', 'hard']) {
        await open(page, `pray/${off}/${state}`, `${day}T${t}`);
        const blocks = await page.evaluate(() => [...document.querySelectorAll('.pray .block')].map((s) => {
          const c = s.cloneNode(true);
          c.querySelectorAll('.rubric, .again, .ref, .meta, .ptitle, .hint, .questions, .pause, .after').forEach((x) => x.remove());
          return { cls: s.className, head: s.querySelector('.rubric')?.innerText || '', text: c.innerText.trim() };
        }));
        for (const b of blocks) {
          if (/silence|themeline/.test(b.cls)) continue;
          expect(b.text.length, `${day} ${off}/${state}: «${b.head}» (${b.cls}) без текста`).toBeGreaterThan(10);
        }
        // в чтении — сам отрывок, дважды (если не «только тексты»), а не одна ссылка
        for (const r of await page.locator('.pray .block.reading .scripture').allInnerTexts()) expect(r.trim().length).toBeGreaterThan(40);
      }
    }
    expect(errors).toEqual([]);
  });
}

test('длинное чтение крупным шрифтом засчитывается как прочитанное, и вечером есть «Утреннее слово»', async ({ page }) => {
  await open(page, 'now', '2026-10-27T07:30');
  await page.evaluate(async () => (await import('./js/store.js')).setSetting('fontSize', 30));
  await page.setViewportSize({ width: 380, height: 300 });
  await open(page, 'pray/morning/normal', '2026-10-27T07:30');
  const tall = await page.locator('.pray .block.reading').evaluate((e) => e.getBoundingClientRect().height);
  expect(tall).toBeGreaterThan(300 / 0.15); // выше, чем 15 % могут занять на экране
  // листаем, как человек: до конца чтения
  for (let i = 0; i < 40; i++) await page.locator('.pray').evaluate((p) => p.scrollBy(0, 300));
  await page.waitForTimeout(200);
  expect(await page.evaluate(async () => (await import('./js/store.js')).get().reading.shown)).toBe(true);
  await open(page, 'pray/evening/normal', '2026-10-27T19:00');
  await expect(page.locator('.pray .block.word')).toContainText('Утреннее слово');
});
