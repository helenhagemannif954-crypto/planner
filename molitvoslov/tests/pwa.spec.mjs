// Установка на телефон и работа без сети.
import { test, expect, chromium, devices } from '@playwright/test';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = 'http://localhost:4174/planner/molitvoslov/';
const APP = fileURLToPath(new URL('../../docs/molitvoslov/', import.meta.url));

const persistent = () => chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'molitvoslov-')), { ...devices['Pixel 7'], locale: 'ru-RU', serviceWorkers: 'allow' });

test('манифест без ошибок, нет препятствий к установке, service worker со своей областью', async () => {
  const ctx = await persistent();
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.goto(URL_);
  await expect.poll(() => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }), { timeout: 15000 }).toBe(true);
  const cdp = await ctx.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  expect(manifest.url).toBe(URL_ + 'manifest.json');
  expect(manifest.errors).toEqual([]);
  expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope)).toBe(URL_);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('без сети: приложение открывается и молитва собирается', async () => {
  const ctx = await persistent();
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(URL_);
  await expect.poll(() => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }), { timeout: 15000 }).toBe(true);
  // дождаться, пока service worker разложит файлы в кэш
  await expect.poll(() => page.evaluate(async () => { const keys = await caches.keys(); if (!keys.length) return 0; return (await (await caches.open(keys[0])).keys()).length; }), { timeout: 15000 }).toBeGreaterThan(20);
  await ctx.setOffline(true);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL_ + '?now=2026-10-22T07:30#pray/morning/normal');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  await expect(page.locator('.pray')).toContainText('Отче наш');
  await expect(page.locator('.pray .block.reading')).toContainText('Мк 1:1–8');
  // шрифт тоже из кэша
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('20px Literata'); })).toBe(true);
  // на старт, в настройки и в Псалтирь — тоже без сети
  for (const h of ['now', 'settings', 'read/psalm/90']) {
    await page.goto(URL_ + '#' + h);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  }
  expect(errors).toEqual([]);
  await ctx.close();
});

test('service worker кэширует все файлы приложения', () => {
  const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
  const block = sw.slice(sw.indexOf('const FILES = ['), sw.indexOf('];', sw.indexOf('const FILES = [')));
  const listed = new Set([...block.matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/^\.\//, '')));
  const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [relative(APP, p)]; });
  const files = walk(APP).filter((f) => f !== 'sw.js' && !f.endsWith('OFL.txt') && !f.endsWith('.map'));
  const missing = files.filter((f) => !listed.has(f));
  expect(missing).toEqual([]);
});

test('все пути в манифесте и на странице — относительные, без внешних запросов', async ({ request }) => {
  const html = await (await request.get(URL_)).text();
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) expect(m[1], m[1]).not.toMatch(/^\/|^https?:/);
  expect(html).toContain("default-src 'self'");
  const man = await (await request.get(URL_ + 'manifest.json')).json();
  expect(man).toMatchObject({ start_url: './', scope: './', id: './', display: 'standalone' });
  expect(man.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(man.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const i of man.icons) expect((await request.get(URL_ + i.src)).status(), i.src).toBe(200);
});

test('сайт планировщика в соседней папке не перехватывает молитвослов', async () => {
  const ctx = await persistent();
  const page = ctx.pages()[0] || (await ctx.newPage());
  // сначала открыть планировщик, чтобы его service worker встал на /planner/
  await page.goto('http://localhost:4174/planner/');
  await expect.poll(() => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }), { timeout: 15000 }).toBe(true);
  await page.goto(URL_);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  await expect(page).toHaveTitle(/Молитвослов/);
  await ctx.close();
});

test('версия кэша в sw.js соответствует файлам (запустите tools/sw_version.py)', async () => {
  const { createHash } = await import('node:crypto');
  const h = createHash('sha256');
  const walk = (dir) => readdirSync(dir).sort().flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? [] : [p]; });
  // тот же порядок, что у os.walk: сначала файлы папки, потом подпапки по алфавиту
  const dirs = (dir) => [dir, ...readdirSync(dir).sort().map((f) => join(dir, f)).filter((p) => statSync(p).isDirectory()).flatMap(dirs)];
  const all = dirs(APP.replace(/\/$/, '')).sort().flatMap(walk).filter((p) => relative(APP, p) !== 'sw.js');
  for (const p of all) { h.update(relative(APP, p)); h.update(readFileSync(p)); }
  const v = 'm-' + h.digest('hex').slice(0, 10);
  expect(readFileSync(join(APP, 'sw.js'), 'utf8')).toContain(`const VERSION = '${v}';`);
});
