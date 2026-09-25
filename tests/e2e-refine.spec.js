// Уточнения: время как начало, многодневные блоки, приватность наружу, скрытие входящих, запись сессии.
import { test, expect } from '@playwright/test';
import { start, add, tab, dump } from './helpers.js';

const capture = () => { window.__shared = []; navigator.share = async (d) => { window.__shared.push(d); }; navigator.canShare = () => false; };
const st = (page, fn, arg) => page.evaluate(`(async () => { const st = await import(location.origin + '/js/store.js'); const r = await (${fn.toString()})(st, ${JSON.stringify(arg ?? null)}); await st.flush(); return r; })()`);

test('многодневный блок «пн 16:00 → вт 16:00» из настроек уменьшает ёмкость обоих дней', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: /Постоянные блоки недели/ }).click();
  await page.getByRole('button', { name: 'Блок', exact: true }).click();
  await page.getByRole('textbox', { name: 'Что это' }).fill('Дежурство в семинарии');
  await page.getByRole('textbox', { name: 'Что это' }).press('Enter');
  await page.getByRole('button', { name: 'Семинария и школы' }).click();
  await page.getByRole('button', { name: 'пн', exact: true }).click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: '16:00', exact: true }).click();
  await page.getByRole('button', { name: /На следующий день/ }).click();
  await page.getByRole('button', { name: '16:00', exact: true }).click();
  await expect(page.getByText('пн 16:00 → вт 16:00')).toBeVisible();
  const r = await st(page, (st) => [
    st.blocksOn('2026-09-28').map((b) => [b.start, b.end, b.min]),
    st.blocksOn('2026-09-29').map((b) => [b.start, b.end, b.min]),
    st.loadOf('2026-09-28').min, st.loadOf('2026-09-29').min, st.loadOf('2026-09-30').min,
    st.freeWindows('2026-09-28', '07:00', '22:00').map((w) => [w.start, w.end]),
  ]);
  expect(r[0]).toEqual([['16:00', '24:00', 480]]);
  expect(r[1]).toEqual([['00:00', '16:00', 960]]);
  expect([r[2], r[3], r[4]]).toEqual([480, 960, 0]);
  expect(r[5]).toEqual([['07:00', '16:00']]);
  // на ленте вторника — своя часть блока
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await tab(page, 'План');
  await page.getByRole('button', { name: 'День', exact: true }).click();
  await page.getByRole('button', { name: 'Вперёд' }).click();
  await page.getByRole('button', { name: 'Вперёд' }).click();
  await page.getByRole('button', { name: 'Вперёд' }).click();
  await page.getByRole('button', { name: 'Вперёд' }).click();
  await page.getByRole('button', { name: 'Вперёд' }).click();
  await expect(page.locator('.daynav')).toContainText('Вторник, 29 сентября');
  await expect(page.locator('.tl-item.block')).toContainText('Дежурство в семинарии — до 16:00');
  await expect(page.locator('#view')).toContainText('Занято 16 ч');
});

test('блок без окончания — длительность области по умолчанию и не занимает остаток дня', async ({ page }) => {
  await start(page);
  const r = await st(page, (st) => {
    const a = st.areasList().find((x) => x.name === 'Собор и богослужения');
    st.change(() => st.setMeta('blocks', [{ id: 'b', title: 'Молебен', areaId: a.id, dow: 4, start: '09:00' }]));
    const before = st.loadOf('2026-09-24').min;
    st.saveArea({ ...a, blockDur: 120 });
    return [before, st.loadOf('2026-09-24').min, st.blocksOn('2026-09-24')[0].end];
  });
  expect(r).toEqual([60, 120, '11:00']);
});

test('время задачи — начало: без окончания это точка на ленте, окна не занимает', async ({ page }) => {
  await start(page);
  await add(page, 'позвонить декану сегодня в 14:00');
  await add(page, 'совещание сегодня с 15 до 17');
  const w = await st(page, (st) => st.freeWindows('2026-09-24', '10:00', '22:00').map((x) => [x.start, x.end]));
  expect(w).toEqual([['10:00', '15:00'], ['17:00', '22:00']]);
  await tab(page, 'План');
  await page.getByRole('button', { name: 'День', exact: true }).click();
  await expect(page.locator('.tl-item.point', { hasText: 'Позвонить декану' })).toBeVisible();
  await expect(page.locator('.tl-item:not(.point)', { hasText: 'Совещание' })).toBeVisible();
  const h = await page.locator('.tl-item', { hasText: 'Совещание' }).evaluate((el) => el.offsetHeight);
  expect(h).toBeGreaterThan(120); // 2 часа
});

test('входящие от контакта с закрытой областью по умолчанию скрыты сразу', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await start(a, { name: 'Мария' });
  const code = await a.evaluate(async () => (await import(location.origin + '/js/share.js')).encodeTask({ id: 'x1', text: 'Клиентка просила перезвонить', date: '2026-09-25', dateKind: 'day' }, 'Мария'));
  const b = await (await browser.newContext()).newPage();
  await start(b, { name: 'Иоанн' });
  await st(b, (st) => { const p = st.areasList().find((x) => x.private); st.setSettings({ contacts: [{ id: 'c', name: 'Мария', areaId: p.id }] }); });
  await b.goto('/#t=' + code);
  await b.waitForFunction(() => window.__ready === true);
  await expect(b.locator('.toast')).toContainText('от Мария');
  await expect(b.locator('#view .row')).toHaveCount(1);
  await expect(b.locator('#view')).not.toContainText('Клиентка');
  await expect(b.locator('#view .row')).toContainText('•••');
  await ctxA.close();
});

test('«Скрыть» одним касанием переносит входящую задачу в закрытую область', async ({ page }) => {
  await start(page, { name: 'Иоанн' });
  const code = await page.evaluate(async () => (await import(location.origin + '/js/share.js')).encodeTask({ id: 'y1', text: 'Поговорить с А. о семье', date: null }, 'Жена'));
  await page.goto('/#t=' + code);
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.locator('#view')).toContainText('Поговорить с А. о семье');
  await page.locator('#view .row').getByRole('button', { name: 'Скрыть' }).click();
  await expect(page.locator('#view')).not.toContainText('Поговорить с А.');
  await expect(page.locator('#view .row')).toContainText('•••');
  const d = await dump(page);
  expect(d.data.areas.find((x) => x.id === d.data.tasks[0].areaId).private).toBe(true);
});

test('закрытая задача: заготовку не скопировать наружу', async ({ page }) => {
  await start(page);
  const id = await st(page, (st) => {
    const p = st.areasList().find((x) => x.private);
    const r = st.addTask({ text: 'Разбор сессии', areaId: p.id, draft: 'Промт с данными', date: st.T() });
    return r.result.id;
  });
  await page.evaluate(async (id) => { (await import(location.origin + '/js/views/common.js')).app.revealed.add(id); (await import(location.origin + '/js/views/task.js')).openTask(id); }, id);
  await expect(page.getByText('Из закрытой области заготовка не копируется наружу.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скопировать' })).toHaveCount(0);
});

test('голос в закрытой области: без распознавания на устройстве ничего не уходит', async ({ page }) => {
  await page.addInitScript(() => {
    window.__started = 0;
    class FakeSR { start() { window.__started++; } stop() {} }
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  });
  await start(page);
  await tab(page, 'Области');
  await page.locator('#view').getByRole('button', { name: /Консультирование/ }).click();
  await page.getByRole('button', { name: 'Голосом' }).click();
  await expect(page.getByText(/голос не уходит в интернет/)).toBeVisible();
  expect(await page.evaluate(() => window.__started)).toBe(0);
});

test('голос в закрытой области: распознавание на устройстве разрешено', async ({ page }) => {
  await page.addInitScript(() => {
    window.__local = null;
    class FakeSR {
      static async available(o) { return o.processLocally ? 'available' : 'unavailable'; }
      start() { window.__local = this.processLocally === true; setTimeout(() => { this.onresult({ results: [[{ transcript: 'перечитать записи сегодня' }]] }); this.onend(); }, 30); }
      stop() {}
    }
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  });
  await start(page);
  await tab(page, 'Области');
  await page.locator('#view').getByRole('button', { name: /Консультирование/ }).click();
  await page.getByRole('button', { name: 'Голосом' }).click();
  await expect(page.getByLabel('Новая задача')).toHaveValue('перечитать записи сегодня');
  expect(await page.evaluate(() => window.__local)).toBe(true);
});

test('настройка «Записывает мне сессии» доходит до приложения ассистента', async ({ browser }) => {
  const ctxA = await browser.newContext();
  await ctxA.addInitScript(capture);
  const a = await ctxA.newPage();
  await start(a, { name: 'Иоанн' });
  await st(a, (st) => st.setSettings({ contacts: [{ id: 'c1', name: 'Жена', areaId: null }] }));
  await a.getByRole('button', { name: 'Меню' }).click();
  await a.getByRole('button', { name: 'Настройки' }).click();
  await a.getByRole('button', { name: /Контакты для обмена/ }).click();
  await a.getByRole('switch', { name: 'Записывает мне сессии — Жена' }).click();
  await a.getByRole('button', { name: 'Отправить Жена' }).click();
  await a.waitForFunction(() => window.__shared.length > 0);
  const link = (await a.evaluate(() => window.__shared[0].text)).match(/https?:\/\/\S+#t=v1\.\S+/)[0];
  const b = await (await browser.newContext()).newPage();
  await start(b, { name: 'Мария' });
  await expect(b.getByRole('button', { name: 'Записать сессию' })).toHaveCount(0);
  await b.goto(link);
  await b.waitForFunction(() => window.__ready === true);
  await b.getByRole('button', { name: 'Включить «Записать сессию»' }).click();
  await expect(b.getByRole('button', { name: 'Записать сессию' })).toBeVisible();
  const d = await dump(b);
  expect(d.data.meta.settings.contacts).toEqual([expect.objectContaining({ name: 'Иоанн', iRecord: true })]);
  await ctxA.close();
});

async function recordSession(browser, { client, day, from, to }) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(capture);
  const w = await ctx.newPage();
  await start(w, { name: 'Мария' });
  await st(w, (st) => st.setSettings({ contacts: [{ id: 'c', name: 'Иоанн', areaId: null, iRecord: true }] }));
  await w.getByRole('button', { name: 'Записать сессию' }).click();
  await w.getByLabel('Клиент').fill(client);
  await w.getByRole('button', { name: day, exact: true }).click();
  await w.getByRole('button', { name: 'Время начала' }).click();
  await w.getByRole('button', { name: from, exact: true }).click();
  if (to) {
    await w.getByRole('button', { name: 'Указать' }).click();
    await w.getByRole('button', { name: 'Время окончания' }).click();
    await w.getByRole('button', { name: to, exact: true }).click();
  }
  await w.getByRole('button', { name: 'Сохранить' }).click();
  // сразу экран-подтверждение с одной крупной кнопкой
  await expect(w.getByRole('heading', { name: 'Записано' })).toBeVisible();
  await w.getByRole('button', { name: 'Отправить Иоанн' }).click();
  await w.waitForFunction(() => window.__shared.length > 0);
  const shared = await w.evaluate(() => window.__shared[0]);
  await ctx.close();
  return shared;
}

async function boss(browser) {
  const page = await (await browser.newContext()).newPage();
  await start(page, { name: 'Иоанн' });
  await st(page, (st) => {
    st.setSettings({ contacts: [{ id: 'w', name: 'Мария', areaId: null, recordsForMe: true }] });
    const tpl = st.templatesList().find((t) => t.name === 'Сессия');
    st.change(() => {
      st.put('people', st.newPerson({ code: 'А.К.', areaId: tpl.areaId, templateId: tpl.id, counter: 3 }));
      st.setMeta('blocks', [{ id: 'm', title: 'Молебен', areaId: null, dow: 1, start: '17:30', end: '18:30' }]);
    });
  });
  return page;
}

test('запись сессии: отдельный экран, наложение → «Изменить время» → в плане, минуя «Входящие»', async ({ browser }) => {
  const shared = await recordSession(browser, { client: 'А.К.', day: 'пн 28', from: '18:00', to: '19:00' });
  expect(shared.text).toContain('Мария: сессия А.К. — пн, 28 сентября, 18:00–19:00');
  const link = shared.text.match(/https?:\/\/\S+#t=v1\.\S+/)[0];
  const page = await boss(browser);
  await page.goto(link);
  await page.waitForFunction(() => window.__ready === true);
  const dlg = page.getByRole('dialog', { name: 'Запись сессии' });
  await expect(dlg).toContainText('от Мария');
  await expect(dlg).toContainText('Понедельник, 28 сентября, 18:00');
  await expect(dlg).toContainText('Понедельник, 28 сентября, 19:00');
  await expect(dlg).toContainText('Консультирование');
  // клиент закрытой области скрыт, пока не коснёшься
  await dlg.getByRole('button', { name: 'Показать клиента' }).click();
  await expect(dlg).toContainText('А.К. · сессия №4');
  await dlg.getByRole('button', { name: 'Добавить в план' }).click();
  await expect(page.getByText(/Молебен — пн 28\.09, 17:30–18:30/)).toBeVisible();
  await page.getByRole('button', { name: 'Изменить время' }).click();
  await page.getByRole('button', { name: '2026-09-29' }).click();
  await page.getByRole('button', { name: '18:00', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('В плане');
  const d = await dump(page);
  const g = d.data.groups[0];
  expect(g).toMatchObject({ cycle: 4, title: 'Сессия · А.К. · №4' });
  expect(d.data.tasks.find((t) => t.groupId === g.id && t.isAnchor)).toMatchObject({ date: '2026-09-29', time: '18:00', dur: 60, inbox: false });
  expect(d.data.tasks.some((t) => t.inbox)).toBe(false);
  expect(d.data.people[0].counter).toBe(4);
  // повторное открытие не дублирует
  await page.goto('about:blank');
  await page.goto(link);
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.locator('.toast')).toContainText('уже в плане');
});

test('запись сессии: при наложении можно «Добавить всё равно»; новый код — клиент в закрытой области', async ({ browser }) => {
  const shared = await recordSession(browser, { client: 'Б.В.', day: 'пн 28', from: '18:00' });
  const link = shared.text.match(/https?:\/\/\S+#t=v1\.\S+/)[0];
  const page = await boss(browser);
  await page.goto(link);
  await page.waitForFunction(() => window.__ready === true);
  const dlg = page.getByRole('dialog', { name: 'Запись сессии' });
  await expect(dlg).toContainText('не указан');
  await dlg.getByRole('button', { name: 'Добавить в план' }).click();
  await expect(page.getByText(/Молебен/)).toBeVisible();
  await page.getByRole('button', { name: 'Добавить всё равно' }).click();
  await page.getByRole('button', { name: /Создать в «Консультирование»/ }).click();
  const d = await dump(page);
  const p = d.data.people.find((x) => x.code === 'Б.В.');
  expect(d.data.areas.find((a) => a.id === p.areaId).private).toBe(true);
  const anchor = d.data.tasks.find((t) => t.isAnchor);
  expect(anchor).toMatchObject({ date: '2026-09-28', time: '18:00', personId: p.id });
});

test('запись сессии без наложений добавляется сразу', async ({ browser }) => {
  const shared = await recordSession(browser, { client: 'А.К.', day: 'вс 27', from: '11:00', to: '12:00' });
  const link = shared.text.match(/https?:\/\/\S+#t=v1\.\S+/)[0];
  const page = await boss(browser);
  await page.goto(link);
  await page.waitForFunction(() => window.__ready === true);
  await page.getByRole('dialog', { name: 'Запись сессии' }).getByRole('button', { name: 'Добавить в план' }).click();
  await expect(page.locator('.toast')).toContainText('В плане');
  await expect(page.getByText('Накладывается по времени')).toHaveCount(0);
  const d = await dump(page);
  expect(d.data.tasks.find((t) => t.isAnchor)).toMatchObject({ date: '2026-09-27', time: '11:00', dur: 60 });
});
