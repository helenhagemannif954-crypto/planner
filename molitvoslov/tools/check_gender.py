"""Ищет в авторских строках формы первого лица, выдающие род («я пришёл», «устал», «готов»).
Запуск: python3 molitvoslov/tools/check_gender.py — печатает подозрительные строки для ручной проверки."""
import json, re, os, glob
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
C = os.path.join(ROOT, 'docs', 'molitvoslov', 'content')
SUSPECT = re.compile(r'\b(я|мне|меня|сам|сама)\b.*?\b\w+(л|лся|ла|лась)\b|\b(сам|сама|готов|готова|рад|рада|должен|должна|уверен|уверена|один|одна)\b', re.I)
PAST = re.compile(r'\b\w{3,}(ал|ял|ел|ил|ол|ул|ыл|ёл|ался|ялся|елся|ился|ла|лась)\b')

def lines():
    pr = json.load(open(os.path.join(C, 'prayers.json'), encoding='utf-8'))
    for k, t in pr['fixed'].items():
        if t.get('kind') == 'composed':
            for l in t['text']: yield f'prayers.fixed.{k}', l
    def walk(o, path):
        if isinstance(o, dict):
            for k, v in o.items(): yield from walk(v, path + '.' + k)
        elif isinstance(o, list):
            for v in o: yield from walk(v, path)
        elif isinstance(o, str): yield path, o
    yield from walk(pr['lines'], 'lines')
    th = json.load(open(os.path.join(C, 'themes.json'), encoding='utf-8'))
    for t in th['themes']:
        for q in t['questions'] + [t['own'], t['line']]: yield 'themes.' + t['id'], q
    sc = json.load(open(os.path.join(C, 'scripture.json'), encoding='utf-8'))
    for grp in [sc['plan']] + list(sc['special'].values()) + list(sc['readingPools'].values()):
        for p in grp:
            for q in p.get('q', []): yield 'scripture.' + p['ref'], q

n = 0
for where, l in lines():
    if re.search(r'\bя\b', l, re.I) and PAST.search(l) or re.search(r'\b(сам|готов|рад|должен|уверен|одинок)\b', l, re.I):
        print(f'{where}: {l}'); n += 1
print('подозрительных строк:', n)
