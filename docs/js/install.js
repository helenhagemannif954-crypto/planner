// Установка на рабочий стол: регистрация service worker, событие beforeinstallprompt
// и самопроверка условий установки (журнал в консоли и экран в настройках).
export const install = { prompt: null, promptAt: null, installed: false, swScope: null, swError: null, log: [] };

export function log(msg) {
  install.log.push({ at: new Date().toISOString(), msg });
  if (install.log.length > 50) install.log.shift();
  console.info('[установка] ' + msg);
}

window.addEventListener('beforeinstallprompt', (e) => {
  // не подавляем стандартное предложение браузера, но сохраняем событие для кнопки в настройках
  install.prompt = e;
  install.promptAt = new Date().toISOString();
  log('beforeinstallprompt: браузер готов установить приложение');
});
window.addEventListener('appinstalled', () => { install.installed = true; install.prompt = null; log('appinstalled: приложение установлено'); });

/** Регистрация service worker с тем же относительным scope, что и в манифесте. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) { install.swError = 'браузер не поддерживает service worker'; log(install.swError); return Promise.resolve(null); }
  if (location.protocol === 'file:') return Promise.resolve(null);
  return navigator.serviceWorker.register('sw.js', { scope: './' }).then((reg) => {
    if (!reg) throw new Error('браузер не вернул регистрацию');
    install.swScope = reg.scope;
    log('service worker зарегистрирован, scope ' + reg.scope);
    return reg;
  }).catch((e) => {
    install.swError = String((e && e.message) || e);
    log('service worker НЕ зарегистрирован: ' + install.swError);
    return null;
  });
}

export const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
export function browserName() {
  const ua = navigator.userAgent;
  if (/YaBrowser|YaApp|YandexSearch/i.test(ua)) return 'yandex';
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/; wv\)|Telegram|WhatsApp|Instagram|FBAN|FBAV|VKClient|Viber/i.test(ua)) return 'inapp';
  if (/Firefox/i.test(ua)) return 'firefox';
  if (/Chrome/i.test(ua)) return 'chrome';
  return 'other';
}

/** Проверка условий установки. Возвращает [{ok, label, detail}]. */
export async function checkInstall() {
  const res = [];
  const add = (ok, label, detail = '') => res.push({ ok, label, detail });
  add(window.isSecureContext, 'Защищённое соединение (https)', window.isSecureContext ? '' : 'Установка работает только по https.');
  const link = document.querySelector('link[rel="manifest"]');
  const rawHref = link && link.getAttribute('href');
  add(!!link && !!rawHref && !/^\/|^https?:/i.test(rawHref), 'Манифест подключён относительным путём', rawHref || 'нет <link rel="manifest">');
  let manifest = null, murl = null;
  if (link) {
    murl = new URL(rawHref, location.href);
    try {
      const r = await fetch(murl, { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      manifest = await r.json();
      add(true, 'Манифест загружается', murl.pathname);
    } catch (e) { add(false, 'Манифест загружается', murl.pathname + ': ' + e.message); }
  }
  if (manifest) {
    const here = new URL('./', location.href).href;
    const scope = new URL(manifest.scope || './', murl).href;
    const start = new URL(manifest.start_url || './', murl).href;
    add(!/^\//.test(manifest.scope || '') && !/^\//.test(manifest.start_url || ''), 'start_url и scope относительные', (manifest.start_url || '') + ' · ' + (manifest.scope || ''));
    add(start.startsWith(scope) && here.startsWith(scope), 'start_url и scope совпадают с адресом сайта', scope);
    add(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display), 'display: standalone', manifest.display || 'не указан');
    add(!!(manifest.name || manifest.short_name), 'Название приложения', manifest.short_name || manifest.name || '');
    const icons = manifest.icons || [];
    const png = (s) => icons.find((i) => (i.sizes || '').split(/\s+/).includes(s) && /png/.test(i.type || i.src));
    add(!!png('192x192'), 'Иконка 192×192');
    add(!!png('512x512'), 'Иконка 512×512');
    add(icons.some((i) => (i.purpose || '').includes('maskable')), 'Иконка с purpose: maskable');
    for (const i of icons) {
      try {
        const r = await fetch(new URL(i.src, murl), { cache: 'no-cache' });
        if (!r.ok) add(false, 'Иконка загружается', i.src + ': HTTP ' + r.status);
      } catch (e) { add(false, 'Иконка загружается', i.src + ': ' + e.message); }
    }
  }
  let reg = null;
  try { reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null; } catch { /* нет */ }
  add(!!reg, 'Service worker зарегистрирован', reg ? reg.scope : install.swError || 'нет регистрации');
  if (reg && manifest) add(reg.scope === new URL(manifest.scope || './', murl).href, 'Scope service worker совпадает с манифестом', reg.scope);
  add(!!(reg && reg.active), 'Service worker активен', reg && reg.active ? reg.active.state : 'ещё не активирован — обновите страницу');
  add(location.protocol === 'https:' || location.hostname === 'localhost' ? ![...document.querySelectorAll('[src],[href]')].some((el) => /^http:/i.test(el.getAttribute('src') || el.getAttribute('href') || '')) : false, 'Нет смешанного содержимого (http на https-странице)');
  return res;
}

/** Через несколько секунд после запуска пишем в консоль, что мешает установке. */
export function logInstallState() {
  setTimeout(async () => {
    if (standalone()) { log('запущено как установленное приложение'); return; }
    const list = await checkInstall();
    const bad = list.filter((x) => !x.ok);
    if (bad.length) for (const b of bad) log('не выполнено: ' + b.label + (b.detail ? ' — ' + b.detail : ''));
    else log('все условия установки выполнены' + (install.prompt ? '' : '; beforeinstallprompt пока не пришёл — Chrome ждёт, пока с сайтом немного поработают (касание и ~30 секунд), или приложение уже установлено'));
  }, 4000);
}
