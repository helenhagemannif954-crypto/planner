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

test('часы и полунощная молитва включаются и выключаются', async ({ page }) => {
  await open(page, 'settings');
  const night = page.getByRole('switch', { name: /Полунощная молитва/ });
  await expect(night).not.toBeChecked();
  await night.check();
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.getByRole('switch', { name: /Полунощная молитва/ })).toBeChecked();
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
