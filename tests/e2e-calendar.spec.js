// Общий календарь через .ics и свободное имя клиента в «Записать сессию».
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { start, add, dump } from './helpers.js';

const st = (page, fn, arg) => page.evaluate(`(async () => { const st = await import(location.origin + '/js/store.js'); const r = await (${fn.toString()})(st, ${JSON.stringify(arg ?? null)}); await st.flush(); return r; })()`);
const noShare = () => { navigator.canShare = () => false; };

test('задача со временем: сразу после сохранения — .ics и подсказка «Откройте в Яндекс.Календаре»', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(noShare);
  const page = await ctx.newPage();
  await start(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), add(page, 'забрать детей из школы завтра в 13:30')]);
  const ics = readFileSync(await dl.path(), 'utf8');
  expect(ics).toContain('SUMMARY:Забрать детей из школы');
  expect(ics).toMatch(/DTSTART:20260925T093000Z/);
  await expect(page.locator('.toast')).toContainText('Откройте в Яндекс.Календаре');
  await ctx.close();
});

test('через системный выбор приложения, если браузер умеет делиться файлом', async ({ page }) => {
  await page.addInitScript(() => {
    window.__files = [];
    navigator.canShare = (d) => !!(d && d.files);
    navigator.share = async (d) => { window.__files.push(await d.files[0].text()); };
  });
  await start(page);
  await add(page, 'совет в семинарии завтра с 10 до 12');
  await page.waitForFunction(() => window.__files.length > 0);
  const ics = await page.evaluate(() => window.__files[0]);
  expect(ics).toContain('SUMMARY:Совет в семинарии');
  expect(ics).toMatch(/DTSTART:20260925T060000Z/);
  expect(ics).toMatch(/DTEND:20260925T080000Z/);
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
  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'В календарь', exact: true }).click()]);
  expect(readFileSync(await dl.path(), 'utf8')).toContain('SUMMARY:Встреча');
  await ctx.close();
});

// ——— имя клиента ———
async function sessionLink(browser, client) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { window.__shared = []; navigator.share = async (d) => { window.__shared.push(d); }; navigator.canShare = () => false; });
  const w = await ctx.newPage();
  await start(w, { name: 'Мария' });
  await st(w, (st) => st.setSettings({ contacts: [{ id: 'c', name: 'Иоанн', areaId: null, iRecord: true }] }));
  await w.getByRole('button', { name: 'Записать сессию' }).click();
  await expect(w.getByLabel('Клиент')).toHaveAttribute('placeholder', 'Как вы его называете: имя, фамилия');
  await w.getByLabel('Клиент').fill(client);
  await w.getByRole('button', { name: 'вс 27', exact: true }).click();
  await w.getByRole('button', { name: 'Время начала' }).click();
  await w.getByRole('button', { name: '11:00', exact: true }).click();
  await w.getByRole('button', { name: 'Сохранить' }).click();
  await w.getByRole('button', { name: 'Отправить Иоанн' }).click();
  await w.waitForFunction(() => window.__shared.length > 0);
  const text = await w.evaluate(() => window.__shared[0].text);
  await ctx.close();
  return text.match(/https?:\/\/\S+#t=v1\.\S+/)[0];
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
