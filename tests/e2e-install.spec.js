// Установка на рабочий стол: сайт в подпапке /planner/ (как на GitHub Pages), Android-телефон.
import { test, expect, chromium, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = 'http://localhost:4174/planner/';

test('Chromium на Android не видит препятствий к установке; service worker со scope /planner/', async () => {
  // обычный (не инкогнито) профиль — как у человека
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pwa-')), { ...devices['Pixel 7'], locale: 'ru-RU', serviceWorkers: 'allow' });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [], logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); logs.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.goto(URL_);
  await expect.poll(() => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }), { timeout: 15000 }).toBe(true);
  const cdp = await ctx.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  expect(manifest.url).toBe(URL_ + 'manifest.json');
  expect(manifest.errors).toEqual([]);
  expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope);
  expect(scope).toBe(URL_);
  await page.waitForTimeout(4500);
  expect(logs.some((l) => l.includes('[установка] service worker зарегистрирован, scope ' + URL_))).toBe(true);
  expect(logs.some((l) => l.includes('[установка] все условия установки выполнены'))).toBe(true);
  expect(errors).toEqual([]);
  // экран самопроверки в настройках — все пункты выполнены
  await page.getByLabel('Ваше имя').fill('Тест');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Готово' }).click();
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: /Установка на рабочий стол/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Установка на рабочий стол' });
  await expect(dlg).toContainText('Chrome: меню ⋮ → «Установить приложение»');
  await expect(dlg.getByText('Service worker активен')).toBeVisible();
  expect(await dlg.getByText('✕').count()).toBe(0);
  // событие beforeinstallprompt попадает в журнал и включает кнопку «Установить приложение»
  await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = async () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Установка на рабочий стол/ }).click();
  await page.getByRole('button', { name: 'Установить приложение' }).click();
  expect(await page.evaluate(() => window.__prompted)).toBe(true);
  await ctx.close();
});

test('все пути в манифесте и на странице — относительные', async ({ request }) => {
  const html = await (await request.get(URL_)).text();
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) expect(m[1], m[1]).not.toMatch(/^\/|^https?:/);
  const man = await (await request.get(URL_ + 'manifest.json')).json();
  expect(man).toMatchObject({ start_url: './', scope: './', id: './', display: 'standalone' });
  const sizes = man.icons.map((i) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(man.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const i of man.icons) expect((await request.get(URL_ + i.src)).status(), i.src).toBe(200);
  for (const s of man.shortcuts) expect(s.url).toMatch(/^\.\//);
  expect(man.share_target.action).toBe('./');
});

test('на основных экранах нет ошибок в консоли', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const { start, add, tab } = await import('./helpers.js');
  await start(page);
  await add(page, 'совещание завтра в 10');
  await add(page, 'купить хлеб');
  for (const t of ['Входящие', 'План', 'Области', 'Сегодня']) await tab(page, t);
  for (const m of ['День', 'Месяц', 'Год']) { await tab(page, 'План'); await page.getByRole('button', { name: m, exact: true }).click(); }
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: /Установка на рабочий стол/ }).click();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
