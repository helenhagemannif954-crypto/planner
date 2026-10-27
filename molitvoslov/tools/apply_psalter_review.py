"""Применить отчёт рецензента Псалтири: строки таблицы | № | Пс:стих | серьёзность | `старая` | проблема | `новая` |.
Старая строка — целая строка исходника; «новая заметка к Пс N» — вставить строку `! …` в конец псалма N.
Замена ищется внутри названного псалма (если строка в Псалтири повторяется). Повторный запуск безопасен:
уже внесённые пункты распознаются. Аргументы: отчёт [номера пунктов, которые пропустить]."""
import glob, re, sys
report, *skip = sys.argv[1:]
skip = set(skip)
files = sorted(glob.glob('molitvoslov/source/psalms/*.txt'))
text = {f: open(f).read() for f in files}

def block(ps):
    """(файл, начало, конец) псалма ps"""
    for f in files:
        m = re.search(r'(^# %d\n.*?)(?=^# |\Z)' % ps, text[f], re.S | re.M)
        if m: return f, m.start(1), m.end(1)
    return None

rows = []
for l in open(report):
    if not re.match(r'^\|\s*\d+\s*\|', l): continue
    cells = [c.strip() for c in re.split(r'(?<!\\)\|', l)[1:-1]]
    if len(cells) < 6: continue
    num, where, old, new = cells[0], cells[1], cells[3], cells[-1]
    m = re.search(r'(\d+)(?=[:\s,]|$)', where.replace('Пс', ' '))
    ps = int(m.group(1)) if m else None
    rows.append((num, where, ps, old, re.findall(r'`([^`]+)`', old), re.findall(r'`([^`]+)`', new)))

done, already, fails = [], [], []
for num, where, ps, old, to, tn in rows:
    if num in skip: continue
    tn = [b.replace('\\|', '|') for b in tn]
    if not tn: fails.append((num, where, 'нет новой строки')); continue
    if not to:  # новая заметка
        if 'замет' not in old or ps is None: fails.append((num, where, 'нет старой строки')); continue
        for b in tn:
            loc = block(ps)
            if not loc: fails.append((num, where, 'псалом не найден')); break
            f, a0, a1 = loc
            if b in text[f][a0:a1]: already.append(num); continue
            text[f] = text[f][:a0] + text[f][a0:a1].rstrip('\n') + '\n' + b + '\n\n' + text[f][a1:].lstrip('\n')
            done.append((num, b))
        continue
    if len(to) != len(tn): fails.append((num, where, f'старых {len(to)}, новых {len(tn)}')); continue
    for a, b in zip(to, tn):
        a = a.replace('\\|', '|')
        pat = re.compile(r'(?m)^' + re.escape(a) + r'$')
        loc = block(ps) if ps else None
        if loc:
            f, a0, a1 = loc
            seg = text[f][a0:a1]
            n = len(pat.findall(seg))
            if n == 1:
                text[f] = text[f][:a0] + pat.sub(lambda _: b, seg) + text[f][a1:]; done.append((num, b)); continue
            if n == 0 and re.search(r'(?m)^' + re.escape(b) + r'$', seg): already.append(num); continue
            # строка может стоять в другом псалме (согласование с параллельным местом)
        hits = [(f, len(pat.findall(text[f]))) for f in files]
        tot = sum(k for _, k in hits)
        if tot == 1:
            f = next(f for f, k in hits if k)
            text[f] = pat.sub(lambda _: b, text[f]); done.append((num, b))
        elif tot == 0 and any(re.search(r'(?m)^' + re.escape(b) + r'$', t) for t in text.values()):
            already.append(num)
        else:
            fails.append((num, where, f'строка найдена {tot} раз: {a[:70]}'))
for f in files: open(f, 'w').write(text[f])
allsrc = '\n'.join(text.values())
missing = [(n, b) for n, b in done if b not in allsrc]
print(f'пунктов: {len(rows)}, применено строк: {len(done)}, уже было: {len(already)}, не применено: {len(fails)}, пропущено по решению: {len(skip)}')
for x in fails: print('  ✗', *x)
print('новых строк нет в исходниках:', len(missing))
