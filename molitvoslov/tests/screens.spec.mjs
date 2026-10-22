// Все экраны на ширине телефона: без ошибок, без горизонтальной прокрутки.
import { test, expect } from '@playwright/test';
import { open, errorsOf, expectNoHorizontalScroll } from './helpers.mjs';

const routes = [
  'now', 'orders', 'themes', 'theme/trust', 'fav', 'names', 'settings',
  'read/psalm/118', 'read/ode/youths', 'read/text/phos', 'read/text/gloria',
];

for (const r of routes) {
  test(`экран «${r}»`, async ({ page }) => {
    const errors = errorsOf(page);
    await open(page, r);
    await expect(page.locator('#app')).not.toBeEmpty();
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

test('нижняя панель ведёт на пять разделов', async ({ page }) => {
  await open(page, 'now');
  for (const [tab, hash] of [['Чины', 'orders'], ['Темы', 'themes'], ['Избранное', 'fav'], ['Помянник', 'names'], ['Сейчас', 'now']]) {
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: tab, exact: true }).click();
    await expect(page).toHaveURL(new RegExp('#' + hash + '$'));
  }
});

test('«Сейчас» в 7:30 предлагает утро, в 19:00 — вечер, в 23:30 — молитву перед сном', async ({ page }) => {
  await open(page, 'now', '2026-10-22T07:30');
  await expect(page.locator('#app')).toContainText('Утро');
  await open(page, 'now', '2026-10-22T19:00');
  await expect(page.locator('#app')).toContainText('Вечер');
  await open(page, 'now', '2026-10-22T23:30');
  await expect(page.locator('#app')).toContainText('сном');
});

test('тёмная тема по системе', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 380, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await open(page, 'now');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g).map(Number);
  expect(r + g + b).toBeLessThan(150);
  await ctx.close();
});
