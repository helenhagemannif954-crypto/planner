// Сетка времени с шагом 5 минут: выбор времени, лента дня, свободные окна.
import { test, expect } from '@playwright/test';
import { start, add, tab, dump, NOW } from './helpers.js';

const openPicker = async (page) => {
  await page.getByLabel('Новая задача').click();
  await page.getByLabel('Новая задача').fill('позвонить в типографию сегодня');
  await page.getByRole('button', { name: 'Время…' }).click();
  return page.getByRole('dialog', { name: 'Время' });
};

test('выбор времени: 12 кнопок на час с шагом 5 минут; можно выбрать 14:35', async ({ page }) => {
  await start(page);
  const dlg = await openPicker(page);
  const cells = dlg.locator('.tcell');
  await expect(cells).toHaveCount(18 * 12); // 06:00 … 23:55
  const labels = await dlg.locator('.thour[data-h="14"] .tcell').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(labels).toEqual(['14:00', '14:05', '14:10', '14:15', '14:20', '14:25', '14:30', '14:35', '14:40', '14:45', '14:50', '14:55']);
  await dlg.getByRole('button', { name: '14:35', exact: true }).click();
  await page.getByLabel('Новая задача').press('Enter');
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Позвонить в типографию', time: '14:35' });
});

for (const width of [320, 360, 380]) {
  test(`сетка на экране ширины ${width}: кнопки не мельче пальца, сетка прокручивается внутри листа`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 700 } });
    const page = await ctx.newPage();
    await start(page);
    const dlg = await openPicker(page);
    const grid = dlg.locator('.tgrid');
    await page.waitForTimeout(300);
    // все кнопки часа видимы целиком и не мельче 44×44 пикселей
    const sizes = await dlg.locator('.tcell').evaluateAll((els) => els.map((e) => [e.offsetWidth, e.offsetHeight]));
    for (const [w, hgt] of sizes) {
      expect(w).toBeGreaterThanOrEqual(43.5);
      expect(hgt).toBeGreaterThanOrEqual(44);
    }
    // сетка не сжата в экран, а прокручивается
    const sc = await grid.evaluate((g) => [g.scrollHeight, g.clientHeight, getComputedStyle(g).overflowY]);
    expect(sc[0]).toBeGreaterThan(sc[1] * 3);
    expect(sc[2]).toBe('auto');
    // лист целиком на экране
    const box = await dlg.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(700.5);
    // по умолчанию — к 9 часам; полоска часов переносит к нужному часу
    await expect(dlg.getByRole('button', { name: '09:00', exact: true })).toBeInViewport();
    await expect(dlg.getByRole('button', { name: 'К 9 ч' })).toHaveClass(/\bon\b/);
    await dlg.getByRole('button', { name: 'К 21 ч' }).click();
    await expect(dlg.getByRole('button', { name: '21:55', exact: true })).toBeInViewport();
    // полоска часов следует за сеткой
    await expect(dlg.getByRole('button', { name: 'К 21 ч' })).toHaveClass(/\bon\b/);
    await expect(dlg.getByRole('button', { name: 'К 21 ч' })).toBeInViewport();
    for (const hh of [6, 12, 23]) {
      const b = dlg.getByRole('button', { name: 'К ' + hh + ' ч' });
      await b.scrollIntoViewIfNeeded();
      const bb = await b.boundingBox();
      expect(bb.height).toBeGreaterThanOrEqual(44);
    }
    await dlg.getByRole('button', { name: '21:55', exact: true }).click();
    await expect(page.getByLabel('Распознано')).toContainText('21:55');
    await ctx.close();
  });
}

test('выбранное время видно сразу при открытии', async ({ page }) => {
  await start(page);
  await add(page, 'совещание сегодня в 19:40');
  const id = (await dump(page)).data.tasks[0].id;
  await page.evaluate(async (id) => { (await import(location.origin + '/js/views/task.js')).openTask(id); }, id);
  await page.getByRole('button', { name: /Время/ }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Время' });
  const sel = dlg.locator('.tcell.sel');
  await expect(sel).toHaveAttribute('aria-label', '19:40');
  await expect(sel).toBeInViewport();
});

test('свободные окна начинаются с ближайших 5 минут', async ({ page }) => {
  await start(page, { now: new Date('2026-09-24T10:02:00+04:00') });
  const w = await page.evaluate(async () => (await import(location.origin + '/js/store.js')).freeWindows('2026-09-24'));
  expect(w[0].start).toBe('10:05');
});

test('лента дня: перетаскивание ставит время с шагом 5 минут', async ({ page }) => {
  await start(page, { now: NOW });
  await add(page, 'подготовить отчёт сегодня');
  await tab(page, 'План');
  await page.getByRole('button', { name: 'День', exact: true }).click();
  const tl = page.locator('.timeline');
  await expect(tl).toBeVisible();
  const from = Number(await tl.getAttribute('data-from'));
  const handle = page.getByRole('button', { name: 'Перетащить на ленту' });
  await handle.scrollIntoViewIfNeeded();
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  // 18:37 → ближайшие 5 минут — 18:35
  const target = 18 * 60 + 37;
  // лента длиннее экрана: прокручиваем так, чтобы 18:37 оказалось посередине
  await tl.evaluate((el, y) => {
    const v = document.getElementById('view');
    v.scrollTop += el.getBoundingClientRect().top + y - v.getBoundingClientRect().top - v.clientHeight / 2;
  }, (target - from) * 1.1);
  const tb = await tl.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + (target - from) * 1.1, { steps: 8 });
  await page.mouse.up();
  const d = await dump(page);
  expect(d.data.tasks[0].time).toBe('18:35');
});
