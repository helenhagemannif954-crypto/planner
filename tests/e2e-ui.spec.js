// Внешний вид: 380px, светлая и тёмная тема; первый экран не перегружен. Снимки — в screens/.
import { test, expect } from '@playwright/test';
import { start, add, tab } from './helpers.js';

for (const scheme of ['light', 'dark']) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme, viewport: { width: 380, height: 800 } });

    test('снимки основных экранов', async ({ page }) => {
      await start(page, { name: 'о. Иоанн' });
      const shot = async (n) => { await page.evaluate(() => document.querySelector('.toast')?.classList.remove('show')); await page.waitForTimeout(250); await page.screenshot({ path: `screens/${scheme}-${n}.png` }); };
      await add(page, 'подготовить проповедь на воскресенье !');
      await add(page, 'позвонить в епархию сегодня в 15:00');
      await add(page, 'литургия сегодня в 17:00');
      await add(page, 'отчёт по гранту до 15.10');
      await add(page, 'разобрать почту сегодня');
      await add(page, 'купить свечи сегодня');
      await add(page, 'подготовить отчёт для отдела на этой неделе');
      await add(page, 'сессия с А.К. завтра в 18');
      await page.getByRole('button', { name: /Создать А.К./ }).click();
      await add(page, 'идея для лекции');
      await page.waitForTimeout(700);
      await shot('today');
      // первый экран: не больше 3 главных + 2 ближайших, остальное свёрнуто
      expect(await page.locator('#view .row').count()).toBeLessThanOrEqual(5);
      const txt = await page.locator('body').innerText();
      expect(txt).not.toMatch(/просроч|%/i);
      const inp = page.getByLabel('Новая задача');
      await inp.click();
      await inp.fill('позвонить владыке завтра в 15');
      await shot('compose');
      await inp.fill('');
      await page.keyboard.press('Escape');
      await tab(page, 'Входящие');
      await shot('inbox');
      await tab(page, 'План');
      await shot('week');
      await page.getByRole('button', { name: 'День', exact: true }).click();
      await shot('day');
      await page.getByRole('button', { name: 'Месяц', exact: true }).click();
      await shot('month');
      await page.getByRole('button', { name: 'Год', exact: true }).click();
      await shot('year');
      await tab(page, 'Области');
      await shot('areas');
      await page.locator('#view').getByRole('button', { name: /Консультирование/ }).click();
      await shot('area-private');
      await tab(page, 'Сегодня');
      await page.locator('#view .row', { hasText: 'Позвонить в епархию' }).locator('.t-main').click();
      await page.waitForTimeout(300);
      await shot('task');
    });
  });
}
