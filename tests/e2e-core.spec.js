// Этап 1: ядро — ввод, «Сегодня», «Входящие», области, закрытие, приватность.
import { test, expect } from '@playwright/test';
import { start, add, tab, dump, NOW } from './helpers.js';

const rows = (page) => page.locator('#view .row');

test('быстрый ввод: распознанное — по местам, нераспознанное — во «Входящие»', async ({ page }) => {
  await start(page);
  await add(page, 'позвонить владыке сегодня в 15:00');
  await add(page, 'подумать о летнем лагере');
  await expect(page.locator('#view')).toContainText('Позвонить владыке');
  await expect(page.locator('#view')).not.toContainText('Подумать о летнем лагере');
  await tab(page, 'Входящие');
  await expect(page.locator('#view')).toContainText('Подумать о летнем лагере');
  const d = await dump(page);
  const t = d.data.tasks.find((x) => x.text === 'Позвонить владыке');
  expect(t).toMatchObject({ date: '2026-09-24', time: '15:00', inbox: false });
  expect(d.data.tasks.find((x) => x.text === 'Подумать о летнем лагере').inbox).toBe(true);
});

test('фишки видны при вводе и правятся касанием', async ({ page }) => {
  await start(page);
  const inp = page.getByLabel('Новая задача');
  await inp.click();
  await inp.fill('позвонить маме завтра в 18');
  const chips = page.getByLabel('Распознано');
  await expect(chips).toContainText('завтра');
  await expect(chips).toContainText('18:00');
  await expect(chips).toContainText('Звонки');
  // убрать время одним касанием
  await chips.getByRole('button', { name: /18:00/ }).getByRole('button', { name: 'Убрать' }).click();
  await expect(chips).not.toContainText('18:00');
  // дата «Сегодня» за одно касание
  await page.locator('.comp-extra').getByRole('button', { name: 'Сегодня', exact: true }).click();
  await expect(chips).toContainText('сегодня');
  await inp.press('Enter');
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Позвонить маме', date: '2026-09-24', time: null });
});

test('ручной выбор времени: сетка с шагом 15 минут', async ({ page }) => {
  await start(page);
  const inp = page.getByLabel('Новая задача');
  await inp.click();
  await inp.fill('встреча');
  await page.locator('.comp-extra').getByRole('button', { name: 'Время…' }).click();
  await page.getByRole('button', { name: '14:45', exact: true }).click();
  await expect(page.getByLabel('Распознано')).toContainText('14:45');
  await inp.press('Enter');
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ time: '14:45', date: '2026-09-24' });
});

test('закрытие: галочка, «Отменить», «Сделано сегодня»', async ({ page }) => {
  await start(page);
  await add(page, 'написать письмо сегодня');
  await page.locator('.row', { hasText: 'Написать письмо' }).getByRole('button', { name: 'Готово' }).click();
  await expect(page.locator('.toast')).toContainText('Сделано');
  await expect(page.getByRole('button', { name: /Сделано сегодня: 1/ })).toBeVisible();
  await page.locator('.toast').getByRole('button', { name: 'Отменить' }).click();
  await expect(page.locator('#view .row', { hasText: 'Написать письмо' })).toBeVisible();
  let d = await dump(page);
  expect(d.data.tasks[0].status).toBe('active');
  // свайп вправо — готово
  const row = page.locator('#view .row', { hasText: 'Написать письмо' });
  const box = await row.boundingBox();
  await page.mouse.move(box.x + 80, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 80 + i * 22, box.y + box.height / 2);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /Сделано сегодня: 1/ })).toBeVisible();
  d = await dump(page);
  expect(d.data.tasks[0].status).toBe('done');
});

test('«Уже сделал» записывает сразу закрытым', async ({ page }) => {
  await start(page);
  await add(page, 'уже сделал позвонил отцу диакону');
  await expect(page.getByRole('button', { name: /Сделано сегодня: 1/ })).toBeVisible();
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Позвонил отцу диакону', status: 'done' });
});

test('лимит трёх главных: четвёртое — только вместо одного', async ({ page }) => {
  await start(page);
  for (const t of ['первое !', 'второе !', 'третье !']) await add(page, t);
  await add(page, 'четвёртое !');
  await expect(page.getByText('Уже три главных')).toBeVisible();
  await page.getByRole('button', { name: 'Убрать: Второе' }).click();
  const d = await dump(page);
  const stars = d.data.tasks.filter((t) => t.star === '2026-09-24').map((t) => t.text).sort();
  expect(stars).toEqual(['Первое', 'Третье', 'Четвёртое']);
});

test('первый экран — минимум: 3 главных, ближайшее, одна строка «ещё N»', async ({ page }) => {
  await start(page);
  for (let i = 1; i <= 12; i++) await add(page, `дело номер ${i} сегодня`);
  await add(page, 'встреча сегодня в 16:00');
  await add(page, 'звонок сегодня в 17:00');
  await add(page, 'совещание сегодня в 18:00');
  await expect(page.locator('#view')).toContainText('ещё');
  expect(await rows(page).count()).toBeLessThanOrEqual(5);
  await expect(page.getByRole('button', { name: /ещё \d+ — позже/ })).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/просроч|%|очк|серия/i);
});

test('вчерашнее — одной карточкой: перенести всё на сегодня', async ({ page }) => {
  await start(page);
  await add(page, 'первое дело сегодня');
  await add(page, 'второе дело сегодня');
  await dump(page); // дождаться записи в IndexedDB до перезагрузки
  await page.clock.setSystemTime(new Date('2026-09-25T08:00:00+04:00'));
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.getByText('С прошлых дней осталось 2')).toBeVisible();
  await page.getByRole('button', { name: 'Перенести всё на сегодня' }).click();
  const d = await dump(page);
  expect(d.data.tasks.every((t) => t.date === '2026-09-25')).toBe(true);
  await expect(page.getByText('С прошлых дней осталось')).toHaveCount(0);
});

test('без срока и не тронутые 30 дней — тихо в «Когда-нибудь»', async ({ page }) => {
  await start(page);
  await add(page, 'идея без даты');
  await add(page, 'дело со сроком до 30.12');
  await page.clock.setSystemTime(new Date('2026-10-26T09:00:00+04:00'));
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  const d = await dump(page);
  expect(d.data.tasks.find((t) => t.text === 'Идея без даты').status).toBe('someday');
  expect(d.data.tasks.find((t) => t.text === 'Дело со сроком').status).toBe('active');
  await tab(page, 'Входящие');
  await page.getByRole('button', { name: /Когда-нибудь · 1/ }).click();
  await expect(page.locator('#view')).toContainText('Идея без даты');
});

test('закрытая область: текст скрыт, пока не коснёшься', async ({ page }) => {
  await start(page);
  await add(page, '#консультирование перечитать записи клиента сегодня');
  const row = page.locator('#view .row').first();
  await expect(row).toContainText('•••');
  await expect(page.locator('#view')).not.toContainText('Перечитать записи');
  await row.locator('.t-main').click();
  await expect(page.locator('#view')).toContainText('Перечитать записи');
});

test('закрытая область с PIN открывается только по PIN', async ({ page }) => {
  await start(page);
  await add(page, '#консультирование подготовить план сегодня');
  await tab(page, 'Области');
  await page.getByRole('button', { name: /Консультирование/ }).click();
  await page.getByRole('button', { name: 'Настройки области' }).click();
  await page.getByRole('switch', { name: /Открывать по PIN/ }).click();
  await page.getByRole('textbox', { name: 'Задайте PIN' }).fill('4321');
  await page.getByRole('textbox', { name: 'Задайте PIN' }).press('Enter');
  await expect(page.getByRole('switch', { name: /Открывать по PIN/ })).toHaveAttribute('aria-checked', 'true');
  const d = await dump(page);
  expect(d.data.meta.settings.pinHash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(d)).not.toContain('4321');
  await page.keyboard.press('Escape');
  await page.goBack();
  await tab(page, 'Сегодня');
  await page.locator('#view .row').first().locator('.t-main').click();
  for (const k of ['1', '1', '1', '1']) await page.getByRole('button', { name: k, exact: true }).click();
  await expect(page.getByText('Неверный PIN')).toBeVisible();
  for (const k of ['4', '3', '2', '1']) await page.getByRole('button', { name: k, exact: true }).click();
  await expect(page.locator('#view')).toContainText('Подготовить план');
});

test('области: создать, переименовать, архивировать и вернуть', async ({ page }) => {
  await start(page);
  await tab(page, 'Области');
  await page.getByRole('button', { name: 'Область', exact: true }).click();
  await page.getByPlaceholder('Название').fill('Паломничество');
  await page.getByRole('button', { name: 'Готово' }).click();
  await page.getByLabel('Название', { exact: true }).fill('Паломничество 2027');
  await page.getByLabel('Название', { exact: true }).press('Tab');
  await page.getByLabel('Ключевые слова').fill('паломники, поездка');
  await page.getByLabel('Ключевые слова').press('Tab');
  await page.getByRole('button', { name: 'В архив' }).click();
  await page.getByRole('button', { name: 'В архив' }).last().click();
  let d = await dump(page);
  const a = d.data.areas.find((x) => x.name === 'Паломничество 2027');
  expect(a).toMatchObject({ archived: true, synonyms: ['паломники', 'поездка'] });
  await page.getByRole('button', { name: /Архив · 1/ }).click();
  await page.getByRole('button', { name: /Паломничество 2027/ }).click();
  await page.getByRole('button', { name: 'Настройки области' }).click();
  await page.getByRole('button', { name: 'Вернуть из архива' }).click();
  d = await dump(page);
  expect(d.data.areas.find((x) => x.name === 'Паломничество 2027').archived).toBe(false);
});

test('ключевые слова области работают при вводе', async ({ page }) => {
  await start(page);
  await add(page, 'подготовить отчёт по гранту');
  const d = await dump(page);
  const area = d.data.areas.find((a) => a.id === d.data.tasks[0].areaId);
  expect(area.name).toBe('Ковчег жизни');
});

test('данные переживают перезагрузку', async ({ page }) => {
  await start(page);
  await add(page, 'не потерять это');
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  await tab(page, 'Входящие');
  await expect(page.locator('#view')).toContainText('Не потерять это');
});

test('задача L предлагает первый маленький шаг', async ({ page }) => {
  await start(page);
  await add(page, 'большое: написать книгу');
  await page.getByPlaceholder('Например: набросать план').fill('составить оглавление');
  await page.getByRole('button', { name: 'Готово' }).click();
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ size: 'L' });
  expect(d.data.tasks[0].checklist[0].text).toBe('составить оглавление');
});

test('заметка: телефоны и ссылки кликабельны, чужой текст не исполняется', async ({ page }) => {
  await start(page);
  await add(page, 'позвонить в епархию сегодня');
  await page.locator('#view .row .t-main').first().click();
  await page.getByRole('button', { name: /Ещё поля/ }).click();
  await page.getByLabel('Заметка').fill('Тел. +7 846 123-45-67, сайт https://example.org/page <img src=x onerror="window.__x=1">');
  await page.getByLabel('Заметка').press('Tab');
  await page.getByLabel('Текст задачи').click();
  await page.getByRole('button', { name: 'Изменить' }).waitFor().catch(() => {});
  await expect(page.locator('.note-view a[href^="tel:"]')).toHaveAttribute('href', 'tel:+78461234567');
  await expect(page.locator('.note-view a[href^="https:"]')).toHaveAttribute('href', 'https://example.org/page');
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
  expect(await page.locator('.note-view img').count()).toBe(0);
});
