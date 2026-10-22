"""Собирает docs/molitvoslov/content/psalms.json из рабочих файлов перевода.

Запуск (из корня репозитория):
  python3 molitvoslov/tools/build_psalms.py molitvoslov/source/psalms ПУТЬ/К/ru_synod.json docs/molitvoslov/content/psalms.json

Формат рабочего файла:
  # 62                      — начало псалма
  @1 Надписание             — надписание (стих 1, или @1-2 для двух стихов)
  2 строка / строка / …     — стих: номер, строки через « / »
  ! заметка переводчика     — translation_note
  % 1-24, 25-48             — части для чтения по кругу (необязательно)
Проверка: число стихов сверяется с Синодальным переводом.
"""
import json, re, sys, glob, os

def heb(n):
    if n <= 8: return str(n)
    if n == 9: return '9–10'
    if n <= 112: return str(n + 1)
    if n == 113: return '114–115'
    if n in (114, 115): return '116'
    if n <= 145: return str(n + 1)
    if n in (146, 147): return '147'
    return str(n)

def parse(paths):
    ps = {}
    cur = None
    for path in paths:
        for raw in open(path, encoding='utf-8'):
            line = raw.rstrip('\n').strip()
            if not line or line.startswith('//'): continue
            if line.startswith('# '):
                n = int(line[2:].split()[0])
                cur = {'n': n, 'heb': heb(n), 'title': '', 'verses': []}
                ps[n] = cur
                continue
            if cur is None: raise SystemExit('нет заголовка псалма: ' + line)
            if line.startswith('@'):
                m = re.match(r'@(\d+)(?:-(\d+))?\s+(.*)', line)
                cur['title'] = (cur['title'] + ' ' + m.group(3)).strip()
                cur['titleVerses'] = [int(m.group(1)), int(m.group(2) or m.group(1))]
                continue
            if line.startswith('!'):
                cur['translation_note'] = (cur.get('translation_note', '') + ' ' + line[1:].strip()).strip()
                continue
            if line.startswith('%'):
                cur['parts'] = [[int(a) for a in x.strip().split('-')] for x in line[1:].split(',')]
                continue
            m = re.match(r'(\d+)\s+(.*)', line)
            if not m: raise SystemExit(f'Пс {cur["n"]}: не разобрана строка: {line}')
            parts = [x.strip() for x in m.group(2).split(' / ') if x.strip()]
            cur['verses'].append({'n': int(m.group(1)), 'l': parts})
    return ps

def main():
    src, synod, out = sys.argv[1], sys.argv[2], sys.argv[3]
    ps = parse(sorted(glob.glob(os.path.join(src, '*.txt'))))
    syn = {x['abbrev']: x for x in json.load(open(synod, encoding='utf-8-sig'))}['sl']['chapters']
    problems = []
    for n, p in sorted(ps.items()):
        nums = [v['n'] for v in p['verses']]
        tv = p.get('titleVerses', [0, 0])
        # в файле Синодального перевода 114:9 слит с 114:8, а у Пс 141 нет надписания-стиха; сверяемся с печатным изданием
        count = {114: 9, 141: 8}.get(n, len(syn[n - 1]))
        expect = list(range(tv[1] + 1 if p['title'] else 1, count + 1))
        if nums != expect:
            missing = sorted(set(expect) - set(nums)); extra = sorted(set(nums) - set(expect))
            problems.append(f'Пс {n}: стихи не совпадают с Синодальным (нет {missing}, лишние {extra})')
        for v in p['verses']:
            for l in v['l']:
                if '  ' in l or l != l.strip(): problems.append(f'Пс {n}:{v["n"]}: пробелы')
    have = sorted(ps)
    data = {
        '_about': 'Псалтирь в новом переводе с греческого (Септуагинта, изд. Swete). Нумерация псалмов и стихов — греческая, как в Синодальном переводе. verses: n — номер стиха, l — строки. title — надписание. parts — деление длинного псалма для чтения по кругу.',
        'translation_note': 'Перевод с греческого текста Септуагинты (изд. H. B. Swete, 1896) с оглядкой на еврейский текст; нумерация — греческая.',
        'psalms': [ps[n] for n in have],
    }
    for p in data['psalms']: p.pop('titleVerses', None)
    json.dump(data, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('псалмов:', len(have), 'нет:', [n for n in range(1, 151) if n not in ps][:20], '…' if len(have) < 130 else '')
    for x in problems: print('  ⚠', x)

main()
