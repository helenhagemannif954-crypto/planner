// Рисует PNG-иконки из SVG (запуск: node tools/make-icons.mjs). Нужен Playwright.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('docs/icons/icon.svg', 'utf8');
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#2f6b5e"/><g transform="translate(76.8 76.8) scale(.7)">${svg.replace(/<svg[^>]*>|<\/svg>/g, '').replace(/<rect[^>]*\/>/, '')}</g></svg>`;
const sc = (path) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="46" fill="#2f6b5e"/><g transform="translate(24 24) scale(2)" fill="none" stroke="#f6f2ea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></g></svg>`;
const jobs = [
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
  ['maskable-512.png', maskable, 512],
  ['sc-add.png', sc('M12 5v14M5 12h14'), 96],
  ['sc-voice.png', sc('M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3'), 96],
  ['sc-today.png', sc('M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z'), 96],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, src, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync('docs/icons/' + name, buf);
  console.log('icons/' + name);
}
await browser.close();
