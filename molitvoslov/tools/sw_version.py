"""Ставит в docs/molitvoslov/sw.js версию кэша, вычисленную по содержимому всех файлов приложения.

Запуск (из корня репозитория) — после любой правки приложения или текстов, перед коммитом:
  python3 molitvoslov/tools/sw_version.py

Service worker отдаёт файлы из кэша; новая версия кэша — единственный способ, которым
обновление доходит до уже установленного приложения. Тест pwa.spec.mjs проверяет, что версия
не отстала от файлов.
"""
import hashlib, os, re

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
APP = os.path.join(ROOT, 'docs', 'molitvoslov')
SW = os.path.join(APP, 'sw.js')


def version():
    h = hashlib.sha256()
    for dirpath, _, files in sorted(os.walk(APP)):
        for f in sorted(files):
            p = os.path.join(dirpath, f)
            if p == SW:
                continue
            h.update(os.path.relpath(p, APP).replace(os.sep, '/').encode())
            h.update(open(p, 'rb').read())
    return 'm-' + h.hexdigest()[:10]


if __name__ == '__main__':
    v = version()
    s = open(SW, encoding='utf-8').read()
    s2 = re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{v}';", s)
    open(SW, 'w', encoding='utf-8').write(s2)
    print('версия кэша:', v, '(без изменений)' if s == s2 else '')
