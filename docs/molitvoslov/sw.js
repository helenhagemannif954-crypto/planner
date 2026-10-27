// Service worker молитвослова: всё приложение и все тексты — в кэше, работа без сети.
// Данные человека (localStorage) он не трогает.
const VERSION = 'm-d6761bbc7f';
const CACHE = 'molitvoslov-' + VERSION;
const FILES = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'fonts/literata-cyrillic-wght-normal.woff2',
  'fonts/literata-cyrillic-wght-italic.woff2',
  'fonts/literata-latin-wght-normal.woff2',
  'fonts/literata-latin-wght-italic.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'js/app.js',
  'js/calendar.js',
  'js/content.js',
  'js/ics.js',
  'js/office.js',
  'js/render.js',
  'js/store.js',
  'js/tour.js',
  'js/util.js',
  'content/psalms.json',
  'content/odes.json',
  'content/prayers.json',
  'content/scripture.json',
  'content/orders.json',
  'content/themes.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('molitvoslov-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (req.mode === 'navigate') return (await c.match('index.html')) || fetch(req);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});
