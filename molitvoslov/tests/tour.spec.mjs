// Знакомство с молитвословом при первом открытии.
import { test, expect } from '@playwright/test';
import { open, errorsOf, expectNoHorizontalScroll } from './helpers.mjs';

// без open(): это чистый первый запуск, знакомство не подавлено
const firstRun = async (page, now = '2026-10-22T07:30') => {
  await page.goto(`./?now=${now}#now`);
  await page.waitForFunction(() => window.__ready === true);
};
const tour = (page) => page.getByRole('dialog', { name: 'Знакомство с молитвословом' });
const slideIndex = (page) => page.locator('.tour-dots span').evaluateAll((d) => d.findIndex((x) => x.classList.contains('on')));

test('первый запуск: знакомство из 4–6 экранов, «Пропустить» видна всегда, второй раз не показывается', async ({ page }) => {
  const errors = errorsOf(page);
  await firstRun(page);
  await expect(tour(page)).toBeVisible();
  const n = await page.locator('.tour-slide').count();
  expect(n).toBeGreaterThanOrEqual(4);
  expect(n).toBeLessThanOrEqual(6);
  // каждый экран: одна мысль — заголовок и одна-две фразы, рисунок или кусочек интерфейса
  for (const s of await page.locator('.tour-slide').all()) {
    await expect(s.locator(':scope > h2')).toHaveCount(1);
    await expect(s.locator('.tour-art')).toHaveCount(1);
    const text = await s.locator(':scope > p').innerText();
    expect(text.split(/[.!?…](?:\s|$)/).filter((x) => x.trim()).length).toBeLessThanOrEqual(2);
  }
  // листаем «Далее» до конца: «Пропустить» на месте на каждом экране
  for (let i = 0; i < n - 1; i++) {
    await expect(page.getByRole('button', { name: 'Пропустить' })).toBeVisible();
    await page.getByRole('button', { name: 'Далее' }).click();
    await expect.poll(() => slideIndex(page)).toBe(i + 1);
  }
  await expect(page.getByRole('button', { name: 'Пропустить' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Начать молитву' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  await expect(tour(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('«Пропустить» закрывает знакомство, главный экран доступен', async ({ page }) => {
  await firstRun(page);
  await page.getByRole('button', { name: 'Пропустить' }).click();
  await expect(tour(page)).toHaveCount(0);
  await page.locator('.maincard').getByRole('button', { name: 'Начать' }).click();
  await page.waitForFunction(() => location.hash.startsWith('#pray/'));
});

test('экраны листаются свайпом, а «Начать молитву» открывает молитву по времени', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: 'http://localhost:4174/planner/molitvoslov/', viewport: { width: 380, height: 800 }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await firstRun(page, '2026-10-22T19:00');
  const cdp = await ctx.newCDPSession(page);
  const n = await page.locator('.tour-slide').count();
  for (let i = 1; i < n; i++) {
    // палец справа налево, как на телефоне
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: 400 }] });
    await touch('touchStart', 320);
    for (let x = 300; x >= 60; x -= 20) await touch('touchMove', x);
    await touch('touchEnd');
    await expect.poll(() => slideIndex(page), { timeout: 4000 }).toBe(i);
  }
  await page.getByRole('button', { name: 'Начать молитву' }).click();
  await expect(tour(page)).toHaveCount(0);
  await page.waitForFunction(() => location.hash === '#pray/evening/normal');
  await expect(page.locator('.pray')).toContainText('Свет тихий');
  await ctx.close();
});

test('«Как пользоваться» в настройках показывает знакомство снова', async ({ page }) => {
  await open(page, 'settings');
  await expect(tour(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Как пользоваться' }).click();
  await expect(tour(page)).toBeVisible();
  await expect.poll(() => slideIndex(page)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Как пользоваться' }).click();
  await expect(tour(page)).toBeVisible();
});

test('знакомство в тёмной теме и на узком экране: без горизонтальной прокрутки страницы', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: 'http://localhost:4174/planner/molitvoslov/', viewport: { width: 320, height: 640 }, colorScheme: 'dark', locale: 'ru-RU' });
  const page = await ctx.newPage();
  const errors = errorsOf(page);
  await firstRun(page);
  for (let i = 0; i < 6 && await page.getByRole('button', { name: 'Далее' }).count(); i++) {
    await expectNoHorizontalScroll(page);
    // заголовок и текст экрана целиком на экране
    const box = await page.locator('.tour-slide').nth(i).locator(':scope > h2').boundingBox();
    expect(box.y).toBeGreaterThan(40);
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.waitForTimeout(450);
  }
  expect(errors).toEqual([]);
  await ctx.close();
});
