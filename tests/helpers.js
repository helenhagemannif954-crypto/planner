// Общие помощники для тестов.
export const NOW = new Date('2026-09-24T10:00:00+04:00'); // четверг

export async function start(page, { now = NOW, onboard = true, name = 'Тест', url = '/' } = {}) {
  page.on('pageerror', (e) => { throw e; });
  await page.clock.install({ time: now });
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true);
  if (onboard) await onboard_(page, name);
}

export async function onboard_(page, name = 'Тест', contacts = []) {
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Дальше' }).click();
  for (const c of contacts) {
    await page.getByLabel('Имя контакта').fill(c);
    await page.getByRole('button', { name: 'Добавить контакт' }).click();
  }
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Готово' }).click();
  await page.getByRole('navigation', { name: 'Разделы' }).waitFor();
}

/** Быстрый ввод через поле внизу. */
export async function add(page, text) {
  const inp = page.getByLabel('Новая задача');
  await inp.click();
  await inp.fill(text);
  await inp.press('Enter');
  // дождаться записи в IndexedDB: тесты часто сразу перезагружают страницу
  await page.evaluate(async () => (await import(new URL('js/store.js', document.baseURI).href)).flush()).catch(() => {});
}

export async function tab(page, name) {
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name }).click();
}

/** Данные приложения из IndexedDB. */
export async function dump(page) {
  return page.evaluate(async () => {
    const db = await import(location.origin + '/js/db.js');
    const st = await import(location.origin + '/js/store.js');
    await st.flush();
    return db.dump();
  });
}
