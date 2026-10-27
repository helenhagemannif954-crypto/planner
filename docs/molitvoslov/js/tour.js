// Знакомство с молитвословом: несколько экранов при первом открытии (и по «Как пользоваться»
// в настройках). Листаются свайпом (прокрутка с привязкой) или кнопкой «Далее».

import { h } from './util.js';

// рисунки — тонкие линии цвета текста, акцент — красный, как рубрики
const svg = (body, label) => h('div', { class: 'tour-art', role: 'img', 'aria-label': label, html: `<svg viewBox="0 0 160 120" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>` });

// настоящий фрагмент интерфейса — неактивный, только показать
const sample = (...nodes) => h('div', { class: 'tour-art tour-ui', 'aria-hidden': 'true', inert: true }, nodes);

const SLIDES = [
  {
    title: 'Молитвослов Древней Церкви',
    text: 'Псалмы, гимны и молитвы христиан первых веков — на современном русском языке.',
    art: () => svg(`
      <path d="M40 92 h80" />
      <path d="M58 92 c0-14 10-20 22-20 s22 6 22 20" />
      <path d="M80 72 v-7" />
      <path class="accent" d="M80 65 c-7-8-5-17 0-26 c5 9 7 18 0 26 z" />
      <path d="M50 100 h60" opacity=".5" />`, 'Светильник'),
  },
  {
    title: 'Молитва по времени',
    text: 'На экране «Сейчас» уже ждёт молитва, подходящая к этому часу: утром — утренняя, вечером — вечерняя.',
    art: () => svg(`
      <path d="M22 92 h116" />
      <path d="M30 92 a50 50 0 0 1 100 0" stroke-dasharray="3 6" opacity=".6" />
      <circle class="accent" cx="44" cy="62" r="9" />
      <path class="accent" d="M44 44 v-6 M44 86 v-4 M26 62 h-6 M68 62 h-6 M31 49 l-4-4 M57 49 l4-4" />
      <path d="M124 52 a12 12 0 1 1-14-14 a9 9 0 0 0 14 14 z" />`, 'Солнце и месяц'),
  },
  {
    title: 'Как вы сейчас',
    text: 'Если нет сил или на душе тяжело — выберите «Нет сил» или «Тяжело». Любой из трёх вариантов — полноценная молитва.',
    art: () => sample(h('div', { class: 'maincard' },
      h('p', { class: 'kicker' }, 'Сейчас'), h('h2', {}, 'Утро'),
      h('div', { class: 'states' }, h('span', { class: 'btn primary' }, 'Начать'), h('span', { class: 'btn hl' }, 'Нет сил'), h('span', { class: 'btn hl' }, 'Тяжело')))),
  },
  {
    title: 'Каждый день по-новому',
    text: 'Молитвы и псалмы сменяются день ото дня. Коснитесь текста — можно взять другую молитву или сохранить в избранное.',
    art: () => sample(h('div', { class: 'tour-text' },
      h('p', { class: 'rubric' }, 'Молитва'),
      h('p', { class: 'tour-lines' }, 'Свет тихий святой славы', h('br'), 'бессмертного Отца Небесного…'),
      h('div', { class: 'acts' }, h('span', { class: 'act hl' }, 'Другая'), h('span', { class: 'act hl' }, '☆ В избранное')))),
  },
  {
    title: 'Писание',
    text: 'Прочитать отрывок, побыть с вопросом в тишине — и прочитать ещё раз, медленно.',
    art: () => svg(`
      <path d="M80 40 c-14-8-32-9-48-4 v52 c16-5 34-4 48 4 c14-8 32-9 48-4 v-52 c-16-5-34-4-48 4 z" />
      <path d="M80 40 v52" />
      <path d="M42 50 h26 M42 60 h26 M42 70 h20 M92 50 h26 M92 60 h26 M92 70 h18" opacity=".5" />
      <circle cx="132" cy="96" r="12" opacity=".35" />
      <path class="accent" d="M132 84 a12 12 0 0 1 12 12" />`, 'Открытая книга и тихий круг тишины'),
  },
  {
    title: 'Ваши слова',
    text: 'В молитве есть паузы для своих слов, а имена из помянника звучат в молитве о близких. Тема седмицы, помянник и настройки — всегда под рукой.',
    art: () => svg(`
      <path d="M30 34 h100 a8 8 0 0 1 8 8 v36 a8 8 0 0 1-8 8 h-62 l-18 14 v-14 h-20 a8 8 0 0 1-8-8 v-36 a8 8 0 0 1 8-8 z" />
      <circle class="accent fill" cx="62" cy="60" r="3" />
      <circle class="accent fill" cx="80" cy="60" r="3" />
      <circle class="accent fill" cx="98" cy="60" r="3" />`, 'Пауза для своих слов'),
  },
];

let open = null;

/** Показать знакомство. onStart — что сделать по «Начать молитву». */
export function showTour({ onStart } = {}) {
  if (open) return open;
  const track = h('div', { class: 'tour-track' });
  const dots = h('div', { class: 'tour-dots', 'aria-hidden': 'true' });
  SLIDES.forEach((s, i) => {
    track.append(h('section', { class: 'tour-slide', 'aria-roledescription': 'слайд', 'aria-label': `${i + 1} из ${SLIDES.length}` },
      s.art(), h('h2', {}, s.title), h('p', {}, s.text)));
    dots.append(h('span', { class: i === 0 ? 'on' : '' }));
  });
  const next = h('button', { type: 'button', class: 'btn primary tour-next' }, 'Далее');
  const skip = h('button', { type: 'button', class: 'btn quiet tour-skip' }, 'Пропустить');
  const box = h('div', { class: 'tour', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Знакомство с молитвословом', tabindex: '-1' },
    skip, track, h('div', { class: 'tour-foot' }, dots, next));

  const index = () => Math.round(track.scrollLeft / (track.clientWidth || 1));
  const last = () => index() >= SLIDES.length - 1;
  const update = () => {
    const i = index();
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    next.textContent = last() ? 'Начать молитву' : 'Далее';
  };
  const goTo = (i) => track.scrollTo({ left: i * track.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const close = () => {
    box.remove();
    removeEventListener('keydown', keys);
    open = null;
  };
  const keys = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') goTo(Math.min(index() + 1, SLIDES.length - 1));
    else if (e.key === 'ArrowLeft') goTo(Math.max(index() - 1, 0));
  };
  track.addEventListener('scroll', update, { passive: true });
  skip.addEventListener('click', close);
  next.addEventListener('click', () => {
    if (!last()) return goTo(index() + 1);
    close();
    if (onStart) onStart();
  });
  addEventListener('keydown', keys);
  document.body.append(box);
  box.focus({ preventScroll: true });
  open = { close };
  return open;
}
