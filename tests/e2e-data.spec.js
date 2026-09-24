// Сохранность данных: миграция старой версии, экспорт → импорт, офлайн, ярлыки.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { start, add, tab, dump, NOW } from './helpers.js';

test('миграция данных версии 1: всё на месте, копия перед миграцией сделана', async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.goto('/manifest.json');
  // старая версия хранила задачи в другом формате
  await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('planner', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const k of ['tasks', 'areas', 'people', 'templates', 'groups']) db.createObjectStore(k, { keyPath: 'id' });
      db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('backups', { keyPath: 'id' });
    };
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction(['tasks', 'areas', 'meta'], 'readwrite');
      tx.objectStore('areas').put({ id: 'a1', name: 'Семья', color: '#6d8f4e' });
      tx.objectStore('tasks').put({ id: 't1', title: 'Купить подарок', done: false, due: '2026-09-24', area: 'Семья', notes: 'не забыть открытку' });
      tx.objectStore('tasks').put({ id: 't2', title: 'Давно сделанное', done: true, doneAt: '2026-01-01T10:00:00Z' });
      tx.objectStore('tasks').put({ id: 't3', title: 'Без даты', done: false });
      tx.objectStore('meta').put({ key: 'schema', value: 1 });
      tx.objectStore('meta').put({ key: 'settings', value: { myName: 'Старый', onboarded: true } });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    r.onerror = () => reject(r.error);
  }));
  await page.goto('/');
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.locator('.toast')).toContainText('Данные обновлены');
  await expect(page.locator('#view')).toContainText('Купить подарок');
  const d = await dump(page);
  expect(d.schema).toBeGreaterThanOrEqual(2);
  expect(d.data.tasks.find((t) => t.id === 't1')).toMatchObject({ text: 'Купить подарок', status: 'active', date: '2026-09-24', areaId: 'a1', note: 'не забыть открытку' });
  expect(d.data.tasks.find((t) => t.id === 't2').status).toBe('done');
  expect(d.data.tasks.find((t) => t.id === 't3')).toMatchObject({ text: 'Без даты', inbox: true });
  expect(d.data.meta.settings.myName).toBe('Старый');
  const backups = await page.evaluate(async () => (await import(location.origin + '/js/db.js')).listBackups());
  const pre = backups.find((b) => b.reason === 'before-migration-v1');
  expect(pre).toBeTruthy();
  expect(pre.snapshot.data.tasks.find((t) => t.id === 't1').title).toBe('Купить подарок');
});

test('экспорт → импорт в другой профиль без потерь', async ({ browser }) => {
  const ctxA = await browser.newContext({ acceptDownloads: true });
  const a = await ctxA.newPage();
  await start(a, { name: 'Иоанн' });
  await add(a, 'позвонить владыке завтра в 15:00');
  await add(a, 'зарядка каждый день в 7');
  await add(a, 'отчёт по гранту до 15.10');
  await add(a, 'уже сделал проверил почту');
  await add(a, 'сессия с А.К. в пт в 18');
  await a.getByRole('button', { name: /Создать А.К./ }).click();
  await a.waitForTimeout(300);
  const before = await dump(a);
  // экспорт через меню
  await a.getByRole('button', { name: 'Меню' }).click();
  await a.getByRole('button', { name: 'Резервная копия' }).click();
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: /Сохранить копию/ }).click()]);
  const path = await download.path();
  const text = readFileSync(path, 'utf8');
  expect(download.suggestedFilename()).toMatch(/^planner-\d{4}-\d{2}-\d{2}\.json$/);
  const file = JSON.parse(text);
  expect(file.app).toBe('planner');
  await expect(a.locator('.toast')).toContainText('Копия сохранена');

  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await start(b, { name: 'Другой' });
  await add(b, 'чужая задача');
  await b.getByRole('button', { name: 'Меню' }).click();
  await b.getByRole('button', { name: 'Резервная копия' }).click();
  const [chooser] = await Promise.all([b.waitForEvent('filechooser'), b.getByRole('button', { name: 'Загрузить из файла…' }).click()]);
  await chooser.setFiles(path);
  // сначала — что будет загружено
  await expect(b.getByText(/Будет загружено: задач в работе/)).toBeVisible();
  await b.getByRole('button', { name: 'Загрузить', exact: true }).click();
  await expect(b.locator('.toast')).toContainText('Данные загружены');
  const after = await dump(b);
  for (const k of ['tasks', 'areas', 'people', 'templates', 'groups']) {
    const sort = (x) => [...x].sort((p, q) => (p.id < q.id ? -1 : 1));
    expect(sort(after.data[k]), k).toEqual(sort(before.data[k]));
  }
  expect(after.data.meta.settings.myName).toBe('Иоанн');
  // прежние данные B не пропали насовсем — лежат во внутренней копии
  const backups = await b.evaluate(async () => (await import(location.origin + '/js/db.js')).listBackups());
  const pre = backups.find((x) => x.reason === 'before-import');
  expect(pre.snapshot.data.tasks.some((t) => t.text === 'Чужая задача')).toBe(true);
  await ctxA.close();
  await ctxB.close();
});

test('офлайн: после первой загрузки приложение работает без сети', async ({ browser }) => {
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await start(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(async () => { await page.reload(); });
  await page.waitForFunction(async () => {
    const keys = await caches.keys();
    if (!keys.length) return false;
    const c = await caches.open(keys[0]);
    return (await c.keys()).length > 30;
  });
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  await add(page, 'добавлено без интернета сегодня');
  await expect(page.locator('#view')).toContainText('Добавлено без интернета');
  await page.goto('/?action=add');
  await expect(page.getByLabel('Новая задача')).toBeVisible();
  await ctx.close();
});

test('кэш service worker покрывает все файлы приложения', async () => {
  const sw = readFileSync('docs/sw.js', 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+\.(?:js|css|html|json|png|svg))'/g)].map((m) => m[1]));
  const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = walk('docs').map((p) => p.slice(5)).filter((p) => p !== 'sw.js' && !p.startsWith('screens/'));
  for (const f of files) expect(listed.has(f), f).toBe(true);
});

test('ярлык «Добавить» открывает только ввод; после сохранения — «Добавлено»', async ({ page }) => {
  await start(page);
  await page.goto('/?action=add');
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.getByRole('navigation', { name: 'Разделы' })).toHaveCount(0);
  await expect(page.locator('#view')).toHaveCount(0);
  const inp = page.getByLabel('Новая задача');
  await expect(inp).toBeFocused();
  await inp.fill('купить лампаду завтра');
  await inp.press('Enter');
  await expect(page.getByRole('heading', { name: 'Добавлено' })).toBeVisible();
  await expect(page.getByText('Можно закрыть')).toBeVisible();
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Купить лампаду', date: '2026-09-25' });
});

test('ярлык «Голосом»: без распознавания речи — тихая подсказка про клавиатуру', async ({ page }) => {
  await page.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
  await start(page);
  await page.goto('/?action=voice');
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.getByText(/микрофон на клавиатуре/)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Разделы' })).toHaveCount(0);
});

test('голос: распознанный текст проходит тот же разбор', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeSR {
      start() { setTimeout(() => { this.onresult({ results: [[{ transcript: 'позвонить маме завтра в 18' }]] }); this.onend(); }, 50); }
      stop() {}
    }
    window.webkitSpeechRecognition = FakeSR;
    window.SpeechRecognition = FakeSR;
  });
  await start(page);
  await page.getByRole('button', { name: 'Голосом' }).click();
  await expect(page.getByLabel('Распознано')).toContainText('18:00');
  await page.getByRole('button', { name: 'Добавить' }).click();
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Позвонить маме', date: '2026-09-25', time: '18:00' });
});

test('manifest: ярлыки и share_target', async ({ request }) => {
  const m = await (await request.get('/manifest.json')).json();
  expect(m.shortcuts.map((s) => s.name)).toEqual(['Добавить задачу', 'Голосом', 'Сегодня']);
  expect(m.share_target.params.text).toBe('text');
  expect(m.display).toBe('standalone');
  expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
});

test('«Поделиться» в приложение: текст становится задачей с тем же разбором', async ({ page }) => {
  await start(page);
  await page.goto('/?text=' + encodeURIComponent('забрать книги в пятницу'));
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.getByLabel('Распознано')).toContainText('завтра');
  await page.getByLabel('Новая задача').press('Enter');
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Забрать книги', date: '2026-09-25' });
});

test('в коде нет внешних запросов', async () => {
  const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const f of walk('docs').filter((p) => /\.(js|html|css|json)$/.test(p))) {
    const s = readFileSync(f, 'utf8');
    const urls = [...s.matchAll(/https?:\/\/[^\s'"`)<>]+/g)].map((m) => m[0]).filter((u) => !u.startsWith('http://www.w3.org/2000/svg'));
    expect(urls, f).toEqual([]);
  }
});
