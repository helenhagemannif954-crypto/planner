// Стартовый набор: области, контексты, шаблоны. Всё редактируется в приложении.
// Никаких личных данных: только общие названия и примеры.

export const COLORS = ['#b4833f', '#5b7f95', '#7a6aa0', '#5f8a6a', '#a8674f', '#8a7a52', '#4f7f7a', '#9a6a86', '#6f7fa8', '#8b8b6b', '#b06f5a', '#6d8f4e'];

export function uid() {
  const a = new Uint8Array(9);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

export function seedAreas() {
  const list = [
    ['Собор и богослужения', 'heart', false, ['собор', 'служба', 'литургия', 'всенощная', 'богослужение', 'молебен', 'панихида', 'исповедь', 'требы', 'треба', 'венчание', 'отпевание', 'настоятель', 'ключарь', 'алтарь']],
    ['Консультирование', 'heart', true, ['консультирование', 'консультация', 'клиент', 'клиентка', 'супервизия', 'терапия', 'психолог']],
    ['Миссия', 'duty', false, ['миссия', 'миссионерский', 'огласительная', 'катехизация', 'катехизатор', 'беседа перед крещением']],
    ['Епархиальный отдел', 'duty', false, ['отдел', 'епархия', 'епархиальный', 'владыка', 'владыке', 'архиерей', 'епархиальное']],
    ['Ковчег жизни', 'duty', false, ['ковчег', 'грант', 'проект ковчег']],
    ['Семинария и школы', 'duty', false, ['семинария', 'семинаристы', 'школа', 'урок', 'пара', 'студенты', 'зачёт', 'экзамен']],
    ['Молодёжь', 'duty', false, ['молодёжь', 'молодёжный', 'молодёжное', 'молодёжка']],
    ['Блог и книги', 'duty', false, ['блог', 'книга', 'книгу', 'статья', 'рукопись', 'канал', 'публикация']],
    ['Семья', 'heart', false, ['семья', 'жена', 'дети', 'дочь', 'сын', 'родители', 'мама', 'папа']],
    ['Личное', 'duty', false, ['личное', 'здоровье', 'врач', 'спорт', 'прогулка', 'отпуск', 'зарядка']],
  ];
  const year = new Date().getFullYear();
  return list.map(([name, kind, priv, synonyms], i) => ({
    id: uid(), name, kind, private: priv, pinLock: false, synonyms, color: COLORS[i % COLORS.length],
    order: i, archived: false, endDate: name === 'Ковчег жизни' ? `${year}-12-31` : null,
  }));
}

export function seedContexts() {
  return [
    { id: uid(), name: 'Звонки', synonyms: ['позвонить', 'звонок', 'звонка', 'перезвонить', 'созвониться', 'набрать', 'позвони'] },
    { id: uid(), name: 'Компьютер', synonyms: ['компьютер', 'письмо', 'почта', 'распечатать', 'напечатать', 'таблица', 'презентация', 'отправить файл'] },
    { id: uid(), name: 'В городе', synonyms: ['купить', 'забрать', 'отвезти', 'заехать', 'аптека', 'магазин', 'банк', 'почта россии'] },
  ];
}

const off = (kind, n = 0) => ({ kind, n });
const step = (text, offset, size = 'S', extra = {}) => ({ id: uid(), text, offset, size, ctx: null, draft: '', rule: { kind: 'every' }, ...extra });

export function seedTemplates(areas) {
  const areaId = (name) => (areas.find((a) => a.name === name) || {}).id || null;
  return [
    {
      id: uid(), name: 'Сессия', areaId: areaId('Консультирование'), synonyms: ['сессия', 'консультация'],
      anchor: { label: 'Сессия', dur: 60 }, builtIn: true,
      steps: [
        step('Перечитать карточку клиента и план сессии', off('before_days', 1), 'S'),
        step('Проверить диктофон и запись', off('before_min', 15), 'S'),
        step('Транскрибировать и обезличить запись', off('same_day'), 'M'),
        step('Разбор транскрипта с Claude, получить план следующей сессии', off('same_day'), 'M', { draft: '', draftSlot: true }),
        step('Обновить карточку клиента', off('same_day'), 'M', { rule: { kind: 'nth', n: 3 } }),
        step('Отправить тесты', off('before_days', 1), 'S', { rule: { kind: 'first' } }),
      ],
    },
    {
      id: uid(), name: 'Лекция / выступление', areaId: null, synonyms: ['лекция', 'выступление', 'доклад'],
      anchor: { label: 'Выступление', dur: 90 }, builtIn: true,
      steps: [
        step('План выступления', off('before_days', 7), 'M'),
        step('Текст или тезисы', off('before_days', 2), 'L'),
        step('Перечитать', off('before_days', 1), 'S'),
        step('Заметки: что улучшить', off('after'), 'S'),
      ],
    },
    {
      id: uid(), name: 'Пост в блог', areaId: areaId('Блог и книги'), synonyms: ['пост в блог', 'статья в блог', 'запись в блог'],
      anchor: { label: 'Публикация', dur: 15 }, builtIn: true,
      steps: [
        step('Черновик', off('before_days', 3), 'M'),
        step('Правка', off('before_days', 1), 'M'),
        step('Ответить на комментарии', off('after_days', 1), 'S'),
      ],
    },
  ];
}
