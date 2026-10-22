// PNG-иконки молитвослова из SVG: node molitvoslov/tools/make-icons.mjs (нужен Playwright).
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const dir = 'docs/molitvoslov/icons/';
const svg = readFileSync(dir + 'icon.svg', 'utf8');
const inner = svg.replace(/<svg[^>]*>|<\/svg>/g, '').replace(/<rect[^>]*\/>/, '');
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#f4ede1"/><g transform="translate(76.8 76.8) scale(.7)">${inner}</g></svg>`;
const jobs = [['icon-192.png', svg, 192], ['icon-512.png', svg, 512], ['maskable-512.png', maskable, 512]];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, src, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  writeFileSync(dir + name, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  console.log(dir + name);
}
await browser.close();
