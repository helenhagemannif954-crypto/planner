"""Вписывает текст Синодального перевода в docs/molitvoslov/content/scripture.json.

Запуск (из корня репозитория):
  python3 molitvoslov/tools/fill_scripture.py ПУТЬ/К/ru_synod.json [ПУТЬ/К/plan-*.txt ...]

ru_synod.json — Синодальный перевод из репозитория thiagobodruk/bible (файл json/ru_synod.json).
Если переданы файлы plan-*.txt, план чтений собирается из них заново (формат — в molitvoslov/README.md),
иначе обновляется текст у уже существующих отрывков.

Что делает:
  * у каждого отрывка (plan, special, readingPools) по полю ref заполняет book, chapter, verses
    ([[глава, стих, текст], …]);
  * для всех ссылок из пулов стихов (pools) и стихов тем (themes.json) заполняет verses
    {ref: текст}; ссылки на псалмы («Пс …») пропускает — они берутся из нашей Псалтири;
  * проверяет, что каждая ссылка существует.
Текст не правится: убираются только квадратные скобки вставных слов и пометы «Слава:»;
на границах отрывка первая буква делается заглавной, а последний знак — точкой.
"""
import json, re, sys, os

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
CONTENT = os.path.join(ROOT, 'docs', 'molitvoslov', 'content')

BOOKS = {
    'Быт': 'gn', 'Исх': 'ex', 'Лев': 'lv', 'Чис': 'nm', 'Втор': 'dt', 'Нав': 'js', 'Суд': 'jz', 'Руф': 'rt',
    '1 Цар': '1sm', '2 Цар': '2sm', '3 Цар': '1rs', '4 Цар': '2rs', '1 Пар': '1cr', '2 Пар': '2cr',
    'Езд': 'ed', 'Неем': 'ne', 'Иов': 'jó', 'Пс': 'sl', 'Притч': 'pv', 'Еккл': 'ec', 'Песн': 'ct',
    'Ис': 'is', 'Иер': 'jr', 'Плач': 'lm', 'Иез': 'ez', 'Ос': 'os', 'Иоил': 'jl', 'Ам': 'am', 'Авд': 'ob',
    'Ион': 'jn', 'Мих': 'mq', 'Наум': 'na', 'Авв': 'hc', 'Соф': 'sf', 'Агг': 'ag', 'Зах': 'zc', 'Мал': 'ml',
    'Мф': 'mt', 'Мк': 'mc', 'Лк': 'lc', 'Ин': 'jo', 'Деян': 'atos', 'Рим': 'rm', '1 Кор': '1co', '2 Кор': '2co',
    'Гал': 'gl', 'Еф': 'ef', 'Флп': 'fp', 'Кол': 'cl', '1 Фес': '1ts', '2 Фес': '2ts', '1 Тим': '1tm',
    '2 Тим': '2tm', 'Тит': 'tt', 'Флм': 'fm', 'Евр': 'hb', 'Иак': 'tg', '1 Пет': '1pe', '2 Пет': '2pe',
    '1 Ин': '1jo', '2 Ин': '2jo', '3 Ин': '3jo', 'Иуд': 'jd', 'Откр': 'ap',
}
BOOK_TITLES = {
    'Быт': 'Бытие', 'Исх': 'Исход', 'Чис': 'Числа', 'Втор': 'Второзаконие', 'Руф': 'Книга Руфи',
    '1 Цар': 'Первая книга Царств', '3 Цар': 'Третья книга Царств', '4 Цар': 'Четвёртая книга Царств',
    'Ис': 'Книга пророка Исаии', 'Иер': 'Книга пророка Иеремии', 'Плач': 'Плач Иеремии',
    'Иез': 'Книга пророка Иезекииля', 'Ос': 'Книга пророка Осии', 'Ион': 'Книга пророка Ионы',
    'Мих': 'Книга пророка Михея', 'Мф': 'Евангелие от Матфея', 'Мк': 'Евангелие от Марка',
    'Лк': 'Евангелие от Луки', 'Ин': 'Евангелие от Иоанна', 'Деян': 'Деяния апостолов',
    'Рим': 'Послание к Римлянам', '1 Кор': 'Первое послание к Коринфянам', '2 Кор': 'Второе послание к Коринфянам',
    'Гал': 'Послание к Галатам', 'Еф': 'Послание к Ефесянам', 'Флп': 'Послание к Филиппийцам',
    'Кол': 'Послание к Колоссянам', '1 Фес': 'Первое послание к Фессалоникийцам', 'Евр': 'Послание к Евреям',
    'Иак': 'Послание Иакова', '1 Пет': 'Первое послание Петра', '1 Ин': 'Первое послание Иоанна',
    'Откр': 'Откровение Иоанна', 'Еккл': 'Книга Екклесиаста', 'Иов': 'Книга Иова', 'Притч': 'Притчи',
}

REF = re.compile(r'^((?:[1-4] )?[А-Яа-яё]+) (\d+):(\d+)(?:[–-](?:(\d+):)?(\d+))?$')


def clean(t):
    t = t.replace('[', '').replace(']', '').replace('|', ' ')
    t = re.sub(r'\s*Слава:\s*$', '', t)
    t = re.sub(r'\s*Начальнику хора[^.]*\.?\s*$', '', t)  # певческая помета в конце Авв 3:19
    t = re.sub(r'\s+([.,;:!?])', r'\1', t)
    return re.sub(r'\s+', ' ', t).strip()


def quote(t):
    """Стих как отдельная цитата: с заглавной буквы и с точкой в конце (знаки внутри не трогаются)."""
    t = t.strip()
    t = re.sub(r'[,;:—–-]+$', '', t).rstrip()
    if t and t[-1] not in '.!?…»':
        t += '.'
    return t[:1].upper() + t[1:]


def verses(syn, ref):
    m = REF.match(ref)
    if not m:
        raise SystemExit('Не разобрана ссылка: ' + ref)
    book, c1, v1, c2, v2 = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4), m.group(5)
    if book not in BOOKS:
        raise SystemExit('Неизвестная книга: ' + ref)
    ab = BOOKS[book]
    if ab not in syn:
        raise SystemExit(f'В источнике нет книги {book} ({ref})')
    chs = syn[ab]['chapters']
    c2 = int(c2) if c2 else c1
    v2 = int(v2) if v2 else v1
    out = []
    for c in range(c1, c2 + 1):
        if c > len(chs):
            raise SystemExit('Нет главы: ' + ref)
        vs = chs[c - 1]
        a = v1 if c == c1 else 1
        b = v2 if c == c2 else len(vs)
        if b > len(vs):
            raise SystemExit(f'Нет стиха: {ref} (в главе {c} всего {len(vs)})')
        for n in range(a, b + 1):
            out.append([c, n, clean(vs[n - 1])])
    return book, c1, out


def parse_plan(paths):
    plan = []
    cur = None
    for path in paths:
        for raw in open(path, encoding='utf-8'):
            line = raw.strip()
            if not line or line.startswith('//'):
                continue
            if line.startswith('?'):
                cur['q'].append(line[1:].strip())
                continue
            parts = [x.strip() for x in line.split('|')]
            cur = {'ref': parts[0], 'title': parts[1] if len(parts) > 1 else '', 'key': parts[2] if len(parts) > 2 else '', 'q': []}
            plan.append(cur)
    for i, p in enumerate(plan):
        p['id'] = 'r%03d' % (i + 1)
    return plan


def fill_passage(syn, p):
    book, ch, vs = verses(syn, p['ref'])
    p['book'] = book
    p['chapter'] = ch
    if not p.get('key'):
        p['key'] = f'{vs[0][0]}:{vs[0][1]}'
    elif ':' not in str(p['key']):
        p['key'] = f'{ch}:{p["key"]}'
    kc, kn = map(int, str(p['key']).split(':'))
    if not any(v[0] == kc and v[1] == kn for v in vs):
        raise SystemExit(f'Ключевой стих {p["key"]} вне отрывка {p["ref"]}')
    # границы отрывка: первая буква заглавная, в конце — точка (как в чтениях за богослужением)
    vs[0][2] = vs[0][2][:1].upper() + vs[0][2][1:]
    vs[-1][2] = re.sub(r'[,;:—–-]+$', '', vs[-1][2]).rstrip()
    if vs[-1][2][-1:] not in ('.', '!', '?', '…', '»', ')'):
        vs[-1][2] += '.'
    p['verses'] = vs


def main():
    syn = {x['abbrev']: x for x in json.load(open(sys.argv[1], encoding='utf-8-sig'))}
    path = os.path.join(CONTENT, 'scripture.json')
    data = json.load(open(path, encoding='utf-8'))
    if len(sys.argv) > 2:
        data['plan'] = parse_plan(sys.argv[2:])
    for p in data['plan']:
        fill_passage(syn, p)
    for lst in data.get('special', {}).values():
        for p in lst:
            fill_passage(syn, p)
    for lst in data.get('readingPools', {}).values():
        for p in lst:
            fill_passage(syn, p)
    # стихи из пулов и тем
    refs = set()
    def walk(o):
        if isinstance(o, dict):
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
        elif isinstance(o, str) and REF.match(o):
            refs.add(o)
    walk(data.get('pools', {}))
    themes = json.load(open(os.path.join(CONTENT, 'themes.json'), encoding='utf-8'))
    for t in themes['themes']:
        refs.add(t['verse'])
    out = {}
    for ref in sorted(refs):
        if ref.startswith('Пс '):
            continue
        _, _, vs = verses(syn, ref)
        out[ref] = quote(' '.join(v[2] for v in vs))
    data['verses'] = out
    data['books'] = {k: v for k, v in BOOK_TITLES.items()}
    json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    n = len(data['plan'])
    print(f'план: {n} отрывков; особых: {sum(len(x) for x in data.get("special", {}).values())}; стихов в пулах: {len(out)}')


if __name__ == '__main__':
    main()
