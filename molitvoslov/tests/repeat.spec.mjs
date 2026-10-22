// Неповторяемость: молитвы не повторяются несколько дней подряд; Псалтирь идёт по кругу.
import { test, expect } from '@playwright/test';
import { open } from './helpers.mjs';

// сменяемые тексты (из пула) — те, у которых есть кнопка «Другая»
const swappable = (page) => page.evaluate(() => [...document.querySelectorAll('.pray .block.text')]
  .filter((b) => [...b.querySelectorAll('button')].some((x) => x.textContent.includes('Другая')))
  .map((b) => b.querySelector('.stanza')?.innerText.trim() || ''));

test('утренняя молитва из пула в пять дней подряд — каждый раз другая', async ({ page }) => {
  const firsts = [];
  for (let d = 19; d <= 23; d++) {
    await open(page, 'pray/morning/normal', `2026-10-${d}T07:30`);
    const s = await swappable(page);
    expect(s.length).toBeGreaterThan(0);
    firsts.push(s[0]);
  }
  expect(new Set(firsts).size).toBe(firsts.length);
});

test('в один и тот же день чин не меняется при повторном открытии', async ({ page }) => {
  await open(page, 'pray/morning/normal', '2026-10-22T07:30');
  const a = await swappable(page);
  await open(page, 'pray/morning/normal', '2026-10-22T09:00');
  expect(await swappable(page)).toEqual(a);
});

test('«Другая» меняет молитву на другую из того же пула', async ({ page }) => {
  await open(page, 'pray/morning/normal', '2026-10-22T07:30');
  const blk = page.locator('.pray .block.text').filter({ has: page.getByRole('button', { name: 'Другая', includeHidden: true }) }).first();
  const before = await blk.locator('.stanza').first().innerText();
  await blk.click();
  await blk.getByRole('button', { name: 'Другая' }).click();
  await expect(page.locator('.pray')).not.toContainText(before.split('\n')[0]);
});

test('Псалтирь по кругу: показанный отрывок на следующий день сменяется следующим', async ({ page }) => {
  const circle = () => page.locator('.pray .block.psalm[data-circle]').first();
  const circleRubric = () => circle().locator('.rubric').first().innerText();
  await open(page, 'pray/morning/normal', '2026-10-22T07:30');
  const t1 = await circleRubric();
  await circle().scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await open(page, 'pray/morning/normal', '2026-10-23T07:30');
  expect(await circleRubric()).not.toBe(t1);
});
