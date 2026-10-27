// Каждый чин в каждом состоянии в разные дни церковного года собирается без ошибок.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { open, errorsOf, officeText, expectNoHorizontalScroll } from './helpers.mjs';

const orders = JSON.parse(readFileSync(new URL('../../docs/molitvoslov/content/orders.json', import.meta.url)));
const offices = Object.values(orders.offices);

// юлианская Пасха 2026 — 12 апреля (н. ст.)
const days = {
  'рядовой четверг': '2026-10-22',
  'постная среда': '2026-10-21',
  'воскресенье': '2026-10-25',
  'Пасха': '2026-04-12',
  'будний день Четыредесятницы': '2026-03-04',
  'Великая пятница': '2026-04-10',
};

for (const off of offices) {
  const states = Array.isArray(off.states) ? off.states : off.states === false ? ['normal'] : ['normal', 'weary', 'hard'];
  for (const state of states) {
    test(`${off.title} · ${state}: собирается во все дни`, async ({ page }) => {
      const errors = errorsOf(page);
      for (const [label, day] of Object.entries(days)) {
        await open(page, `pray/${off.id}/${state}`, `${day}T08:00`);
        const blocks = await page.locator('.pray .block').count();
        expect(blocks, `${label}: блоков`).toBeGreaterThan(0);
        await expect(page.locator('.pray')).toContainText('Аминь');
        await expectNoHorizontalScroll(page);
      }
      expect(errors).toEqual([]);
    });
  }
}

for (const vol of ['short', 'full']) {
  test(`объём «${vol}»: каждый чин в каждом состоянии собирается`, async ({ page }) => {
    const errors = errorsOf(page);
    await open(page, 'now');
    await page.evaluate(async (v) => (await import('./js/store.js')).setSetting('volume', v), vol);
    for (const off of offices) {
      for (const state of Array.isArray(off.states) ? off.states : off.states === false ? ['normal'] : ['normal', 'weary', 'hard']) {
        for (const day of ['2026-10-21', '2026-03-04']) {
          await open(page, `pray/${off.id}/${state}`, `${day}T08:00`);
          await expect(page.locator('.pray'), `${off.id}/${state} ${day}`).toContainText('Аминь');
        }
      }
    }
    expect(errors).toEqual([]);
  });
}

test('утро, обычное: вход, Пс 62, псалом по кругу, «Слава в вышних», чтение, Отче наш, отпуст', async ({ page }) => {
  await open(page, 'pray/morning/normal', '2026-10-22T07:30');
  const t = await officeText(page);
  expect(t).toContain('Господи, открой мои уста');
  expect(t).toContain('Боже, Боже мой');
  expect(await page.locator('.pray .block.psalm[data-circle]').count()).toBe(1);
  expect(t).toContain('Слава в вышних Богу');
  expect(t).toMatch(/Чтение\s*Мк 1:1–8/);
  expect(t).toContain('Отче наш');
});

test('вечер: Пс 140, «Свет тихий», пересмотр дня, песнь Симеона', async ({ page }) => {
  await open(page, 'pray/evening/normal', '2026-10-22T19:00');
  const t = await officeText(page);
  expect(t).toContain('Господи, я воззвал к Тебе');
  expect(t).toMatch(/Свет тихий/);
  expect(t).toContain('Пересмотр дня');
  expect(t).toContain('Покаяние');
  expect(t).toContain('Теперь Ты отпускаешь');
});

test('воскресенье: в пересмотре дня нет покаяния, вместо него «Отпустить»', async ({ page }) => {
  await open(page, 'pray/evening/normal', '2026-10-25T19:00');
  const t = await officeText(page);
  expect(t).toContain('Отпустить');
  expect(t).not.toContain('Покаяние');
});

test('Пасха: пасхальный вход', async ({ page }) => {
  await open(page, 'pray/morning/normal', '2026-04-12T07:30');
  expect(await officeText(page)).toContain('Господь истинно воскрес');
});

test('будни Четыредесятницы: молитва Ефрема — «Великопостная», авторство только с пометкой «традиционно приписывается»', async ({ page }) => {
  await open(page, 'pray/morning/normal', '2026-03-04T07:30');
  const t = await officeText(page);
  expect(t).toContain('суетного любопытства');
  expect(t).toContain('Великопостная молитва');
  expect(t).not.toContain('Молитва Ефрема');
  await page.locator('.pray .block', { hasText: 'суетного любопытства' }).first().click();
  await expect(page.locator('.pray')).toContainText('традиционно приписывается');
});

test('«Нет сил»: две-три минуты — короткий стих, Отче наш, одна строка', async ({ page }) => {
  await open(page, 'pray/morning/weary', '2026-10-22T07:30');
  const n = await page.locator('.pray .block').count();
  expect(n).toBeLessThanOrEqual(4);
  expect(await officeText(page)).toContain('Отче наш');
});

test('«Тяжело»: псалом плача или песнь Ионы, тишина, утешение', async ({ page }) => {
  await open(page, 'pray/morning/hard', '2026-10-22T07:30');
  const t = await officeText(page);
  expect(t).toContain('Боже, внемли — помоги мне');
  expect(await page.locator('.pray .timer, .pray .pause').count()).toBeGreaterThan(0);
});

test('объём правила: краткое короче обычного, полное длиннее', async ({ page }) => {
  const count = async (vol) => {
    await open(page, 'now');
    await page.evaluate(async (v) => (await import('./js/store.js')).setSetting('volume', v), vol);
    await open(page, 'pray/morning/normal', '2026-10-22T07:30');
    return page.locator('.pray .block').count();
  };
  const short = await count('short'), normal = await count('normal'), full = await count('full');
  expect(short).toBeLessThan(normal);
  expect(full).toBeGreaterThan(normal);
});

test('авторская строка по касанию показывает «Составлено для приложения»', async ({ page }) => {
  await open(page, 'pray/morning/normal', '2026-10-22T07:30');
  const own = page.locator('.pray .block.own').first();
  await own.locator('.direction').click();
  await expect(own).toContainText('Составлено для приложения');
  // заголовок часа — тоже авторский, со ссылкой на Евангелие
  await open(page, 'pray/third/normal', '2026-10-22T09:30');
  const head = page.locator('.pray .block.remembrance .head').first();
  await head.click();
  await expect(head).toContainText('Мк 15:25');
});

test('правило ко Причащению: раздел в «Чинах», три части, полное длиннее краткого', async ({ page }) => {
  const errors = errorsOf(page);
  await open(page, 'orders');
  await expect(page.locator('.sect', { hasText: 'Ко Причащению' })).toHaveCount(1);
  const parts = { 'communion-eve': 'Накануне вечером', 'communion-morning': 'Утром перед Литургией', 'communion-after': 'После Причащения' };
  for (const title of Object.values(parts)) {
    const card = page.locator('.card', { has: page.locator('h2', { hasText: title }) });
    await expect(card.getByRole('button', { name: 'Полное' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Краткое' })).toBeVisible();
  }
  const count = {};
  for (const id of Object.keys(parts)) {
    for (const vol of ['full', 'short']) {
      await open(page, `pray/${id}/${vol}`, '2026-10-24T20:00');
      await expect(page.locator('.office-head .odate')).toContainText(vol === 'full' ? 'Полное' : 'Краткое');
      await expect(page.locator('.pray')).toContainText('Отче наш');
      count[id + vol] = await page.locator('.pray .block').count();
    }
    expect(count[id + 'full'], id).toBeGreaterThan(count[id + 'short']);
  }
  // главное в каждой части
  await open(page, 'pray/communion-eve/full', '2026-10-24T20:00');
  let t = await officeText(page);
  expect(t).toContain('Да испытывает же себя человек');
  expect(t).toContain('пойди прежде примирись');
  expect(t).toContain('пока они не примирятся'); // Дидахе 14
  expect(t).toContain('Помилуй меня, Боже');
  await open(page, 'pray/communion-morning/short', '2026-10-25T07:30');
  t = await officeText(page);
  expect(t).toContain('Благословлю Господа во всякое время'); // Пс 33
  expect(t).toContain('Святое — святым');
  await open(page, 'pray/communion-after/short', '2026-10-25T12:00');
  t = await officeText(page);
  expect(t).toContain('удостоил нас');
  expect(t).toMatch(/Теперь Ты отпускаешь/);
  // связующая строка о Пс 33 — с пометкой и ссылкой на свидетельства
  await open(page, 'pray/communion-morning/full', '2026-10-25T07:30');
  const ln = page.locator('.pray .block.line', { hasText: 'Этот псалом пели' });
  await ln.click();
  await expect(ln).toContainText('Составлено для приложения');
  await expect(ln).toContainText('VIII.13');
  expect(errors).toEqual([]);
});
