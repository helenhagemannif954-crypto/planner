// Помянник: имена из списка звучат в прошениях; имя можно добавить прямо во время молитвы.
import { test, expect } from '@playwright/test';
import { open, errorsOf } from './helpers.mjs';

test('имена о живых и об усопших появляются в утренних прошениях', async ({ page }) => {
  const errors = errorsOf(page);
  await open(page, 'names');
  await page.getByLabel('О живых: новое имя').fill('Анна');
  await page.getByLabel('О живых: новое имя').press('Enter');
  await page.getByLabel('О живых: новое имя').fill('Пётр');
  await page.getByLabel('О живых: новое имя').press('Enter');
  await page.getByLabel('Об усопших: новое имя').fill('Мария');
  await page.getByLabel('Об усопших: новое имя').press('Enter');
  await expect(page.locator('.namelist-edit')).toContainText(['Анна', 'Мария']);
  // порядок можно менять
  await page.getByRole('button', { name: 'Выше: Пётр' }).click();
  await expect(page.locator('.namelist-edit').first().locator('.nm').first()).toHaveText('Пётр');

  await open(page, 'pray/morning/normal');
  const box = page.locator('.pray .block.intercession');
  await expect(box).toContainText('Господи, вот те, кого Ты дал мне любить:');
  await expect(box).toContainText('Пётр');
  await expect(box).toContainText('Анна');
  await expect(box).toContainText('Мария');
  expect(errors).toEqual([]);
});

test('пустой помянник — общая строка без списка', async ({ page }) => {
  await open(page, 'pray/morning/normal');
  await expect(page.locator('.pray .block.intercession')).toContainText('Господи, сохрани тех, кого Ты дал мне любить');
});

test('имя, добавленное во время молитвы, сохраняется в помяннике', async ({ page }) => {
  await open(page, 'pray/morning/normal');
  await page.locator('.pray .block.intercession .addname').first().click();
  await page.getByLabel('Имя о здравии').fill('Николай');
  await page.getByLabel('Имя о здравии').press('Enter');
  await expect(page.locator('.pray .block.intercession')).toContainText('Николай');
  await open(page, 'names');
  await expect(page.locator('.namelist-edit').first()).toContainText('Николай');
});
