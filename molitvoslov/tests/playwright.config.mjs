// Тесты молитвослова. Запуск из корня репозитория:
//   npx playwright test -c molitvoslov/tests/playwright.config.mjs
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  timeout: 45000,
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: {
    // как на GitHub Pages: /planner/molitvoslov/
    baseURL: 'http://localhost:4174/planner/molitvoslov/',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    viewport: { width: 380, height: 800 },
    serviceWorkers: 'block',
  },
  webServer: [{ command: 'node tools/serve.mjs 4174 /planner/', cwd: root, url: 'http://localhost:4174/planner/', reuseExistingServer: true }],
});
