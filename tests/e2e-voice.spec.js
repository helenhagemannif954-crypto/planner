// Микрофон: только ручной старт и стоп; разбор свободной речи в поле ввода.
import { test, expect } from '@playwright/test';
import { start, dump } from './helpers.js';

const MON = new Date('2026-09-28T10:00:00+04:00');

// Заглушка распознавания: каждое «включение» браузер сам обрывает после паузы (onend),
// как это делает настоящий Chrome при тишине.
const fakeSpeech = () => {
  window.__sr = [];
  const phrases = ['позвонить маме', 'завтра в 18'];
  class FakeSR {
    constructor() { this.stopped = false; window.__sr.push(this); }
    start() {
      const n = window.__sr.length - 1;
      setTimeout(() => {
        if (this.stopped) return;
        if (phrases[n]) {
          const r = [{ transcript: phrases[n] }];
          r.isFinal = true;
          this.onresult({ resultIndex: 0, results: [r] });
        }
        // пауза в речи — браузер завершает сеанс сам
        setTimeout(() => { if (!this.stopped) { this.onerror && this.onerror({ error: 'no-speech' }); this.onend(); } }, 200);
      }, 100);
    }
    stop() { this.stopped = true; setTimeout(() => this.onend && this.onend(), 10); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
};

test('микрофон не завершает запись сам при паузах: один сеанс от нажатия до нажатия', async ({ page }) => {
  await page.addInitScript(fakeSpeech);
  await start(page);
  await page.getByRole('button', { name: 'Голосом' }).click();
  const stop = page.getByRole('button', { name: 'Стоп' });
  await expect(stop).toBeVisible();
  // браузер несколько раз сам обрывает распознавание — запись продолжается
  await page.waitForFunction(() => window.__sr.length >= 5);
  await expect(stop).toBeVisible();
  await expect(page.getByLabel('Новая задача')).toHaveValue('позвонить маме завтра в 18');
  await expect(page.getByLabel('Распознано')).toContainText('18:00');
  const opts = await page.evaluate(() => window.__sr.map((r) => [r.continuous, r.interimResults, r.lang]));
  for (const o of opts) expect(o).toEqual([true, true, 'ru-RU']);
  // выключается только нажатием «Стоп»
  await stop.click();
  await expect(stop).toHaveCount(0);
  const n = await page.evaluate(() => window.__sr.length);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__sr.length)).toBe(n);
  await expect(page.getByLabel('Новая задача')).toHaveValue('позвонить маме завтра в 18');
  await page.getByRole('button', { name: 'Добавить' }).click();
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Позвонить маме', date: '2026-09-25', time: '18:00' });
});

test('повторное нажатие на микрофон тоже останавливает запись', async ({ page }) => {
  await page.addInitScript(fakeSpeech);
  await start(page);
  await page.getByRole('button', { name: 'Голосом' }).click();
  await page.waitForFunction(() => window.__sr.length >= 2);
  await page.getByRole('button', { name: 'Остановить запись' }).click();
  await expect(page.getByRole('button', { name: 'Стоп' })).toHaveCount(0);
  const n = await page.evaluate(() => window.__sr.length);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__sr.length)).toBe(n);
});

test('«дежурство … с 16:00 до четверга 16:00, запиши в повторяющиеся» → постоянный блок пн → чт', async ({ page }) => {
  await start(page, { now: MON });
  const inp = page.getByLabel('Новая задача');
  await inp.click();
  await inp.fill('дежурство в семинарии с 16:00 до четверга 16:00, запиши в повторяющиеся');
  const chips = page.getByLabel('Распознано');
  await expect(chips).toContainText('«Дежурство в семинарии»');
  await expect(chips).toContainText('Семинария и школы');
  await expect(chips).toContainText('с 16:00');
  await expect(chips).toContainText('до чт, 1 октября 16:00');
  await expect(chips).toContainText('постоянный блок: пн 16:00 → чт 16:00');
  await inp.press('Enter');
  await expect(page.locator('.toast')).toContainText('Постоянный блок');
  const d = await dump(page);
  expect(d.data.tasks.length).toBe(0);
  const b = d.data.meta.blocks[0];
  expect(b).toMatchObject({ title: 'Дежурство в семинарии', dow: 1, start: '16:00', end: '16:00', endDays: 3 });
  expect(d.data.areas.find((a) => a.id === b.areaId).name).toBe('Семинария и школы');
  const load = await page.evaluate(async () => { const st = await import(location.origin + '/js/store.js'); return ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((x) => st.loadOf(x).min); });
  expect(load).toEqual([480, 1440, 1440, 960, 0]);
});

test('фишку «постоянный блок» можно одним касанием сменить на повторяющуюся задачу', async ({ page }) => {
  await start(page, { now: MON });
  const inp = page.getByLabel('Новая задача');
  await inp.click();
  await inp.fill('приём с 10 до 12, каждый вторник');
  const chips = page.getByLabel('Распознано');
  await expect(chips).toContainText('постоянный блок: вт 10:00–12:00');
  await chips.getByRole('button', { name: /постоянный блок/ }).click();
  await page.getByRole('button', { name: 'Повторяющаяся задача' }).click();
  await expect(chips).toContainText('каждый вт');
  await inp.press('Enter');
  const d = await dump(page);
  expect(d.data.meta.blocks).toEqual([]);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Приём', date: '2026-09-29', time: '10:00', dur: 120, repeat: { kind: 'weekly', days: [2] } });
});

test('разовая задача с диапазоном: начало и окончание, окончание правится фишкой', async ({ page }) => {
  await start(page, { now: MON });
  const inp = page.getByLabel('Новая задача');
  await inp.click();
  await inp.fill('встреча с деканом завтра с трёх до пяти');
  const chips = page.getByLabel('Распознано');
  await expect(chips).toContainText('с 15:00');
  await expect(chips).toContainText('до 17:00');
  await chips.getByRole('button', { name: 'до 17:00' }).click();
  await page.getByRole('button', { name: '2026-09-29' }).click();
  await page.getByRole('button', { name: '18:00', exact: true }).click();
  await expect(chips).toContainText('до 18:00');
  await inp.press('Enter');
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Встреча с деканом', date: '2026-09-29', time: '15:00', dur: 180 });
});

test('окончание без начала — срок со временем', async ({ page }) => {
  await start(page, { now: MON });
  const inp = page.getByLabel('Новая задача');
  await inp.click();
  await inp.fill('сдать отчёт до 18:00');
  await expect(page.getByLabel('Распознано')).toContainText('срок сегодня до 18:00');
  await inp.press('Enter');
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Сдать отчёт', deadline: '2026-09-28', deadlineTime: '18:00', time: null });
});

// ——— как ведёт себя распознавание на Android: накопительные и повторные результаты ———
// Сценарий: для каждого сеанса — список событий; событие — массив результатов [текст, final?].
const scriptedSpeech = (sessions) => {
  window.__sr = [];
  const ev = (list) => {
    const results = list.map(([t, fin]) => { const r = [{ transcript: t }]; r.isFinal = !!fin; return r; });
    return { resultIndex: 0, results };
  };
  class FakeSR {
    constructor() { this.n = window.__sr.length; this.stopped = false; window.__sr.push(this); }
    start() {
      const plan = sessions[this.n] || { events: [], end: true };
      plan.events.forEach((list, i) => setTimeout(() => { if (!this.stopped || plan.afterStop) this.onresult(ev(list)); }, 60 * (i + 1)));
      if (plan.end) setTimeout(() => { if (!this.stopped) this.onend(); }, 60 * (plan.events.length + 1) + 40);
      // поздний результат уже завершённого сеанса — должен игнорироваться
      if (plan.late) setTimeout(() => this.onresult(ev(plan.late)), 60 * (plan.events.length + 1) + 400);
    }
    stop() {
      this.stopped = true;
      const plan = sessions[this.n] || {};
      // Chrome присылает окончательный результат после stop(), затем onend
      setTimeout(() => { if (plan.finalOnStop) this.onresult(ev(plan.finalOnStop)); setTimeout(() => this.onend(), 20); }, 30);
    }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
};

test('Android: накопительные interim/final и повтор уже окончательных — без дублей; перезапуск не склеивает сеансы', async ({ page }) => {
  await page.addInitScript(scriptedSpeech, [
    {
      events: [
        [['купить', false]],
        [['купить молоко', false]],
        [['купить молоко', true]],
        [['купить молоко', true], ['купить молоко завтра', false]], // resultIndex 0: окончательный пришёл снова
        [['купить молоко', true], ['купить молоко завтра в 10', true]], // накопительный final
      ],
      end: true,
      late: [['купить молоко завтра в 10', true]],
    },
    // новый сеанс после обрыва: Android иногда повторяет последнюю фразу прошлого сеанса
    { events: [[['завтра в 10', false]], [['завтра в 10', true]]], end: true },
    { events: [], end: false, finalOnStop: [] },
  ]);
  await start(page, { now: MON });
  await page.getByRole('button', { name: 'Голосом' }).click();
  const inp = page.getByLabel('Новая задача');
  await page.waitForFunction(() => window.__sr.length >= 3);
  await page.waitForTimeout(600); // поздний результат первого сеанса
  await expect(inp).toHaveValue('купить молоко завтра в 10');
  await page.getByRole('button', { name: 'Стоп' }).click();
  await expect(inp).toHaveValue('купить молоко завтра в 10');
  await page.getByRole('button', { name: 'Добавить' }).click();
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Купить молоко', date: '2026-09-29', time: '10:00' });
});

test('после «Стоп» окончательный результат заменяет показанный interim, а не дописывается к нему', async ({ page }) => {
  await page.addInitScript(scriptedSpeech, [
    { events: [[['позвонить в банк', false]], [['позвонить в банк завтра в', false]]], end: false, finalOnStop: [['позвонить в банк завтра в 11', true]] },
  ]);
  await start(page, { now: MON });
  await page.getByRole('button', { name: 'Голосом' }).click();
  const inp = page.getByLabel('Новая задача');
  await expect(inp).toHaveValue('позвонить в банк завтра в');
  await page.getByRole('button', { name: 'Стоп' }).click();
  await expect(inp).toHaveValue('позвонить в банк завтра в 11');
  await page.waitForTimeout(300);
  await expect(inp).toHaveValue('позвонить в банк завтра в 11');
  await page.getByRole('button', { name: 'Добавить' }).click();
  const d = await dump(page);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Позвонить в банк', date: '2026-09-29', time: '11:00' });
});

test('сохранение во время записи: текст берётся как есть, поздний результат не возвращается в пустое поле', async ({ page }) => {
  await page.addInitScript(scriptedSpeech, [
    { events: [[['встреча с врачом в пятницу в 15', false]]], end: false, finalOnStop: [['встреча с врачом в пятницу в 15', true]] },
  ]);
  await start(page, { now: MON });
  await page.getByRole('button', { name: 'Голосом' }).click();
  const inp = page.getByLabel('Новая задача');
  await expect(inp).toHaveValue('встреча с врачом в пятницу в 15');
  await page.getByRole('button', { name: 'Добавить' }).click();
  await page.waitForTimeout(300);
  await expect(inp).toHaveValue('');
  const d = await dump(page);
  expect(d.data.tasks).toHaveLength(1);
  expect(d.data.tasks[0]).toMatchObject({ text: 'Встреча с врачом', date: '2026-10-02', time: '15:00' });
});

test('дважды надиктованная фраза: в тексте задачи не остаются слова, ушедшие в дату и время', async ({ page }) => {
  await start(page, { now: MON });
  const inp = page.getByLabel('Новая задача');
  for (const [said, text] of [
    ['купить молоко завтра в 10 купить молоко завтра в 10', 'Купить молоко'],
    ['Позвонить маме завтра в 18:00. Позвонить маме завтра в 18:00.', 'Позвонить маме'],
    ['забрать детей из школы завтра в 13:30. Завтра в 13:30', 'Забрать детей из школы'],
  ]) {
    await inp.click();
    await inp.fill(said);
    await expect(page.getByLabel('Распознано')).toContainText('«' + text + '»');
    await inp.press('Enter');
  }
  const d = await dump(page);
  expect(d.data.tasks.map((t) => t.text).sort()).toEqual(['Забрать детей из школы', 'Купить молоко', 'Позвонить маме']);
  for (const t of d.data.tasks) expect(t.text).not.toMatch(/завтра|\d/i);
});
