import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 45000,
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'ru-RU',
    timezoneId: 'Europe/Samara',
    viewport: { width: 380, height: 800 },
    serviceWorkers: 'block',
  },
  webServer: [
    { command: 'node tools/serve.mjs 4173', url: 'http://localhost:4173', reuseExistingServer: true },
    // как на GitHub Pages: сайт в подпапке /planner/
    { command: 'node tools/serve.mjs 4174 /planner/', url: 'http://localhost:4174/planner/', reuseExistingServer: true },
  ],
});
