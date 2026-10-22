import { expect } from '@playwright/test';

/** Собирает ошибки страницы (исключения и console.error). */
export function errorsOf(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  return errors;
}

/** Открыть экран; now — «сейчас» в формате 2026-10-22T07:30. */
export async function open(page, hash = 'now', now = '2026-10-22T07:30') {
  await page.goto(`./?now=${now}#${hash}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  await page.waitForTimeout(150);
}

/** Текст всех блоков открытого чина. */
export async function officeText(page) {
  return page.evaluate(() => [...document.querySelectorAll('.pray .block, .pray section')].map((e) => e.innerText).join('\n'));
}

/** Нет горизонтальной прокрутки ни у страницы, ни у окна молитвы. */
export async function expectNoHorizontalScroll(page) {
  const over = await page.evaluate(() => [document.scrollingElement, document.querySelector('.pray')].filter(Boolean).map((e) => e.scrollWidth - e.clientWidth));
  for (const o of over) expect(o).toBeLessThanOrEqual(1);
}
