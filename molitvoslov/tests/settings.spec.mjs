// Настройки сохраняются между запусками и сразу меняют вид.
import { test, expect } from '@playwright/test';
import { open, errorsOf } from './helpers.mjs';

test('размер шрифта, тема, объём и длительность тишины сохраняются', async ({ page }) => {
  const errors = errorsOf(page);
  await open(page, 'settings');
  await page.locator('#fs').fill('24');
  await page.getByRole('radiogroup', { name: 'Тема' }).getByRole('radio', { name: 'Тёмная' }).click();
  await page.getByRole('radiogroup', { name: 'Объём правила' }).getByRole('radio', { name: 'Полное' }).click();
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim())).toBe('24px');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await expect(page.getByRole('radiogroup', { name: 'Объём правила' }).getByRole('radio', { name: 'Полное' })).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('полунощная молитва — наравне с остальными: без переключателя, в «Чинах», в «Сегодня», ночью предлагается сама', async ({ page }) => {
  await open(page, 'settings');
  await expect(page.getByRole('switch', { name: /Полунощная/ })).toHaveCount(0);
  await open(page, 'orders');
  await expect(page.locator('.card h2', { hasText: 'Полунощная' })).toHaveCount(1);
  await expect(page.locator('.card', { hasText: 'Полунощная' })).not.toContainText('настройках');
  await open(page, 'now', '2026-10-22T07:30');
  await expect(page.locator('.list .row .rt', { hasText: 'Полунощная' })).toHaveCount(1);
  await open(page, 'now', '2026-10-23T02:30');
  await expect(page.locator('.maincard h2')).toContainText('Полунощная');
});

test('тема седмицы на главном экране — кнопка, которая сразу открывает молитву по теме', async ({ page }) => {
  await open(page, 'now', '2026-10-22T07:30');
  const btn = page.locator('.themecard').getByRole('button', { name: /Молиться по теме/ });
  await expect(btn).toBeVisible();
  // вид — как у кнопок чинов («Нет сил», «Тяжело»)
  const look = (l) => l.evaluate((e) => { const s = getComputedStyle(e); return [s.borderTopWidth, s.borderTopStyle, s.borderRadius, s.minHeight, s.fontSize]; });
  expect(await look(btn)).toEqual(await look(page.locator('.maincard').getByRole('button', { name: 'Нет сил' })));
  await btn.click();
  await page.waitForFunction(() => location.hash.startsWith('#pray/theme/normal/'));
  await expect(page.locator('.pray .block.verse-b').first()).toBeVisible();
  await expect(page.locator('.office-head h1')).toContainText('Тема седмицы');
});

test('напоминания выключены по умолчанию и не просят разрешений', async ({ page }) => {
  let asked = false;
  await page.exposeFunction('__askedNotif', () => { asked = true; });
  await page.addInitScript(() => { if (window.Notification) window.Notification.requestPermission = () => { window.__askedNotif(); return Promise.resolve('denied'); }; });
  await open(page, 'settings');
  await expect(page.locator('#app')).toContainText('Напоминания о часах');
  await open(page, 'pray/morning/normal');
  expect(asked).toBe(false);
});

test('копия данных: сохранить и восстановить', async ({ page }) => {
  await open(page, 'names');
  await page.getByLabel('О живых: новое имя').fill('Ольга');
  await page.getByLabel('О живых: новое имя').press('Enter');
  const data = await page.evaluate(async () => (await import('./js/store.js')).exportData());
  expect(JSON.parse(data).names.living).toContain('Ольга');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(async (d) => (await import('./js/store.js')).importData(d), data);
  await open(page, 'names');
  await expect(page.locator('.namelist-edit').first()).toContainText('Ольга');
});
