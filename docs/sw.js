// Service worker: кэш всего приложения. Данные (IndexedDB) он не трогает.
const VERSION = 'v8';
const CACHE = 'planner-' + VERSION;
const FILES = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/sc-add.png',
  'icons/sc-voice.png',
  'icons/sc-today.png',
  'js/app.js',
  'js/blocks.js',
  'js/chain.js',
  'js/church.js',
  'js/dates.js',
  'js/db.js',
  'js/ics.js',
  'js/install.js',
  'js/parse.js',
  'js/recur.js',
  'js/seed.js',
  'js/share.js',
  'js/store.js',
  'js/ui.js',
  'js/views/areas.js',
  'js/views/calendar.js',
  'js/views/common.js',
  'js/views/compose.js',
  'js/views/inbox.js',
  'js/views/matrix.js',
  'js/views/onboarding.js',
  'js/views/pickers.js',
  'js/views/plan.js',
  'js/views/review.js',
  'js/views/session.js',
  'js/views/settings.js',
  'js/views/share.js',
  'js/views/task.js',
  'js/views/today.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('planner-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // навигация (включая ?action=add, ?text=… от «Поделиться») — всегда оболочка приложения
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});
