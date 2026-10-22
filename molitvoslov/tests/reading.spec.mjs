// Чтение: двойное чтение, вопросы, тишина; медленный режим по фразам; режим «только тексты».
import { test, expect } from '@playwright/test';
import { open } from './helpers.mjs';

// настройка — через модуль хранилища (как это делает экран настроек)
const setSetting = (page, key, value) => page.evaluate(async ([k, v]) => (await import('./js/store.js')).setSetting(k, v), [key, value]);

test('обычный режим: текст, 2–3 вопроса, таймер тишины, «Ещё раз, медленно», строка предания', async ({ page }) => {
  await open(page, 'pray/morning/normal');
  const r = page.locator('.pray .block.reading');
  await expect(r.locator('.questions li')).toHaveCount(3);
  await expect(r.locator('.pause')).toHaveCount(1);
  await expect(r).toContainText('Ещё раз, медленно');
  await expect(r.locator('.scripture')).toHaveCount(2);
  await expect(r.locator('.after')).toHaveCount(1);
});

test('медленный режим: фразы открываются по одной касанием', async ({ page }) => {
  await open(page, 'now');
  await setSetting(page, 'readMode', 'slow');
  await open(page, 'pray/morning/normal');
  const box = page.locator('.pray .block.reading .scripture.slow').first();
  const total = await box.locator('.ph').count();
  expect(total).toBeGreaterThan(3);
  await expect(box.locator('.ph.on')).toHaveCount(1);
  await box.click();
  await expect(box.locator('.ph.on')).toHaveCount(2);
  for (let i = 2; i < total; i++) await box.click();
  await expect(box).toHaveClass(/all/);
});

test('режим «только тексты»: без вопросов и тишины', async ({ page }) => {
  await open(page, 'now');
  await setSetting(page, 'readMode', 'plain');
  await open(page, 'pray/morning/normal');
  const r = page.locator('.pray .block.reading');
  await expect(r.locator('.questions')).toHaveCount(0);
  await expect(r.locator('.pause')).toHaveCount(0);
});

test('касание текста показывает источник; «В избранное» сохраняет', async ({ page }) => {
  await open(page, 'pray/evening/normal', '2026-10-22T19:00');
  const phos = page.locator('.pray .block', { hasText: 'Свет тихий' }).first();
  await phos.click();
  await expect(phos).toContainText('Василий Великий');
  await phos.getByRole('button', { name: /В избранное/ }).click();
  await open(page, 'fav');
  await expect(page.locator('#app')).toContainText('Свет тихий');
});

test('место чтения: если отрывок был показан, на следующий день — следующий', async ({ page }) => {
  await open(page, 'pray/morning/normal', '2026-10-22T07:30');
  await page.locator('.pray .block.reading').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await open(page, 'pray/morning/normal', '2026-10-23T07:30');
  await expect(page.locator('.pray .block.reading')).toContainText('Мк 1:9–15');
});

test('если чтение не открывали, отрывок не пропадает', async ({ page }) => {
  await open(page, 'now', '2026-10-22T07:30');
  await open(page, 'now', '2026-10-23T07:30');
  await open(page, 'pray/morning/normal', '2026-10-23T07:30');
  await expect(page.locator('.pray .block.reading')).toContainText('Мк 1:1–8');
});
