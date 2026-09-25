// Этап 2: повторы, цепочки и люди, план дня и недели, нагрузка, церковный календарь, обмен, .ics.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { start, add, tab, dump, NOW } from './helpers.js';

const store = async (page, fn, arg) => {
  await page.evaluate(async () => { window.__st = await import(location.origin + '/js/store.js'); });
  return page.evaluate(`(async () => { const st = window.__st; const r = await (${fn.toString()})(st, ${JSON.stringify(arg ?? null)}); await st.flush(); return r; })()`);
};

test('повтор: после закрытия появляется следующий экземпляр', async ({ page }) => {
  await start(page);
  await add(page, 'зарядка каждый день в 7');
  await add(page, 'планёрка каждый пн');
  await page.getByRole('button', { name: /ещё \d+ — позже/ }).click();
  await page.locator('#view .row', { hasText: 'Зарядка' }).getByRole('button', { name: 'Готово' }).click();
  await expect(page.locator('.toast')).toContainText('следующий завтра');
  const d = await dump(page);
  const z = d.data.tasks.filter((t) => t.text === 'Зарядка');
  expect(z.map((t) => [t.status, t.date, t.time]).sort()).toEqual([['active', '2026-09-25', '07:00'], ['done', '2026-09-24', '07:00']]);
  const id = d.data.tasks.find((t) => t.text === 'Планёрка').id;
  await store(page, (st, id) => st.completeTask(id), id);
  const d2 = await dump(page);
  expect(d2.data.tasks.filter((t) => t.text === 'Планёрка' && t.status === 'active').map((t) => t.date)).toEqual(['2026-10-05']);
});

test('«Сессия» фразой для двух клиентов: раздельные цепочки, на «Сегодня» — только очередной шаг', async ({ page }) => {
  await start(page);
  await add(page, 'сессия с А.К. в пн в 18');
  await expect(page.getByText('Для клиентов — только код или инициалы')).toBeVisible();
  await page.getByRole('button', { name: /Создать А.К./ }).click();
  await add(page, 'сессия с М.С. во вторник в 11:30');
  await page.getByRole('button', { name: /Создать М.С./ }).click();
  await page.waitForTimeout(200);
  const d = await dump(page);
  expect(d.data.groups.map((g) => g.title).sort()).toEqual(['Сессия · А.К. · №1', 'Сессия · М.С. · №1']);
  const ga = d.data.groups.find((g) => g.title.includes('А.К.'));
  const steps = d.data.tasks.filter((t) => t.groupId === ga.id);
  const find = (s) => steps.find((t) => t.text.startsWith(s));
  expect(find('Перечитать').date).toBe('2026-09-27');
  expect(find('Отправить тесты').date).toBe('2026-09-27');
  expect([find('Проверить диктофон').date, find('Проверить диктофон').time]).toEqual(['2026-09-28', '17:45']);
  expect(steps.find((t) => t.isAnchor)).toMatchObject({ date: '2026-09-28', time: '18:00', dur: 60 });
  expect(find('Обновить карточку')).toBeUndefined();
  const people = d.data.people.map((p) => [p.code, p.counter]).sort();
  expect(people).toEqual([['А.К.', 1], ['М.С.', 1]]);
  // в воскресенье на «Сегодня» — по одному шагу каждой цепочки
  await page.clock.setSystemTime(new Date('2026-09-28T09:00:00+04:00'));
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  const ids = await store(page, (st) => st.tasksForDay(st.T()).map((t) => t.id));
  const shown = d.data.tasks.filter((t) => ids.includes(t.id) && t.groupId === ga.id && !t.isAnchor);
  expect(shown.length).toBe(1);
});

test('«каждую 3-ю» — на 3-й и 6-й, «только первый раз» — только на первой (через приложение)', async ({ page }) => {
  await start(page);
  const res = await store(page, (st) => {
    const tpl = st.templatesList().find((t) => t.name === 'Сессия');
    const p = st.newPerson({ code: 'Т.Т.', areaId: tpl.areaId });
    st.change(() => st.put('people', p));
    const out = [];
    for (let i = 0; i < 6; i++) {
      const r = st.launchTemplate(tpl.id, { anchor: { date: st.T(), time: '18:00' }, personId: p.id });
      out.push({ cycle: r.group.cycle, title: r.group.title, texts: r.tasks.map((t) => t.text) });
    }
    return out;
  });
  expect(res.map((r) => r.cycle)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(res[6 - 1].title).toBe('Сессия · Т.Т. · №6');
  expect(res.map((r) => r.texts.some((t) => t.startsWith('Обновить карточку')))).toEqual([false, false, true, false, false, true]);
  expect(res.map((r) => r.texts.some((t) => t.startsWith('Отправить тесты')))).toEqual([true, false, false, false, false, false]);
});

test('перенос якоря через интерфейс сдвигает все невыполненные шаги', async ({ page }) => {
  await start(page);
  await add(page, 'сессия с А.К. в пн в 18');
  await page.getByRole('button', { name: /Создать А.К./ }).click();
  await tab(page, 'Области');
  await page.locator('#view').getByRole('button', { name: /Консультирование/ }).click();
  await page.getByRole('button', { name: 'Показать' }).click();
  await page.getByRole('button', { name: /Сессия · А.К. · №1/ }).click();
  await page.getByRole('button', { name: 'Перенести якорь' }).click();
  await page.getByRole('button', { name: '2026-09-30' }).click();
  await page.getByRole('button', { name: ':30' }).nth(4).click(); // 10:30
  await expect(page.locator('.toast')).toContainText('Цепочка сдвинута');
  const d = await dump(page);
  const steps = d.data.tasks.filter((t) => t.groupId === d.data.groups[0].id);
  const find = (s) => steps.find((t) => t.text.startsWith(s));
  expect(steps.find((t) => t.isAnchor)).toMatchObject({ date: '2026-09-30', time: '10:30' });
  expect(find('Перечитать').date).toBe('2026-09-29');
  expect([find('Проверить диктофон').date, find('Проверить диктофон').time]).toEqual(['2026-09-30', '10:15']);
  expect(find('Транскрибировать').date).toBe('2026-09-30');
});

test('отмена якоря спрашивает, что сделать с шагами', async ({ page }) => {
  await start(page);
  await add(page, 'лекция в семинарии 15 октября в 10');
  await page.waitForTimeout(200);
  const g = (await dump(page)).data.groups[0];
  await page.evaluate(async (gid) => { const m = await import(location.origin + '/js/views/task.js'); m.cancelAnchorFlow(gid); }, g.id);
  await expect(page.getByText('Что сделать с шагами цепочки?')).toBeVisible();
  await page.getByRole('button', { name: 'Удалить все невыполненные шаги' }).click();
  const d = await dump(page);
  expect(d.data.tasks.filter((t) => t.groupId === g.id && !t.deletedAt).length).toBe(0);
  expect(d.data.groups[0].status).toBe('cancelled');
});

test('последний шаг закрыт → «Следующий раз?» → через неделю в то же время', async ({ page }) => {
  await start(page);
  await add(page, 'сессия с А.К. сегодня в 12');
  await page.getByRole('button', { name: /Создать А.К./ }).click();
  await page.waitForTimeout(200);
  const d = await dump(page);
  const ids = d.data.tasks.filter((t) => t.groupId).map((t) => t.id);
  await store(page, (st, ids) => { for (const id of ids) st.completeTask(id); }, ids);
  await expect(page.getByText('Следующий раз?')).toBeVisible();
  await page.locator('#view').getByText('•••').first().isVisible();
  await page.getByRole('button', { name: 'Через неделю в то же время' }).click();
  const d2 = await dump(page);
  const g2 = d2.data.groups.find((g) => g.cycle === 2);
  expect(g2.anchor).toMatchObject({ date: '2026-10-01', time: '12:00' });
  expect(g2.title).toBe('Сессия · А.К. · №2');
  await expect(page.getByText('Следующий раз?')).toHaveCount(0);
});

test('регулярное расписание: следующий цикл создаётся сам, не больше одного вперёд', async ({ page }) => {
  await start(page);
  const r = await store(page, (st) => {
    const tpl = st.templatesList().find((t) => t.name === 'Сессия');
    const p = st.newPerson({ code: 'Р.Р.', areaId: tpl.areaId, templateId: tpl.id, schedule: { dow: 4, time: '18:00' } });
    st.change(() => st.put('people', p));
    st.ensureScheduledCycles();
    st.ensureScheduledCycles();
    return [...st.S.groups.values()].map((g) => [g.anchor.date, g.anchor.time, g.cycle]);
  });
  expect(r).toEqual([['2026-09-24', '18:00', 1]]);
  // прошла сессия (якорь в прошлом) — появляется следующая, одна
  await page.clock.setSystemTime(new Date('2026-09-25T09:00:00+04:00'));
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  const r2 = await store(page, (st) => [...st.S.groups.values()].map((g) => [g.anchor.date, g.cycle]).sort());
  expect(r2).toEqual([['2026-09-24', 1], ['2026-10-01', 2]]);
});

test('«Сохранить как шаблон» из задачи с чек-листом даёт рабочий шаблон', async ({ page }) => {
  await start(page);
  await add(page, 'подготовить паломничество до 10.10');
  await page.waitForTimeout(100);
  const id = (await dump(page)).data.tasks[0].id;
  // шаги с фактическими датами выполнения
  await store(page, (st, id) => {
    const t = st.S.tasks.get(id);
    st.updateTask(id, { checklist: [
      { id: 'c1', text: 'Договориться с монастырём', done: true, doneAt: '2026-09-26T10:00:00+04:00' },
      { id: 'c2', text: 'Заказать автобус', done: true, doneAt: '2026-10-03T10:00:00+04:00' },
      { id: 'c3', text: 'Раздать памятки', done: false },
    ] });
    return t.id;
  }, id);
  await page.evaluate(async (id) => { (await import(location.origin + '/js/views/task.js')).openTask(id); }, id);
  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить как шаблон' }).click();
  await expect(page.getByText('Смещения шагов предложены по фактическим датам')).toBeVisible();
  await page.getByLabel('Название шаблона').fill('Паломничество');
  await page.getByLabel('Синонимы').fill('паломничество, поездка');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const d = await dump(page);
  const tpl = d.data.templates.find((t) => t.name === 'Паломничество');
  expect(tpl.anchor).toBeTruthy();
  expect(tpl.steps.map((s) => [s.text, s.offset.kind, s.offset.n])).toEqual([
    ['Договориться с монастырём', 'before_days', 14],
    ['Заказать автобус', 'before_days', 7],
    ['Раздать памятки', 'same_day', 0],
  ]);
  // шаблон запускается фразой
  await page.keyboard.press('Escape');
  await tab(page, 'Сегодня');
  await add(page, 'поездка 20 ноября в 8');
  await page.waitForTimeout(300);
  const d2 = await dump(page);
  const g = d2.data.groups.find((x) => x.templateName === 'Паломничество');
  const steps = d2.data.tasks.filter((t) => t.groupId === g.id);
  expect(steps.find((t) => t.text === 'Договориться с монастырём').date).toBe('2026-11-06');
  expect(steps.find((t) => t.text === 'Заказать автобус').date).toBe('2026-11-13');
  expect(steps.find((t) => t.isAnchor)).toMatchObject({ date: '2026-11-20', time: '08:00' });
});

test('изменение шаблона не ломает уже созданные цепочки', async ({ page }) => {
  await start(page);
  await add(page, 'пост в блог в субботу');
  await page.waitForTimeout(200);
  const before = (await dump(page)).data.tasks.filter((t) => t.groupId).map((t) => t.text).sort();
  await store(page, (st) => {
    const tpl = st.templatesList().find((t) => t.name === 'Пост в блог');
    st.saveTemplate({ ...tpl, steps: tpl.steps.map((s) => ({ ...s, text: s.text + ' (новое)' })) });
  });
  const after = (await dump(page)).data.tasks.filter((t) => t.groupId).map((t) => t.text).sort();
  expect(after).toEqual(before);
});

test('экран дня: постоянные блоки, свободные окна, постановка задачи в окно', async ({ page }) => {
  await start(page);
  await store(page, (st) => st.change(() => st.setMeta('blocks', [{ id: 'b1', title: 'Литургия', areaId: null, dow: 4, start: '07:30', end: '10:00' }])));
  await add(page, 'написать письмо сегодня');
  await add(page, 'встреча сегодня в 14:00');
  await tab(page, 'План');
  await page.getByRole('button', { name: 'День', exact: true }).click();
  await expect(page.locator('.tl-item.block')).toContainText('Литургия');
  await expect(page.locator('.tl-item', { hasText: 'Встреча' })).toBeVisible();
  const free = page.locator('.tl-free').first();
  await expect(free).toContainText('свободно');
  await free.click();
  await page.getByRole('button', { name: /Написать письмо/ }).click();
  const d = await dump(page);
  expect(d.data.tasks.find((t) => t.text === 'Написать письмо').time).toBe('10:00');
});

test('перетаскивание задачи на ленту дня', async ({ page }) => {
  await start(page);
  await add(page, 'прочитать главу сегодня');
  await tab(page, 'План');
  await page.getByRole('button', { name: 'День', exact: true }).click();
  const handle = page.getByRole('button', { name: 'Перетащить на ленту' });
  const tl = page.locator('.timeline');
  const hb = await handle.boundingBox();
  const from = Number(await tl.getAttribute('data-from'));
  const tb = await tl.boundingBox();
  // цель — 16:00
  await tl.evaluate((el) => el.scrollIntoView());
  await handle.scrollIntoViewIfNeeded();
  const hb2 = await handle.boundingBox();
  await page.mouse.move(hb2.x + 10, hb2.y + 10);
  await page.mouse.down();
  const tb2 = await tl.boundingBox();
  const y = tb2.y + (16 * 60 - from) * 1.1;
  await page.mouse.move(tb2.x + 60, Math.min(y, 790), { steps: 8 });
  await page.mouse.up();
  const d = await dump(page);
  expect(d.data.tasks[0].time).toMatch(/^\d\d:(00|15|30|45)$/);
  expect(hb && tb).toBeTruthy();
});

test('нагрузка недели: спокойные цвета и мягкое предупреждение при запуске цепочки', async ({ page }) => {
  await start(page);
  await store(page, (st) => st.setSettings({ capacity: [2, 2, 2, 2, 2, 2, 2] }));
  await add(page, 'большое дело на 3 часа завтра');
  await page.keyboard.press('Escape');
  await tab(page, 'План');
  await expect(page.locator('.week-day .lv-over').first()).toBeVisible();
  await expect(page.getByText(/Плотно:/)).toBeVisible();
  await tab(page, 'Сегодня');
  await add(page, 'лекция завтра в 15');
  await expect(page.getByText(/Получается перегруз/)).toBeVisible();
  await page.getByRole('button', { name: 'Оставить как есть' }).click();
  const d = await dump(page);
  expect(d.data.groups.length).toBe(1);
});

test('церковный календарь: праздник в заголовке и меньше ёмкость', async ({ page }) => {
  await start(page, { now: new Date('2026-09-27T09:00:00+04:00') });
  await expect(page.locator('header')).toContainText('Воздвижение');
  const cap = await store(page, (st) => [st.capacityOf('2026-09-27'), st.capacityOf('2026-09-26'), st.capacityOf('2026-09-24')]);
  expect(cap).toEqual([2 * 60, 4 * 60, 8 * 60]); // вс 5−3; сб 6−2 (канун); чт 8
});

test('жёсткие сроки — отдельная лента со счётчиком «осталось N дн.»', async ({ page }) => {
  await start(page);
  await add(page, 'отчёт по гранту до 15.10');
  await tab(page, 'План');
  await expect(page.locator('.ribbon .dl')).toContainText('осталось 21 день');
});

test('обмен задачей между двумя профилями: без дублей, «Жду от», «Сообщить, что сделано»', async ({ browser }) => {
  const capture = () => { window.__shared = []; navigator.share = async (d) => { window.__shared.push(d); }; navigator.canShare = () => false; };
  const ctxA = await browser.newContext();
  await ctxA.addInitScript(capture);
  const a = await ctxA.newPage();
  await start(a, { name: 'Иоанн' });
  await a.evaluate(async () => { const st = await import(location.origin + '/js/store.js'); st.setSettings({ contacts: [{ id: 'c1', name: 'Жена', areaId: null }] }); });
  await add(a, 'купить хлеб завтра в 18');
  const taskId = (await dump(a)).data.tasks[0].id;
  await a.evaluate(async (id) => { (await import(location.origin + '/js/views/task.js')).openTask(id); }, taskId);
  await a.getByRole('button', { name: 'Ещё', exact: true }).click();
  await a.getByRole('button', { name: 'Отправить задачу' }).click();
  await a.getByRole('button', { name: 'Жена' }).click();
  const shared = await a.evaluate(() => window.__shared[0]);
  expect(shared.text).toContain('Иоанн: Купить хлеб — завтра, в 18:00');
  const link = shared.text.match(/https?:\/\/\S+#t=v1\.\S+/)[0];
  expect(link.split('#')[0]).toBe('http://localhost:4173/');
  let d = await dump(a);
  expect(d.data.tasks[0].waitFor).toBe('Жена');
  await a.keyboard.press('Escape');
  await tab(a, 'Входящие');
  await a.getByRole('button', { name: /Жду от Жена · 1/ }).click();
  await expect(a.locator('#view')).toContainText('Купить хлеб');

  const ctxB = await browser.newContext();
  await ctxB.addInitScript(capture);
  const b = await ctxB.newPage();
  await start(b, { name: 'Мария' });
  await b.evaluate(async () => { const st = await import(location.origin + '/js/store.js'); st.setSettings({ contacts: [{ id: 'c2', name: 'Иоанн', areaId: [...st.S.areas.values()].find((x) => x.name === 'Семья').id }] }); });
  await b.goto(link);
  await b.waitForFunction(() => window.__ready === true);
  await expect(b.locator('.toast')).toContainText('от Иоанн');
  await expect(b.locator('#view')).toContainText('Купить хлеб');
  await expect(b.locator('#view')).toContainText('от Иоанн');
  // повторное открытие не дублирует
  await b.goto('about:blank');
  await b.goto(link);
  await b.waitForFunction(() => window.__ready === true);
  await expect(b.locator('.toast')).toContainText('уже есть');
  d = await dump(b);
  expect(d.data.tasks.length).toBe(1);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Купить хлеб', date: '2026-09-25', time: '18:00', inbox: true, from: { name: 'Иоанн' } });
  expect(d.data.areas.find((x) => x.id === d.data.tasks[0].areaId).name).toBe('Семья');
  // жена закрывает → «Сообщить, что сделано»
  await tab(b, 'Входящие');
  await b.locator('#view .row', { hasText: 'Купить хлеб' }).getByRole('button', { name: 'Готово' }).click();
  await b.getByRole('button', { name: /Сообщить Иоанн/ }).click();
  const back = await b.evaluate(() => window.__shared[0]);
  expect(back.text).toContain('Сделано: Купить хлеб');
  const doneLink = back.text.match(/https?:\/\/\S+#d=v1\.\S+/)[0];
  await a.goto(doneLink);
  await a.waitForFunction(() => window.__ready === true);
  await expect(a.locator('.toast')).toContainText('Мария');
  d = await dump(a);
  expect(d.data.tasks[0].status).toBe('done');
  await ctxA.close();
  await ctxB.close();
});

test('ссылка во встроенном браузере: «Открыть в приложении» и «Скопировать код», затем «Вставить задачу»', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await page.clock.install({ time: NOW });
  const code = await page.evaluate(async () => { await import(location.origin + '/js/share.js').catch(() => null); return null; }).catch(() => null);
  await page.goto('/manifest.json');
  const enc = await page.evaluate(async () => (await import(location.origin + '/js/share.js')).encodeTask({ id: 'zz1', text: 'Забрать детей из школы', date: '2026-09-25', dateKind: 'day' }, 'Мария'));
  expect(code).toBe(null);
  // не настроенное здесь приложение — показываем варианты вместо тихого добавления
  await page.goto('/#t=' + enc);
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.getByRole('button', { name: 'Открыть в приложении' })).toBeVisible();
  await page.getByRole('button', { name: 'Скопировать код' }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('t=' + enc);
  // в «настоящем» приложении — «Вставить задачу»
  const page2 = await ctx.newPage();
  await start(page2, { name: 'Иоанн' });
  await tab(page2, 'Входящие');
  await page2.getByRole('button', { name: 'Вставить задачу' }).click();
  await expect(page2.locator('#view')).toContainText('Забрать детей из школы');
  await ctx.close();
});

test('закрытая область: задачу нельзя отправить, в .ics — только «Встреча»', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(() => { navigator.canShare = () => false; });
  const page = await ctx.newPage();
  await start(page);
  await add(page, '#консультирование встреча с клиентом Б. завтра в 16:00');
  const t = (await dump(page)).data.tasks[0];
  await page.evaluate(async (id) => { (await import(location.origin + '/js/views/common.js')).app.revealed.add(id); (await import(location.origin + '/js/views/task.js')).openTask(id); }, t.id);
  await expect(page.getByText(/Закрытая область: задачу нельзя отправить/)).toBeVisible();
  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Отправить задачу' })).toHaveCount(0);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'В календарь', exact: true }).click()]);
  const ics = readFileSync(await dl.path(), 'utf8');
  expect(ics).toContain('SUMMARY:Встреча');
  expect(ics).not.toContain('клиентом');
  expect(ics).toContain('TRIGGER:-PT15M');
  // даже программная отправка отказывает
  await page.evaluate(async (id) => { const st = await import(location.origin + '/js/store.js'); (await import(location.origin + '/js/views/share.js')).sendTask(st.S.tasks.get(id)); }, t.id);
  await expect(page.locator('.toast')).toContainText('не отправляются');
  await ctx.close();
});

test('выделение нескольких задач: перенести и закрыть', async ({ page }) => {
  await start(page);
  for (const x of ['первое', 'второе', 'третье']) await add(page, x + ' сегодня');
  const r1 = page.locator('#view .row', { hasText: 'Первое' });
  const b = await r1.boundingBox();
  await page.mouse.move(b.x + 120, b.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByText('Выбрано: 1')).toBeVisible();
  await page.locator('#view .row', { hasText: 'Второе' }).locator('.t-main').click();
  await expect(page.getByText('Выбрано: 2')).toBeVisible();
  await page.locator('.selbar').getByRole('button', { name: 'Перенести' }).click();
  await page.getByRole('button', { name: 'Завтра' }).click();
  let d = await dump(page);
  expect(d.data.tasks.filter((t) => t.date === '2026-09-25').map((t) => t.text).sort()).toEqual(['Второе', 'Первое']);
  const r3 = page.locator('#view .row', { hasText: 'Третье' });
  const b3 = await r3.boundingBox();
  await page.mouse.move(b3.x + 120, b3.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.locator('.selbar').getByRole('button', { name: 'Закрыть' }).click();
  d = await dump(page);
  expect(d.data.tasks.find((t) => t.text === 'Третье').status).toBe('done');
});

test('поиск по всем задачам, включая сделанные; закрытые — только после открытия', async ({ page }) => {
  await start(page);
  await add(page, 'купить ладан');
  await add(page, 'уже сделал заказал ладан для праздника');
  await add(page, '#консультирование ладан упомянуть в сессии');
  await page.getByRole('button', { name: 'Поиск' }).click();
  await page.getByRole('searchbox', { name: 'Поиск' }).fill('ладан');
  const res = page.locator('.sheet .row');
  await expect(res).toHaveCount(2);
  await page.getByRole('button', { name: /Искать в «Консультирование»/ }).click();
  await expect(res).toHaveCount(3);
});

test('недельный обзор: шаги, можно прервать и продолжить', async ({ page }) => {
  await start(page);
  await add(page, 'уже сделал подготовил отчёт');
  await add(page, 'мысль во входящие');
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('button', { name: 'Недельный обзор' }).click();
  await expect(page.getByText('1. Сделанное за неделю')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Недельный обзор' })).toContainText('Подготовил отчёт');
  await page.getByRole('button', { name: 'Дальше' }).click();
  await expect(page.getByText('2. Входящие')).toBeVisible();
  await page.getByRole('button', { name: 'Прервать' }).click();
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('button', { name: 'Недельный обзор' }).click();
  await expect(page.getByText('2. Входящие')).toBeVisible();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Дальше' }).click();
  await expect(page.getByText('6. Нагрузка следующей недели')).toBeVisible();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await expect(page.getByText('7. Резервная копия')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить копию' })).toBeVisible();
  await page.getByRole('button', { name: 'Готово' }).click();
  const d = await dump(page);
  expect(d.data.meta.review.done).toBe(true);
});

test('напоминание о копии: больше 7 дней без экспорта — мягкая карточка', async ({ page }) => {
  await start(page);
  await add(page, 'разобрать архив');
  await page.clock.setSystemTime(new Date('2026-10-05T09:00:00+04:00'));
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.getByText('Сохранить копию данных?')).toBeVisible();
});
