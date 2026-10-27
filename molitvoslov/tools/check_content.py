"""Проверка целостности содержимого молитвослова.

Запуск (из корня репозитория):
  python3 molitvoslov/tools/check_content.py

Проверяет:
  * у каждого текста есть source, century, translation_note и непустой text;
  * идентификаторы молитв не повторяются;
  * все ссылки на псалмы и песни (пулы чинов, темы, «Пс n:a–b» в стихах дня) существуют;
  * тексты, которые в source целиком ссылаются на псалом («Пс 144:15–16»), совпадают с нашей Псалтирью;
  * отрывки плана чтений: 3–12 стихов, 2–3 вопроса, ключевой стих внутри отрывка;
  * цитаты в «ёлочках» в вопросах к чтениям есть в тексте отрывка (с точностью до регистра,
    знаков и «ё»), не длиннее 12 слов, ни одно начало (три слова) не чаще 3 % вопросов.
Возвращает код 1, если найдена ошибка.
"""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
C = os.path.join(ROOT, 'docs', 'molitvoslov', 'content')
load = lambda n: json.load(open(os.path.join(C, n + '.json'), encoding='utf-8'))

errors, warnings = [], []
psalms = {p['n']: p for p in load('psalms')['psalms']}
odes = {o['id']: o for o in load('odes')['odes']}
prayers, orders, themes, scripture = load('prayers'), load('orders'), load('themes'), load('scripture')

PS = re.compile(r'^Пс (\d+):(\d+)(?:[–-](\d+))?$')

def psalm_lines(n, a, b):
    p = psalms.get(n)
    if not p:
        return None
    vs = [v for v in p['verses'] if a <= v['n'] <= b]
    if len(vs) != b - a + 1:
        return None
    return [l for v in vs for l in v['l']]

def check_ref(ref, where):
    m = PS.match(ref)
    if m:
        n, a = int(m.group(1)), int(m.group(2))
        b = int(m.group(3) or a)
        if psalm_lines(n, a, b) is None:
            errors.append(f'{where}: нет стихов {ref}')

norm = lambda s: re.sub(r'[^\wё]+', ' ', s.lower()).strip()

# молитвы
seen = set()
items = list(prayers['fixed'].items()) + [(x['id'], x) for x in prayers['pool']]
for pid, x in items:
    if pid in seen:
        errors.append(f'молитва {pid}: повтор id')
    seen.add(pid)
    for k in ('source', 'century', 'translation_note'):
        if k not in x:
            errors.append(f'молитва {pid}: нет поля {k}')
    if not x.get('text'):
        errors.append(f'молитва {pid}: пустой текст')
    m = PS.match(x.get('source', ''))
    if m:
        n, a = int(m.group(1)), int(m.group(2))
        lines = psalm_lines(n, a, int(m.group(3) or a))
        if lines is None:
            errors.append(f'молитва {pid}: нет стихов {x["source"]}')
        elif norm(' '.join(lines)) != norm(' '.join(t for t in x['text'] if t)):
            errors.append(f'молитва {pid}: текст расходится с Псалтирью ({x["source"]})\n    молитва: {" / ".join(x["text"])}\n    псалом:  {" / ".join(lines)}')

# пулы псалмов в чинах
for name, pool in orders['pools'].items():
    for it in pool:
        if isinstance(it, int):
            if it not in psalms:
                errors.append(f'пул {name}: нет псалма {it}')
        elif str(it).startswith('ode:'):
            if it[4:] not in odes:
                errors.append(f'пул {name}: нет песни {it}')

def walk_blocks(o, path):
    if isinstance(o, dict):
        if o.get('t') == 'psalm' and isinstance(o.get('n'), int) and o['n'] not in psalms:
            errors.append(f'{path}: нет псалма {o["n"]}')
        if o.get('t') == 'ode' and isinstance(o.get('id'), str) and o['id'] not in odes:
            errors.append(f'{path}: нет песни {o["id"]}')
        for k, v in o.items():
            walk_blocks(v, path + '.' + str(k))
    elif isinstance(o, list):
        for i, v in enumerate(o):
            walk_blocks(v, f'{path}[{i}]')
walk_blocks(orders['offices'], 'orders')

# темы
for t in themes['themes']:
    for n in t.get('psalms', []):
        if n not in psalms:
            errors.append(f'тема {t["id"]}: нет псалма {n}')
    check_ref(t['verse'], f'тема {t["id"]}')
    if not PS.match(t['verse']) and t['verse'] not in scripture['verses']:
        errors.append(f'тема {t["id"]}: стих {t["verse"]} не вписан (запустите fill_scripture.py)')

# стихи в пулах Писания
def walk_refs(o, path):
    if isinstance(o, dict):
        for k, v in o.items():
            walk_refs(v, path + '.' + k)
    elif isinstance(o, list):
        for v in o:
            walk_refs(v, path)
    elif isinstance(o, str):
        if PS.match(o):
            check_ref(o, path)
        elif re.match(r'^(?:[123] )?[А-Я][а-яё]+ \d+:\d+', o) and o not in scripture['verses']:
            errors.append(f'{path}: стих {o} не вписан (запустите fill_scripture.py)')
walk_refs(scripture['pools'], 'scripture.pools')

# план чтений
for p in scripture['plan']:
    n = len(p.get('verses', []))
    if not 3 <= n <= 12:
        errors.append(f'чтение {p["id"]} {p["ref"]}: {n} стихов')
    elif n > 10:
        warnings.append(f'чтение {p["id"]} {p["ref"]}: {n} стихов (больше десяти)')
    q = len(p.get('q', []))
    if not 2 <= q <= 3:
        errors.append(f'чтение {p["id"]} {p["ref"]}: {q} вопросов')
    if p.get('key') and p['key'] not in {f'{c}:{v}' for c, v, _ in p.get('verses', [])}:
        errors.append(f'чтение {p["id"]} {p["ref"]}: ключевой стих {p["key"]} вне отрывка')

# цитаты в вопросах — как в тексте отрывка
plain = lambda s: norm(s.replace('ё', 'е').replace('Ё', 'Е').replace('́', ''))  # ударения Синодального: «ка́к»
readings = scripture['plan'] + [p for g in scripture['special'].values() for p in g] + \
    [p for g in scripture['readingPools'].values() for p in g]
for p in readings:
    body = ' ' + plain(' '.join(v[2] for v in p.get('verses', []))) + ' '
    for q in p.get('q', []):
        for quote in re.findall(r'«([^»]+)»', q):
            for part in re.split(r'…|\.\.\.', quote):
                if plain(part) and ' ' + plain(part) + ' ' not in body:
                    errors.append(f'чтение {p["ref"]}: цитаты «{part.strip()}» нет в отрывке — {q}')
        if len(re.findall(r'[\wё]+', q)) > 12:
            errors.append(f'чтение {p["ref"]}: вопрос длиннее 12 слов — {q}')

# вопросы не начинаются одинаково: ни одно начало (первые три слова) — не чаще 3 % вопросов
starts = {}
for p in readings:
    for q in p.get('q', []):
        k = ' '.join(re.findall(r'[\wё]+', q.lower())[:3])
        starts[k] = starts.get(k, 0) + 1
total = sum(starts.values())
for k, n in sorted(starts.items(), key=lambda x: -x[1]):
    if n > total * 0.03:
        errors.append(f'вопросы: начало «{k}…» — {n} из {total} (больше 3 %)')

# «Псалмы на всякую нужду»: только вычитанные псалмы, 3–8 в группе, цитаты — дословно из Псалтири
needs = load('needs')
checked = set()
for l in open(os.path.join(ROOT, 'molitvoslov', 'source', 'checked-psalms.txt'), encoding='utf-8'):
    if l.strip() and not l.startswith('#'):
        checked |= {int(x) for x in re.findall(r'\b\d+\b', l.split(':', 1)[1])}
for g in needs['groups']:
    if not 3 <= len(g['items']) <= 8:
        errors.append(f'нужда {g["id"]}: {len(g["items"])} псалмов (нужно 3–8)')
    for x in g['items']:
        n = x['n']
        if n not in psalms:
            errors.append(f'нужда {g["id"]}: нет псалма {n}'); continue
        if n not in checked:
            errors.append(f'нужда {g["id"]}: Пс {n} ещё не вычитан (нет в checked-psalms.txt)')
        body = ' ' + plain(' '.join(l for v in psalms[n]['verses'] for l in v['l'])) + ' '
        for quote in re.findall(r'«([^»]+)»', x['line']):
            for part in re.split(r'…', quote):
                if plain(part) and ' ' + plain(part) + ' ' not in body:
                    errors.append(f'нужда {g["id"]}: цитаты «{part.strip()}» нет в Пс {n}')

for w in warnings:
    print('  ·', w)
for e in errors:
    print('  ✗', e)
print(f'псалмов {len(psalms)}, молитв {len(items)}, чтений {len(scripture["plan"])}; ошибок {len(errors)}, замечаний {len(warnings)}')
sys.exit(1 if errors else 0)
