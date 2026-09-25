// Общий календарь через .ics и свободное имя клиента в «Записать сессию».
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { start, add, dump } from './helpers.js';

const st = (page, fn, arg) => page.evaluate(`(async () => { const st = await import(location.origin + '/js/store.js'); const r = await (${fn.toString()})(st, ${JSON.stringify(arg ?? null)}); await st.flush(); return r; })()`);
const noShare = () => { navigator.canShare = () => false; };

const STEPS = 'После скачивания внизу экрана браузера появится плашка «Открыть» — нажмите её и выберите ваше приложение календаря';

// Шпион: программные клики по ссылкам и вызовы «Поделиться» — по умолчанию их быть не должно.
const spy = () => {
  window.__progClicks = 0;
  window.__shared = 0;
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { window.__progClicks++; return click.call(this); };
  navigator.canShare = () => true;
  navigator.share = async () => { window.__shared++; };
};
const calCtx = async (browser) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(spy);
  const page = await ctx.newPage();
  let downloads = 0;
  page.on('download', () => { downloads++; });
  return { ctx, page, downloads: () => downloads };
};

test('после сохранения задачи со временем ничего не скачивается само: в тосте — настоящая ссылка «В календарь»', async ({ browser }) => {
  const { ctx, page, downloads } = await calCtx(browser);
  await start(page);
  await add(page, 'совет в семинарии завтра с 10 до 12');
  const link = page.locator('.toast').getByRole('link', { name: 'В календарь' });
  await expect(link).toBeVisible();
  expect(await link.getAttribute('href')).toMatch(/^blob:/);
  expect(await link.getAttribute('download')).toBe('sobytie-2026-09-25.ics');
  await page.waitForTimeout(500);
  expect(downloads()).toBe(0);
  // человек нажимает ссылку сам — обычная загрузка
  const [dl] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(dl.suggestedFilename()).toBe('sobytie-2026-09-25.ics');
  const ics = readFileSync(await dl.path(), 'utf8');
  expect(ics).toContain('SUMMARY:Совет в семинарии');
  expect(ics).toMatch(/DTSTART:20260925T060000Z/);
  expect(ics).toMatch(/DTEND:20260925T080000Z/);
  // сразу — заметный блок с шагами
  const dlg = page.getByRole('dialog', { name: 'Календарь' });
  await expect(dlg.getByText(STEPS)).toBeVisible();
  await expect(dlg.getByRole('link', { name: 'Скачать файл ещё раз' })).toBeVisible();
  expect(await dlg.innerText()).not.toMatch(/Яндекс|шторк|Загрузк|уведомлени/);
  expect(await page.evaluate(() => [window.__progClicks, window.__shared])).toEqual([0, 0]);
  const last = await page.evaluate(() => JSON.parse(localStorage.getItem('planner.calendarDiag'))[0]);
  expect(last).toMatchObject({ method: 'download', blobCreated: true, clicked: true, trusted: true, blobType: 'text/calendar;charset=utf-8', ics: 'ok', source: 'toast' });
  await ctx.close();
});

test('карточка задачи: «Добавить в календарь» — видимая ссылка <a href="blob:…" download>, после нажатия — шаги', async ({ browser }) => {
  const { ctx, page } = await calCtx(browser);
  await start(page);
  await add(page, 'пары в семинарии завтра');
  const id = (await dump(page)).data.tasks[0].id;
  await page.evaluate(async (id) => { (await import(location.origin + '/js/views/task.js')).openTask(id); }, id);
  const link = page.getByRole('link', { name: 'Добавить в календарь' });
  await expect(link).toBeVisible();
  expect(await link.evaluate((a) => [a.href.slice(0, 5), a.getAttribute('download'), a.target])).toEqual(['blob:', 'sobytie-2026-09-25.ics', '']);
  // подсказка видна сразу под кнопкой; инструкций про шторку и «Загрузки» нет
  const box = page.locator('.cal-box');
  await expect(box.locator('p.cal-hint', { hasText: STEPS })).toBeVisible();
  await expect(box.locator('.cal-steps')).toHaveCount(0);
  expect(await box.innerText()).not.toMatch(/шторк|Загрузк|уведомлени/);
  const [dl] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(dl.suggestedFilename()).toBe('sobytie-2026-09-25.ics');
  // после нажатия — та же подсказка, заметным блоком под кнопкой
  await expect(box.locator('.cal-steps', { hasText: STEPS })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Скачать файл ещё раз' })).toBeVisible();
  expect(await box.evaluate((el) => el.querySelector('.cal-link').compareDocumentPosition(el.querySelector('.cal-steps')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  expect(await page.evaluate(() => [window.__progClicks, window.__shared])).toEqual([0, 0]);
  await ctx.close();
});

test('телефон (касание, мобильный Chrome): загрузка по касанию ссылки', async ({ browser }) => {
  const ctx = await browser.newContext({
    acceptDownloads: true, isMobile: true, hasTouch: true, viewport: { width: 380, height: 780 },
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  });
  await ctx.addInitScript(spy);
  const page = await ctx.newPage();
  await start(page);
  await add(page, 'встреча завтра в 15');
  const link = page.locator('.toast').getByRole('link', { name: 'В календарь' });
  const [dl] = await Promise.all([page.waitForEvent('download'), link.tap()]);
  expect(readFileSync(await dl.path(), 'utf8')).toContain('SUMMARY:Встреча');
  await expect(page.getByText(STEPS)).toBeVisible();
  await ctx.close();
});

test('под кнопкой — напоминание проверить, что событие в общем, а не в личном календаре', async ({ page }) => {
  await start(page);
  await add(page, 'пары в семинарии завтра');
  const id = (await dump(page)).data.tasks[0].id;
  await page.evaluate(async (id) => { (await import(location.origin + '/js/views/task.js')).openTask(id); }, id);
  await expect(page.getByText('Если календарь не предложат выбрать — после открытия проверьте, что событие создано в общем календаре, а не в личном; при необходимости перенесите его в общий календарь вручную в вашем приложении календаря')).toBeVisible();
});

test('закрытая область: в общий календарь — только «Встреча»', async ({ browser }) => {
  const { ctx, page } = await calCtx(browser);
  await start(page);
  await add(page, '#консультирование разговор с Анной о разводе завтра в 18');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.toast').getByRole('link', { name: 'В календарь' }).click()]);
  expect(dl.suggestedFilename()).toBe('vstrecha-2026-09-25.ics');
  const ics = readFileSync(await dl.path(), 'utf8');
  expect(ics).toContain('SUMMARY:Встреча');
  expect(ics).not.toContain('Анн');
  expect(ics).not.toContain('развод');
  await expect(page.getByRole('dialog', { name: 'Календарь' })).not.toContainText('Анн');
  await ctx.close();
});

test('без времени — календарь в тосте не предлагается; переключатель выключает предложение', async ({ browser }) => {
  const { ctx, page, downloads } = await calCtx(browser);
  await start(page);
  await add(page, 'купить свечи завтра');
  await expect(page.locator('.toast')).toContainText('Добавлено');
  await expect(page.locator('.toast').getByRole('link')).toHaveCount(0);
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('button', { name: 'Настройки' }).click();
  const sw = page.getByRole('switch', { name: /Автоматически предлагать календарь/ });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await add(page, 'встреча завтра в 15');
  await expect(page.locator('.toast')).toContainText('Добавлено');
  await expect(page.locator('.toast').getByRole('link')).toHaveCount(0);
  expect(downloads()).toBe(0);
  // вручную — по-прежнему из карточки задачи
  const id = (await dump(page)).data.tasks.find((t) => t.time).id;
  await page.evaluate(async (id) => { (await import(location.origin + '/js/views/task.js')).openTask(id); }, id);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Добавить в календарь' }).click()]);
  expect(readFileSync(await dl.path(), 'utf8')).toContain('SUMMARY:Встреча');
  await expect(page.getByText(STEPS)).toBeVisible();
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

test('«Записать сессию»: после сохранения единственное действие — «Добавить в календарь»', async ({ browser }) => {
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
  const [dl] = await Promise.all([w.waitForEvent('download'), dlg.getByRole('link', { name: 'Добавить в календарь' }).click()]);
  const ics = readFileSync(await dl.path(), 'utf8');
  expect(ics).toContain('SUMMARY:Сессия · А.К.');
  expect(ics).not.toContain('Кузнецова');
  expect(ics).toMatch(/DTSTART:20260927T070000Z/);
  expect(ics).toMatch(/DTEND:20260927T080000Z/);
  await expect(dlg.getByText(STEPS)).toBeVisible();
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
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Добавить в календарь' }).click()]);
  const ics = readFileSync(await dl.path(), 'utf8');
  expect(ics).toContain('DTSTART;VALUE=DATE:20261012');
  expect(ics).toContain('DTEND;VALUE=DATE:20261013');
  expect(errors).toEqual([]);
  await ctx.close();
});
