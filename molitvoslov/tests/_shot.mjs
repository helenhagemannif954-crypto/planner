import { chromium } from '@playwright/test';
const [, , hash, out, now = '2026-10-27T07:30', h = '800'] = process.argv;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 380, height: +h }, locale: 'ru-RU', timezoneId: 'Europe/Moscow', serviceWorkers: 'block', deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`http://localhost:4174/planner/molitvoslov/?now=${now}#${hash}`); await page.waitForFunction(() => window.__ready === true); await page.waitForTimeout(400);
await page.screenshot({ path: out });
await b.close();
