// «Псалмы на всякую нужду»: раздел в меню, группы, касание — сразу текст псалма.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { open, errorsOf, expectNoHorizontalScroll } from './helpers.mjs';

const needs = JSON.parse(readFileSync(new URL('../../docs/molitvoslov/content/needs.json', import.meta.url)));

test('раздел «Псалмы» в нижней панели: группы, псалмы с одной строкой, касание открывает псалом', async ({ page }) => {
  const errors = errorsOf(page);
  await open(page, 'now');
  await page.locator('.tabs').getByRole('button', { name: 'Псалмы' }).click();
  await expect(page.locator('.content')).toContainText('Псалмы на всякую нужду');
  await expect(page.locator('.content .list .row')).toHaveCount(needs.groups.length);
  await expectNoHorizontalScroll(page);
  for (const g of needs.groups) {
    await open(page, 'need/' + g.id);
    await expect(page.locator('.top h1')).toHaveText(g.title);
    const rows = page.locator('.content .list .row');
    await expect(rows).toHaveCount(g.items.length);
    for (let i = 0; i < g.items.length; i++) await expect(rows.nth(i)).toContainText(g.items[i].line);
  }
  // касание — сразу текст псалма
  const g = needs.groups[0];
  await open(page, 'need/' + g.id);
  await page.locator('.content .list .row').first().click();
  await page.waitForFunction((n) => location.hash === '#read/psalm/' + n, g.items[0].n);
  expect(await page.locator('.verse').count()).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test('нижняя панель из шести разделов помещается на узком экране без обрезанных подписей', async ({ page }) => {
  for (const width of [320, 380]) {
    await page.setViewportSize({ width, height: 700 });
    await open(page, 'needs');
    await expectNoHorizontalScroll(page);
    const cut = await page.locator('.tabs button').evaluateAll((bs) => bs.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
    expect(cut, `ширина ${width}`).toEqual([]);
  }
});
