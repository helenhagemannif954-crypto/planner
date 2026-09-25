// Нижнее меню на невысоких экранах и «Диагностика календаря».
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { start, add } from './helpers.js';
import { buildIcs, checkIcs } from '../docs/js/ics.js';

// ——— меню ———
async function fitsAndScrolls(page, sheetName, itemSel) {
  const vh = page.viewportSize().height;
  const dlg = page.getByRole('dialog', { name: sheetName });
  await expect(dlg).toBeVisible();
  await page.waitForTimeout(300); // выезд листа
  const box = await dlg.boundingBox();
  expect(box.y, 'верх листа на экране').toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, 'низ листа не за краем экрана').toBeLessThanOrEqual(vh + 0.5);
  const items = dlg.locator(itemSel);
  const n = await items.count();
  expect(n).toBeGreaterThan(3);
  const body = await dlg.locator('.sheet-body').boundingBox();
  for (let i = 0; i < n; i++) {
    const it = items.nth(i);
    await it.scrollIntoViewIfNeeded();
    const b = await it.boundingBox();
    expect(b.y, 'пункт ' + i + ' сверху виден').toBeGreaterThanOrEqual(body.y - 0.5);
    expect(b.y + b.height, 'пункт ' + i + ' снизу виден').toBeLessThanOrEqual(Math.min(vh, body.y + body.height) + 0.5);
  }
  return items;
}

for (const height of [560, 640, 700, 760, 800]) {
  test(`меню и настройки на экране 380×${height}: лист не выходит за край, все пункты достижимы`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 380, height } });
    const page = await ctx.newPage();
    await start(page);
    await page.getByRole('button', { name: 'Меню' }).click();
    const items = await fitsAndScrolls(page, 'Меню', '.choice');
    // последний пункт реально нажимается
    await items.last().click();
    await fitsAndScrolls(page, 'Настройки', '.line-btn');
    await ctx.close();
  });
}

test('лист учитывает safe-area снизу: отступ внутри прокрутки', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Меню' }).click();
  const css = await page.locator('.sheet-body').first().evaluate((el) => {
    const s = getComputedStyle(el);
    const p = getComputedStyle(el.parentNode);
    return { overflowY: s.overflowY, minHeight: s.minHeight, maxHeight: p.maxHeight };
  });
  expect(css.overflowY).toBe('auto');
  expect(css.minHeight).toBe('0px');
  expect(parseFloat(css.maxHeight)).toBeLessThanOrEqual(800);
  const src = readFileSync(new URL('../docs/css/app.css', import.meta.url), 'utf8');
  expect(src).toMatch(/\.sheet-body \{[^}]*env\(safe-area-inset-bottom/);
});

// ——— .ics ———
test('.ics корректен: только CRLF, порядок блоков, UID/PRODID/DTSTAMP/DTSTART/DTEND, строки ≤ 75 байт', () => {
  const now = new Date('2026-09-24T06:00:00Z');
  const cases = [
    [{ id: 'a1', text: 'Совет; очень, очень длинное название события с кириллицей '.repeat(3), date: '2026-09-25', time: '10:00', note: 'строка 1\nстрока 2' }, { kind: 'time' }],
    [{ id: 'a2', text: 'точка', date: '2026-09-25', time: '10:00' }, { kind: 'time' }],
    [{ id: 'a3', text: 'весь день', date: '2026-09-25' }, { kind: 'day' }],
    [{ id: 'a4', text: 'срок', deadline: '2026-09-30' }, { kind: 'deadline' }],
    [{ id: 'a5', text: 'тайна', date: '2026-09-25', time: '18:00', dur: 50 }, { kind: 'time', private: true }],
  ];
  for (const [t, o] of cases) {
    const ics = buildIcs(t, { ...o, now });
    expect(checkIcs(ics), t.id).toEqual([]);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.indexOf('BEGIN:VEVENT')).toBeLessThan(lines.indexOf('END:VEVENT'));
    expect(lines.indexOf('END:VEVENT')).toBeLessThan(lines.indexOf('END:VCALENDAR'));
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
  }
  // точка во времени уходит в календарь на 30 минут — с DTEND
  const p = buildIcs(cases[1][0], { kind: 'time', now });
  expect(p).toContain('DTEND:');
  // ; и , экранируются
  expect(buildIcs(cases[0][0], { kind: 'time', now }).replace(/\r\n /g, '')).toContain('SUMMARY:Совет\\; очень\\, очень');
  // проверка ловит поломки
  expect(checkIcs('BEGIN:VCALENDAR\nEND:VCALENDAR\n')).toContain('переводы строк не CRLF');
  expect(checkIcs(p.replace(/DTEND:[^\r]*\r\n/, ''))).toContain('нет DTEND или неверный формат');
  expect(checkIcs(p.replace(/UID:[^\r]*\r\n/, ''))).toContain('нет UID');
});

// ——— диагностика ———
const openDiag = async (page) => {
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: /Диагностика календаря/ }).click();
  return page.getByRole('dialog', { name: 'Диагностика календаря' });
};
const blobSpy = () => {
  window.__blobTypes = [];
  window.__anchors = [];
  const B = window.Blob;
  window.Blob = class extends B { constructor(parts, opts) { super(parts, opts); window.__blobTypes.push(opts && opts.type); } };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    window.__anchors.push({ href: this.href.slice(0, 5), target: this.target, download: this.hasAttribute('download') });
    return click.call(this);
  };
};

test('одна пробная попытка: экран показывает поддержку share/canShare, факт скачивания, ошибку, файл и историю', async ({ browser }, info) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(blobSpy);
  const page = await ctx.newPage();
  await start(page);
  const dlg = await openDiag(page);
  const pre = dlg.locator('pre.diag');
  await expect(pre).toContainText('Попыток ещё не было');
  await expect(pre).toContainText('Попытка скачивания: ещё не было');
  const link = dlg.getByRole('link', { name: 'Скачать пробный файл' });
  expect(await link.evaluate((a) => [a.href.slice(0, 5), a.getAttribute('download')])).toEqual(['blob:', 'proverka.ics']);
  const [dl] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(checkIcs(readFileSync(await dl.path(), 'utf8'))).toEqual([]);
  await expect(pre).toContainText(/Последняя попытка: 24\.09\.2026, 10:00:\d\d/);
  const text = await pre.innerText();
  // сохраняем то, что видно на экране, — для отчёта
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/diag-screen.txt', text);
  info.attach('diag-screen', { body: text, contentType: 'text/plain' });
  expect(text).toMatch(/^navigator\.share: (true|false)$/m);
  expect(text).toMatch(/^navigator\.canShare\(\{files:\[\.ics\]\}\): (true|false|недоступно)$/m);
  expect(text).toContain('Способ по умолчанию: скачивание по нажатию на ссылку <a href="blob:…" download>');
  expect(text).toMatch(/Попытка скачивания \(24\.09\.2026, 10:00:\d\d\): blob создан — да \(text\/calendar;charset=utf-8, \d+ байт\); нажатие на ссылку — да, настоящее \(isTrusted=true\)/);
  expect(text).toContain('Способ: скачивание по нажатию на ссылку');
  expect(text).toContain('Текст последней ошибки: ошибок не было');
  expect(text).toMatch(/Файл: proverka\.ics, \d+ байт, проверка \.ics: корректен/);
  expect(text).toContain('Тип Blob: text/calendar;charset=utf-8');
  expect(text).toMatch(/История \(последние 1\):\n1\. 24\.09\.2026, 10:00:\d\d — скачивание по нажатию на ссылку — без ошибки/);
  const types = await page.evaluate(() => window.__blobTypes);
  expect(types.length).toBeGreaterThan(0);
  for (const t of types) expect(t).toBe('text/calendar;charset=utf-8');
  // по умолчанию — никаких программных кликов
  expect(await page.evaluate(() => window.__anchors)).toEqual([]);
  await expect(dlg.getByText('Файл готов. Смахните шторку уведомлений сверху экрана → нажмите на уведомление о загруженном файле → выберите ваше приложение календаря')).toBeVisible();
  // без привязки к конкретному приложению календаря
  expect(await dlg.innerText()).not.toMatch(/Яндекс/);
  await expect(dlg.getByText(/выберите ваше приложение календаря/)).toBeVisible();
  await dlg.getByRole('button', { name: 'началась загрузка файла' }).click();
  await expect(pre).toContainText('На экране: началась загрузка файла');
  expect(page.url()).toBe('http://localhost:4173/');
  await ctx.close();
});

test('ручные способы остаются: «ссылка target=_blank» — <a href="blob:…" target="_blank"> без download', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(blobSpy);
  const page = await ctx.newPage();
  await start(page);
  const dlg = await openDiag(page);
  const popup = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
  const dl = ctx.waitForEvent('download', { timeout: 3000 }).catch(() => null);
  await dlg.getByRole('button', { name: 'ссылка <a href="blob:…" target="_blank">' }).click();
  await Promise.all([popup, dl]);
  expect(await page.evaluate(() => window.__anchors)).toEqual([{ href: 'blob:', target: '_blank', download: false }]);
  for (const t of await page.evaluate(() => window.__blobTypes)) expect(t).toBe('text/calendar;charset=utf-8');
  await expect(dlg.locator('pre.diag')).toContainText('Способ: ссылка <a href="blob:…" target="_blank">');
  for (const name of ['share с файлом', 'прямой переход по blob-ссылке', 'скачивание программным кликом']) await expect(dlg.getByRole('button', { name })).toBeVisible();
  await ctx.close();
});

test('ошибка «Поделиться» записывается полным текстом, без запасного автозапуска; история — 5 последних и переживает перезапуск', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async () => { throw new DOMException('Must be handling a user gesture to perform a share request.', 'NotAllowedError'); };
  });
  const page = await ctx.newPage();
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await start(page);
  const dlg = await openDiag(page);
  const pre = dlg.locator('pre.diag');
  await dlg.getByRole('button', { name: 'share с файлом' }).click();
  await expect(pre).toContainText('Текст последней ошибки: NotAllowedError: Must be handling a user gesture to perform a share request.');
  await expect(pre).toContainText('Шаги: share с файлом — ошибка: NotAllowedError: Must be handling a user gesture to perform a share request.');
  await expect(pre).toContainText('navigator.share: true');
  await expect(pre).toContainText('navigator.canShare({files:[.ics]}): true');
  await page.waitForTimeout(300);
  expect(downloads).toBe(0);
  const link = () => dlg.getByRole('link', { name: /Скачать пробный файл/ });
  for (let i = 0; i < 4; i++) {
    await Promise.all([page.waitForEvent('download'), link().click()]);
    await expect(pre).toContainText('История (последние ' + (i + 2) + ')');
  }
  await expect(pre).toContainText(/Текст последней ошибки: в этой попытке нет; ранее \(24\.09\.2026, 10:00:\d\d\): NotAllowedError: Must be handling a user gesture/);
  // шестая попытка вытесняет самую старую — хранится ровно 5
  await Promise.all([page.waitForEvent('download'), link().click()]);
  await expect(pre).toContainText('Текст последней ошибки: ошибок не было');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('planner.calendarDiag')));
  expect(saved).toHaveLength(5);
  for (const e of saved) expect(new Date(e.at).toISOString()).toBe(e.at);
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  const dlg2 = await openDiag(page);
  await expect(dlg2.locator('pre.diag')).toContainText('История (последние 5):');
  await dlg2.getByRole('button', { name: 'Очистить историю' }).click();
  await expect(dlg2.locator('pre.diag')).toContainText('Попыток ещё не было');
  await ctx.close();
});

test('нажатие «В календарь» после сохранения задачи тоже попадает в диагностику', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await start(page);
  await add(page, 'встреча завтра в 15');
  await Promise.all([page.waitForEvent('download'), page.locator('.toast').getByRole('link', { name: 'В календарь' }).click()]);
  await page.getByRole('dialog', { name: 'Календарь' }).getByRole('button', { name: 'Готово' }).click();
  const dlg = await openDiag(page);
  const pre = dlg.locator('pre.diag');
  await expect(pre).toContainText('Шаги: скачивание по нажатию на ссылку — без ошибки');
  await expect(pre).toContainText(/Файл: sobytie-2026-09-25\.ics, \d+ байт, проверка \.ics: корректен/);
  await expect(pre).toContainText(/нажатие на ссылку — да, настоящее/);
  await ctx.close();
});
