// Этап 3: горизонты — квадраты, месяц, год, контексты.
import { test, expect } from '@playwright/test';
import { start, add, tab, dump, NOW } from './helpers.js';

const capture = () => { window.__shared = []; navigator.share = async (d) => { window.__shared.push(d); }; navigator.canShare = () => false; };

test('разбор по квадратам: каждая зона сразу выполняет своё действие', async ({ page }) => {
  await page.addInitScript(capture);
  await start(page);
  await page.evaluate(async () => { const st = await import(location.origin + '/js/store.js'); st.setSettings({ contacts: [{ id: 'c1', name: 'Жена', areaId: null }] }); });
  for (const t of ['подать документы', 'обдумать курс', 'заказать бланки', 'пересмотреть архив']) await add(page, t);
  await tab(page, 'Входящие');
  await page.getByRole('button', { name: 'Разобрать по квадратам' }).click();
  const dlg = page.getByRole('dialog', { name: 'Разбор по квадратам' });
  const put = async (text, zone) => {
    await dlg.locator('.pool-item', { hasText: text }).click();
    await dlg.getByRole('button', { name: zone }).click();
  };
  await put('Подать документы', 'Важно и срочно');
  await page.getByRole('dialog', { name: 'Важно и срочно' }).getByRole('button', { name: 'Сегодня' }).click();
  await put('Обдумать курс', 'Важно, не срочно');
  await expect(page.getByRole('heading', { name: 'Назначить день — это стоит защищать' })).toBeVisible();
  await page.getByRole('button', { name: '2026-09-29' }).click();
  await put('Заказать бланки', 'Срочно, не важно');
  await page.getByRole('button', { name: 'Жена' }).click();
  await put('Пересмотреть архив', 'Ни то ни другое');
  await page.getByRole('button', { name: 'В «Когда-нибудь»' }).click();
  await expect(dlg.getByText('Всё разобрано.')).toBeVisible();
  const d = await dump(page);
  const t = (x) => d.data.tasks.find((y) => y.text === x);
  expect(t('Подать документы')).toMatchObject({ date: '2026-09-24', inbox: false });
  expect(t('Обдумать курс')).toMatchObject({ date: '2026-09-29', inbox: false });
  expect(t('Заказать бланки')).toMatchObject({ waitFor: 'Жена' });
  expect(t('Пересмотреть архив')).toMatchObject({ status: 'someday' });
  const shared = await page.evaluate(() => window.__shared);
  expect(shared[0].text).toContain('Заказать бланки');
});

test('квадраты: задачу можно перетащить в зону', async ({ page }) => {
  await start(page);
  await add(page, 'перетаскиваемое');
  await tab(page, 'Входящие');
  await page.getByRole('button', { name: 'Разобрать по квадратам' }).click();
  await page.waitForTimeout(400); // лист выезжает
  const item = page.locator('.pool-item', { hasText: 'Перетаскиваемое' });
  const zone = page.getByRole('button', { name: 'Ни то ни другое' });
  const a = await item.boundingBox();
  const z = await zone.boundingBox();
  await page.mouse.move(a.x + 30, a.y + 15);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.move(z.x + 40, z.y + 40, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Удалить' }).click();
  const d = await dump(page);
  expect(d.data.tasks[0].deletedAt).toBeTruthy();
});

test('месяц: сетка с праздниками, до трёх фокусов, прогресс — списком сделанного', async ({ page }) => {
  await start(page);
  await add(page, 'уже сделал отправил отчёт по гранту');
  await tab(page, 'План');
  await page.getByRole('button', { name: 'Месяц', exact: true }).click();
  await expect(page.locator('.m-cell.feast')).toHaveCount(3); // 11, 21, 27 сентября
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Фокус', exact: true }).click();
    await page.getByRole('textbox', { name: 'Фокус месяца' }).fill('Фокус ' + i);
    await page.getByRole('textbox', { name: 'Фокус месяца' }).press('Enter');
    await page.getByRole('button', { name: i === 1 ? 'Ковчег жизни' : 'Без области' }).click();
  }
  await expect(page.getByRole('button', { name: 'Фокус', exact: true })).toHaveCount(0);
  await expect(page.locator('.focus')).toHaveCount(3);
  await page.getByRole('button', { name: 'сделано: 1' }).click();
  await expect(page.locator('#view')).toContainText('Отправил отчёт по гранту');
  const text = await page.locator('#view').innerText();
  expect(text).not.toMatch(/%/);
});

test('год: лента из 12 месяцев с церковными периодами, до трёх направлений, начало года по настройке', async ({ page }) => {
  await start(page);
  await tab(page, 'План');
  await page.getByRole('button', { name: 'Год', exact: true }).click();
  await expect(page.locator('.daynav')).toContainText('2026/27');
  await expect(page.locator('.year-m')).toHaveCount(12);
  await expect(page.locator('.year-m').first()).toContainText('Сентябрь 2026');
  await expect(page.locator('#view')).toContainText('Пасха');
  await expect(page.locator('#view')).toContainText('Великий пост');
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Направление', exact: true }).click();
    await page.getByRole('textbox', { name: 'Направление года' }).fill('Направление ' + i);
    await page.getByRole('textbox', { name: 'Направление года' }).press('Enter');
    await page.getByRole('button', { name: 'Без области' }).click();
  }
  await expect(page.getByRole('button', { name: 'Направление', exact: true })).toHaveCount(0);
  await page.evaluate(async () => { const st = await import(location.origin + '/js/store.js'); st.setSettings({ yearStart: 1 }); });
  await expect(page.locator('.daynav')).toContainText('2026');
  await expect(page.locator('.year-m').first()).toContainText('Январь');
});

test('итоги месяца: три вопроса, отпущенное уходит без следов', async ({ page }) => {
  await start(page, { now: new Date('2026-09-29T09:00:00+04:00') });
  await add(page, 'давняя затея');
  await expect(page.getByText('Месяц подходит к концу')).toBeVisible();
  await page.getByRole('button', { name: 'Ответить' }).click();
  await page.getByLabel('Что получилось?').fill('Запустили курс');
  await page.getByLabel('Что продолжить?').fill('Молодёжные встречи');
  await page.getByRole('checkbox', { name: /Давняя затея/ }).click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Месяц подходит к концу')).toHaveCount(0);
  await tab(page, 'Входящие');
  await expect(page.locator('#view')).not.toContainText('Давняя затея');
  const d = await dump(page);
  expect(d.data.meta.reflections['2026-09']).toMatchObject({ good: 'Запустили курс', cont: 'Молодёжные встречи' });
});

test('задачи «в месяце» в начале месяца предлагаются к распределению по неделям', async ({ page }) => {
  await start(page);
  await add(page, 'написать статью в октябре');
  await page.clock.setSystemTime(new Date('2026-10-02T09:00:00+04:00'));
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  // сначала итоги сентября — отложим
  if (await page.getByText('Месяц подходит к концу').isVisible()) await page.getByRole('button', { name: 'Не сейчас' }).click();
  await expect(page.getByText(/На октябрь: 1 задача/)).toBeVisible();
  await page.getByRole('button', { name: 'Распределить' }).click();
  await page.getByRole('button', { name: '05.10–11.10' }).click();
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ date: '2026-10-05', dateKind: 'week' });
});

test('контексты: «Звонки» одним касанием, свои контексты распознаются при вводе', async ({ page }) => {
  await start(page);
  await add(page, 'позвонить отцу Сергию');
  await add(page, 'перезвонить в типографию сегодня');
  await page.getByRole('button', { name: /Звонки · 2/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Звонки' });
  await expect(dlg.locator('.row')).toHaveCount(2);
  await page.keyboard.press('Escape');
  // свой контекст
  await page.evaluate(async () => { const st = await import(location.origin + '/js/store.js'); st.change(() => st.setMeta('contexts', [...st.contexts(), { id: 'car', name: 'В машине', synonyms: ['заправить', 'шиномонтаж'] }])); });
  await add(page, 'заправить машину завтра');
  const d = await dump(page);
  expect(d.data.tasks.find((t) => t.text === 'Заправить машину').ctx).toBe('car');
});

test('«Что сейчас?»: время и место → одна подходящая задача', async ({ page }) => {
  await start(page);
  await add(page, 'быстро позвонить в епархию');
  await add(page, 'большое: переписать устав');
  await page.getByRole('button', { name: 'Готово' }).last().click().catch(() => {});
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Что сейчас?' }).click();
  await page.getByRole('button', { name: '15 мин' }).click();
  await page.getByRole('dialog', { name: 'Что сейчас?' }).getByRole('button', { name: 'Звонки', exact: true }).click();
  const box = page.locator('.whatnow');
  await expect(box).toContainText('Позвонить в епархию');
  await expect(box.locator('.t-text')).toHaveCount(1);
  await page.getByRole('button', { name: 'Другую' }).click();
  await expect(box).toContainText('Больше вариантов нет');
});

test('область с датой окончания: за две недели — предложение архивировать', async ({ page }) => {
  await start(page, { now: new Date('2026-12-20T09:00:00+04:00') });
  await expect(page.getByText(/«Ковчег жизни» заканчивается/)).toBeVisible();
  await page.getByRole('button', { name: 'Архивировать' }).click();
  const d = await dump(page);
  expect(d.data.areas.find((a) => a.name === 'Ковчег жизни').archived).toBe(true);
});

test('особые дни уменьшают ёмкость', async ({ page }) => {
  await start(page);
  const cap = await page.evaluate(async () => {
    const st = await import(location.origin + '/js/store.js');
    st.change(() => st.setMeta('specialDays', [{ id: 's', title: 'Престольный праздник', date: '2020-10-01', yearly: true, hours: 4 }]));
    return [st.capacityOf('2026-10-01'), st.capacityOf('2026-10-02')];
  });
  expect(cap).toEqual([4 * 60, 8 * 60]);
});

test('дополнительное спрятано: на первом экране нет шаблонов, квадратов, месяца и PIN', async ({ page }) => {
  await start(page);
  await add(page, 'дело сегодня');
  const txt = await page.locator('body').innerText();
  for (const w of ['Шаблон', 'квадрат', 'Месяц', 'PIN', 'Контекст', 'Год']) expect(txt).not.toContain(w);
});
