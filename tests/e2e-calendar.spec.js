// Общий календарь через .ics и свободное имя клиента в «Записать сессию».
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { start, add, dump } from './helpers.js';

const st = (page, fn, arg) => page.evaluate(`(async () => { const st = await import(location.origin + '/js/store.js'); const r = await (${fn.toString()})(st, ${JSON.stringify(arg ?? null)}); await st.flush(); return r; })()`);
const noShare = () => { navigator.canShare = () => false; };

// Шпион: скачивание через <a download> и вызовы «Поделиться».
const spy = (shareMode) => {
  window.__anchorDownloads = 0;
  window.__shared = [];
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) window.__anchorDownloads++; return click.call(this); };
  if (shareMode === 'none') { navigator.canShare = () => false; return; }
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    const f = d.files[0];
    window.__shared.push({ name: f.name, type: f.type, text: await f.text(), title: d.title });
    if (shareMode === 'abort') throw new DOMException('dismissed', 'AbortError');
    if (shareMode === 'deny') throw new DOMException('no gesture', 'NotAllowedError');
  };
};

test('1) есть «Поделиться» с файлом: сразу системное окно, без скачивания', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(spy, 'ok');
  const page = await ctx.newPage();
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await start(page);
  await add(page, 'совет в семинарии завтра с 10 до 12');
  await page.waitForFunction(() => window.__shared.length > 0);
  const sh = await page.evaluate(() => window.__shared[0]);
  expect(sh.name).toMatch(/\.ics$/);
  expect(sh.type).toBe('text/calendar');
  expect(sh.text).toContain('SUMMARY:Совет в семинарии');
  expect(sh.text).toMatch(/DTSTART:20260925T060000Z/);
  expect(sh.text).toMatch(/DTEND:20260925T080000Z/);
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);
  expect(await page.evaluate(() => window.__anchorDownloads)).toBe(0);
  await ctx.close();
});

test('2) «Поделиться» файлом нельзя: файл открывается во вкладке (blob без download), приложение остаётся', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(spy, 'none');
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await start(page);
  // Chromium не показывает text/calendar во вкладке и сам превращает это в загрузку — ловим её
  const [dl] = await Promise.all([page.waitForEvent('download'), add(page, 'забрать детей из школы завтра в 13:30')]);
  const ics = readFileSync(await dl.path(), 'utf8');
  expect(ics).toContain('SUMMARY:Забрать детей из школы');
  expect(ics).toMatch(/DTSTART:20260925T093000Z/);
  expect(await page.evaluate(() => window.__anchorDownloads)).toBe(0);
  expect(logs.some((l) => /^\[календарь\] share с файлом: пропущен — .+ → прямой переход по blob-ссылке: без ошибки$/.test(l))).toBe(true);
  const last = await page.evaluate(() => JSON.parse(localStorage.getItem('planner.calendarDiag'))[0]);
  expect(last.method).toBe('nav');
  expect(last.blobType).toBe('text/calendar;charset=utf-8');
  expect(page.url()).toBe('http://localhost:4173/');
  await expect(page.locator('#view')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Если вместо календаря началась загрузка: откройте Загрузки → нажмите на файл → выберите Яндекс.Календарь.');
  await ctx.close();
});

test('«Поделиться» упало с ошибкой — тоже открываем во вкладке; закрыли окно сами — больше ничего не открываем', async ({ browser }) => {
  for (const [mode, expectDl] of [['deny', true], ['abort', false]]) {
    const ctx = await browser.newContext({ acceptDownloads: true });
    await ctx.addInitScript(spy, mode);
    const page = await ctx.newPage();
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await start(page);
    await add(page, 'встреча завтра в 15');
    await page.waitForFunction(() => window.__shared.length > 0);
    await page.waitForTimeout(800);
    expect(downloads > 0, mode).toBe(expectDl);
    expect(await page.evaluate(() => window.__anchorDownloads), mode).toBe(0);
    await ctx.close();
  }
});

test('3) резерв «скачивание» из настроек: обычная загрузка и точная подсказка', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(spy, 'ok');
  const page = await ctx.newPage();
  await start(page);
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: /Как передавать в календарь/ }).click();
  await page.getByRole('button', { name: 'скачивание', exact: true }).click();
  await page.keyboard.press('Escape');
  await add(page, 'пары в семинарии завтра');
  const id = (await dump(page)).data.tasks[0].id;
  await page.evaluate(async (id) => { (await import(location.origin + '/js/views/task.js')).openTask(id); }, id);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Добавить в Яндекс.Календарь' }).click()]);
  expect(dl.suggestedFilename()).toBe('sobytie-2026-09-25.ics');
  const hint = page.getByText('Файл скачан в Загрузки. Откройте Загрузки → нажмите на файл → выберите Яндекс.Календарь');
  await expect(hint).toBeVisible();
  expect(await hint.innerText()).not.toMatch(/сейчас/i);
  expect(await page.evaluate(() => window.__shared.length)).toBe(0);
  expect(await page.evaluate(() => window.__anchorDownloads)).toBe(1);
  await ctx.close();
});

test('под кнопкой — напоминание проверить, что событие в общем, а не в личном календаре', async ({ page }) => {
  await start(page);
  await add(page, 'пары в семинарии завтра');
  const id = (await dump(page)).data.tasks[0].id;
  await page.evaluate(async (id) => { (await import(location.origin + '/js/views/task.js')).openTask(id); }, id);
  await expect(page.getByText('Если календарь не предложат выбрать — после открытия проверьте, что событие создано в общем календаре, а не в личном; при необходимости переместите его в Яндекс.Календаре вручную (долгое нажатие на событие → Переместить в календарь)')).toBeVisible();
});

test('закрытая область: в общий календарь — только «Встреча»', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(noShare);
  const page = await ctx.newPage();
  await start(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), add(page, '#консультирование разговор с Анной о разводе завтра в 18')]);
  const ics = readFileSync(await dl.path(), 'utf8');
  expect(ics).toContain('SUMMARY:Встреча');
  expect(ics).not.toContain('Анн');
  expect(ics).not.toContain('развод');
  await ctx.close();
});

test('без времени — календарь не предлагается; переключатель выключает предложение', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(noShare);
  const page = await ctx.newPage();
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await start(page);
  await add(page, 'купить свечи завтра');
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('button', { name: 'Настройки' }).click();
  const sw = page.getByRole('switch', { name: /Автоматически предлагать календарь/ });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await add(page, 'встреча завтра в 15');
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);
  // вручную — по-прежнему из карточки задачи
  const id = (await dump(page)).data.tasks.find((t) => t.time).id;
  await page.evaluate(async (id) => { (await import(location.origin + '/js/views/task.js')).openTask(id); }, id);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Добавить в Яндекс.Календарь' }).click()]);
  expect(readFileSync(await dl.path(), 'utf8')).toContain('SUMMARY:Встреча');
  await expect(page.getByText('Если вместо календаря началась загрузка: откройте Загрузки → нажмите на файл → выберите Яндекс.Календарь.')).toBeVisible();
  await ctx.close();
});

// ——— имя клиента ———
async function sessionLink(browser, client) {
  const ctx = await browser.newContext();
  const w = await ctx.newPage();
  await w.goto('/manifest.json');
  const code = await w.evaluate(async (client) => (await import(location.origin + '/js/share.js')).encodeSession(
    { id: 'sl' + Math.random().toString(36).slice(2, 8), client, start: { date: '2026-09-27', time: '11:00' } }, 'Мария'), client);
  await ctx.close();
  return 'http://localhost:4173/#t=' + code;
}

async function me(browser, people = []) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(noShare);
  const page = await ctx.newPage();
  await start(page, { name: 'Иоанн' });
  await st(page, (st, people) => {
    st.setSettings({ contacts: [{ id: 'w', name: 'Мария', areaId: null, recordsForMe: true }] });
    const tpl = st.templatesList().find((t) => t.name === 'Сессия');
    st.change(() => { for (const p of people) st.put('people', st.newPerson({ ...p, areaId: tpl.areaId, templateId: tpl.id })); });
  }, people);
  return page;
}

test('новое имя: предложение создать человека, код придумываю сам; в следующий раз — узнаёт сразу', async ({ browser }) => {
  const link = await sessionLink(browser, 'Анна Кузнецова');
  const page = await me(browser);
  await page.goto(link);
  await page.waitForFunction(() => window.__ready === true);
  const dlg = page.getByRole('dialog', { name: 'Запись сессии' });
  await dlg.getByRole('button', { name: 'Показать клиента' }).click();
  await expect(dlg).toContainText('Анна Кузнецова · новый');
  await dlg.getByRole('button', { name: 'Добавить в план' }).click();
  const code = page.getByRole('textbox', { name: 'Новый клиент' });
  await expect(code).toHaveValue('А.К.');
  await code.fill('К-1');
  await page.getByRole('button', { name: 'Создать' }).click();
  await expect(page.locator('.toast')).toContainText('В плане');
  let d = await dump(page);
  const p = d.data.people[0];
  expect(p.code).toBe('К-1');
  expect(d.data.areas.find((a) => a.id === p.areaId).private).toBe(true);
  // имени в открытом виде у меня нет
  expect(JSON.stringify(d)).not.toContain('Кузнецова');
  // вторая запись с тем же именем — сразу к этому человеку
  const link2 = await sessionLink(browser, 'анна  кузнецова');
  await page.goto(link2);
  await page.waitForFunction(() => window.__ready === true);
  const dlg2 = page.getByRole('dialog', { name: 'Запись сессии' });
  await dlg2.getByRole('button', { name: 'Показать клиента' }).click();
  await expect(dlg2).toContainText('К-1, сессия №2');
  await dlg2.getByRole('button', { name: 'Добавить в план' }).click();
  await page.getByRole('button', { name: 'Добавить всё равно' }).click().catch(() => {});
  await expect(page.locator('.toast')).toContainText('В плане');
  d = await dump(page);
  expect(d.data.people.length).toBe(1);
  expect(d.data.people[0].counter).toBe(2);
});

test('похожее имя: короткий выбор «Это … или …, или новый человек?»', async ({ browser }) => {
  const link = await sessionLink(browser, 'Анна Кузнецова');
  const page = await me(browser, [{ code: 'А.К.', counter: 5 }, { code: 'Анна Л.', counter: 1 }, { code: 'Б.В.' }]);
  await page.goto(link);
  await page.waitForFunction(() => window.__ready === true);
  const dlg = page.getByRole('dialog', { name: 'Запись сессии' });
  await dlg.getByRole('button', { name: 'Показать клиента' }).click();
  await expect(dlg).toContainText('похоже на: А.К., Анна Л.');
  await dlg.getByRole('button', { name: 'Добавить в план' }).click();
  await expect(page.getByText('Имя «Анна Кузнецова» похоже на «А.К.» или «Анна Л.».')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Новый человек' })).toBeVisible();
  await page.getByRole('button', { name: /Это А\.К\./ }).click();
  const d = await dump(page);
  const ak = d.data.people.find((p) => p.code === 'А.К.');
  expect(ak.counter).toBe(6);
  expect(ak.aliases.length).toBe(1);
  expect(d.data.groups[0].title).toBe('Сессия · А.К. · №6');
});

test('точное совпадение с существующим человеком — автоматическая привязка', async ({ browser }) => {
  const link = await sessionLink(browser, 'Ольга');
  const page = await me(browser, [{ code: 'Ольга', counter: 2 }, { code: 'Ольга П.' }]);
  await page.goto(link);
  await page.waitForFunction(() => window.__ready === true);
  await page.getByRole('dialog', { name: 'Запись сессии' }).getByRole('button', { name: 'Добавить в план' }).click();
  await expect(page.locator('.toast')).toContainText('В плане');
  await expect(page.getByText('Кто это?')).toHaveCount(0);
  const d = await dump(page);
  expect(d.data.people.find((p) => p.code === 'Ольга').counter).toBe(3);
});

test('«Записать сессию»: после сохранения единственное действие — «Добавить в Яндекс.Календарь»', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(() => { window.__shares = 0; navigator.share = async () => { window.__shares++; }; navigator.canShare = () => false; });
  const w = await ctx.newPage();
  await start(w, { name: 'Мария' });
  await st(w, (st) => st.setSettings({ contacts: [{ id: 'c', name: 'Иоанн', areaId: null, iRecord: true }] }));
  await w.getByRole('button', { name: 'Записать сессию' }).click();
  await w.getByLabel('Клиент').fill('Анна Кузнецова');
  await w.getByRole('button', { name: 'вс 27', exact: true }).click();
  await w.getByRole('button', { name: 'Время начала' }).click();
  await w.getByRole('button', { name: '11:00', exact: true }).click();
  await w.getByRole('button', { name: 'Указать' }).click();
  await w.getByRole('button', { name: 'Время окончания' }).click();
  await w.getByRole('button', { name: '12:00', exact: true }).click();
  await w.getByRole('button', { name: 'Сохранить' }).click();
  await expect(w.getByRole('heading', { name: 'Записано' })).toBeVisible();
  const dlg = w.getByRole('dialog', { name: 'Записать сессию' });
  await expect(dlg.getByRole('button', { name: /Отправить/ })).toHaveCount(0);
  await expect(dlg.getByRole('button', { name: /Записать ещё/ })).toHaveCount(0);
  const [dl] = await Promise.all([w.waitForEvent('download'), dlg.getByRole('button', { name: 'Добавить в Яндекс.Календарь' }).click()]);
  const ics = readFileSync(await dl.path(), 'utf8');
  expect(ics).toContain('SUMMARY:Сессия · А.К.');
  expect(ics).not.toContain('Кузнецова');
  expect(ics).toMatch(/DTSTART:20260927T070000Z/);
  expect(ics).toMatch(/DTEND:20260927T080000Z/);
  await expect(dlg.getByText('Если вместо календаря началась загрузка: откройте Загрузки → нажмите на файл → выберите Яндекс.Календарь.')).toBeVisible();
  await expect(dlg.getByText(/проверьте, что событие создано в общем календаре, а не в личном/)).toBeVisible();
  expect(await w.evaluate(() => window.__shares)).toBe(0);
  await ctx.close();
});

test('задача на день без времени — событие на весь день; кнопка видна всегда', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await start(page);
  await add(page, 'именины тёщи 12 октября');
  const id = (await dump(page)).data.tasks[0].id;
  await page.evaluate(async (id) => { (await import(location.origin + '/js/views/task.js')).openTask(id); }, id);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Добавить в Яндекс.Календарь' }).click()]);
  const ics = readFileSync(await dl.path(), 'utf8');
  expect(ics).toContain('DTSTART;VALUE=DATE:20261012');
  expect(ics).toContain('DTEND;VALUE=DATE:20261013');
  expect(errors).toEqual([]);
  await ctx.close();
});
