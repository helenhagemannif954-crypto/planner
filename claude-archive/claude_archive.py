#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""claude-archive: локальный архиватор данных из claude.ai.

Запускается только вручную (Выгрузить.bat). Ничего не отправляет в сеть
(кроме открытия страницы claude.ai в браузере по вашему согласию).
Только стандартная библиотека Python 3 + git.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
import webbrowser
import zipfile
from datetime import date, datetime
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
DEFAULT_ROOT = r"D:\ClaudeArchive"
MEMORY_REMIND_DAYS = 30

INSTRUCTION = """\
ШАГ 1. Запросить экспорт.
  claude.ai → имя/аватар → Settings → Privacy → Export data → подтвердить.
  Если пункт называется иначе — ищи в Settings раздел про Privacy или Data.
  Зачем: кнопки «скачать всё напрямую» нет, экспорт — единственный
  официальный способ получить копию чатов.

ШАГ 2. Дождаться письма.
  Приходит на почту аккаунта Claude, обычно за несколько минут; проверь «Спам».
  Зачем: ссылка на архив приходит только в письме, программа почту не читает.

ШАГ 3. Скачать zip.
  Нажми ссылку в письме, скачай архив и положи в inbox. Распаковывать не нужно.
  Зачем: программа сама распакует и разложит чаты по файлам. Ссылка действует
  ограниченное время — качай сразу.

ШАГ 4. Сохранить память (по желанию).
  В любом чате с Claude напиши: «Выведи всю мою память одним текстом».
  Скопируй ответ в файл memory-ГГГГ-ММ-ДД.md в inbox.
  Зачем: экспорт может не включать память; так в архиве хранится её история
  и видно, что изменилось.

ШАГ 5. Запустить выгрузку.
  Вернись в это окно, выбери пункт 2.
  Зачем: программа разложит чаты, обновит индекс и сохранит версию в git.
"""


# ---------- базовые утилиты ----------

def today():
    return date.today().isoformat()


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def write_text(path, text):
    """Пишет UTF-8 с переводами строк \\n, создавая папки."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def read_text(path):
    return path.read_text(encoding="utf-8", errors="replace")


RESERVED = {"CON", "PRN", "AUX", "NUL"} | {f"COM{i}" for i in range(1, 10)} | {f"LPT{i}" for i in range(1, 10)}


def slugify(text, limit=50):
    """Безопасное для Windows имя: без запрещённых символов, зарезервированных имён."""
    text = unicodedata.normalize("NFC", text or "").lower()
    text = re.sub(r"[^\w\-]+", "-", text)          # \w понимает кириллицу
    text = re.sub(r"-{2,}", "-", text).strip("-._ ")
    text = text[:limit].strip("-._ ")
    if not text:
        text = "chat"
    if text.split(".")[0].upper() in RESERVED:
        text = "_" + text
    return text


def safe_filename(name, limit=50):
    """Имя файла вложения: убираем запрещённые символы, режем длину, сохраняя расширение."""
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name or "file").strip(" .") or "file"
    stem, ext = os.path.splitext(name)
    ext = ext[:10]
    stem = stem[: max(1, limit - len(ext))].rstrip(" .") or "file"
    if stem.upper() in RESERVED:
        stem = "_" + stem
    return stem + ext


def unique_path(path):
    """Если файл есть — добавляет _2, _3 ... (ничего не перезаписываем)."""
    if not path.exists():
        return path
    i = 2
    while True:
        p = path.with_name(f"{path.stem}_{i}{path.suffix}")
        if not p.exists():
            return p
        i += 1


def fmt_ts(s):
    """ISO-время из экспорта → 'ГГГГ-ММ-ДД ЧЧ:ММ' (UTC, как в экспорте)."""
    if not s:
        return ""
    return str(s).replace("T", " ")[:16]


def day_of(s):
    m = re.match(r"(\d{4}-\d{2}-\d{2})", str(s or ""))
    return m.group(1) if m else "0000-00-00"


def days_ago(iso):
    try:
        return (date.today() - date.fromisoformat(iso)).days
    except (TypeError, ValueError):
        return None


# ---------- конфиг, состояние, журнал ----------

def load_config(config_path):
    cfg = {"archive_root": DEFAULT_ROOT}
    if config_path.exists():
        try:
            cfg.update(json.loads(config_path.read_text(encoding="utf-8-sig")))
        except Exception as e:
            print(f"Не удалось прочитать {config_path}: {e}")
            sys.exit(1)
    return cfg


def check_root(root):
    """Возвращает текст ошибки, если корень архива недоступен, иначе None.
    Ничего не создаёт, пока диск не проверен."""
    if os.name == "nt":
        anchor = Path(root.anchor)
        if not root.anchor or not anchor.exists():
            return (f"Диск «{root.drive or root}» недоступен.\n"
                    f"Архив должен лежать в {root}. Подключите диск и запустите снова.\n"
                    "Ничего не создано.")
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        return f"Не удалось открыть папку архива {root}: {e}"
    return None


def load_state(root):
    p = root / "state.json"
    base = {"hashes": {}, "chats": {}, "last_export": None,
            "last_memory": None, "current_memory_date": None}
    if p.exists():
        try:
            base.update(json.loads(read_text(p)))
        except Exception:
            # битый state.json не затираем — сохраняем копию
            shutil.copy2(p, unique_path(root / "state.broken.json"))
    return base


def save_state(root, state):
    tmp = root / "state.json.tmp"
    write_text(tmp, json.dumps(state, ensure_ascii=False, indent=1))
    os.replace(tmp, root / "state.json")


def log(root, msg):
    with open(root / "log.txt", "a", encoding="utf-8") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}\n")


def ensure_dirs(root):
    for d in ("inbox", "chats", "memory", "processed"):
        (root / d).mkdir(exist_ok=True)


# ---------- разбор экспорта ----------

def message_text(msg):
    """Текст реплики и найденные артефакты. Формат экспорта подстраиваем гибко:
    сначала блоки content[], иначе поле text."""
    parts, artifacts = [], []
    for b in msg.get("content") or []:
        if not isinstance(b, dict):
            continue
        t = b.get("type")
        if t == "text" and b.get("text"):
            parts.append(b["text"])
        elif t == "tool_use" and b.get("name") == "artifacts":
            inp = b.get("input") or {}
            artifacts.append(inp)
            parts.append(f"[Артефакт: {inp.get('title') or inp.get('id') or 'без названия'}]")
    text = "\n\n".join(parts).strip()
    if not text:
        text = (msg.get("text") or "").strip()
    return text, artifacts


ART_EXT = {"text/html": ".html", "text/markdown": ".md", "image/svg+xml": ".svg",
           "application/vnd.ant.react": ".jsx", "application/vnd.ant.mermaid": ".mmd"}
LANG_EXT = {"python": ".py", "javascript": ".js", "typescript": ".ts", "json": ".json",
            "css": ".css", "html": ".html", "bash": ".sh", "sql": ".sql", "java": ".java"}


def artifact_filename(art):
    ext = ART_EXT.get(art.get("type"))
    if art.get("type") == "application/vnd.ant.code":
        ext = LANG_EXT.get((art.get("language") or "").lower(), ".txt")
    base = safe_filename(art.get("title") or art.get("id") or "artifact", 40)
    return os.path.splitext(base)[0] + (ext or ".txt")


def collect_artifacts(chat):
    """Итоговое содержимое каждого артефакта (учитываем create/update/rewrite)."""
    arts = {}
    for msg in chat.get("chat_messages") or []:
        for a in message_text(msg)[1]:
            key = a.get("id") or a.get("title") or str(len(arts))
            cmd = a.get("command")
            if cmd in ("create", "rewrite", None) and a.get("content") is not None:
                arts[key] = dict(a)
            elif cmd == "update" and key in arts and a.get("old_str") is not None:
                arts[key]["content"] = arts[key].get("content", "").replace(
                    a["old_str"], a.get("new_str", ""), 1)
    return arts


def render_chat(chat, files_note):
    title = chat.get("name") or "Без названия"
    msgs = chat.get("chat_messages") or []
    out = [f"# {title}", "",
           f"- id: {chat.get('uuid', '')}",
           f"- создан: {fmt_ts(chat.get('created_at'))}",
           f"- обновлён: {fmt_ts(chat.get('updated_at'))}",
           f"- реплик: {len(msgs)}"]
    if files_note:
        out.append(f"- вложения и артефакты: [{files_note}]({quote(files_note)}/)")
    out += ["", "---", ""]
    for m in msgs:
        who = "Я" if m.get("sender") == "human" else "Claude"
        text, _ = message_text(m)
        out.append(f"### {who} · {fmt_ts(m.get('created_at'))}")
        out.append("")
        out.append(text or "_(пусто)_")
        for att in m.get("attachments") or []:
            out.append(f"\n> Вложение: {att.get('file_name', 'файл')}")
        for fl in m.get("files") or []:
            out.append(f"\n> Файл: {fl.get('file_name', 'файл')} (содержимое в экспорт не входит)")
        out.append("")
    return "\n".join(out)


def read_meta_count(path):
    """Число реплик из шапки существующего файла (если state потерян)."""
    try:
        m = re.search(r"^- реплик: (\d+)", read_text(path), re.M)
        return int(m.group(1)) if m else 0
    except OSError:
        return 0


def slug_limit(root):
    """Сколько символов отдать на slug, чтобы путь не превысил лимит Windows (260)."""
    reserved = len(str(root)) + len("\\chats\\2025\\") + len("2025-01-01_") + len("_12345678") \
        + len("_files\\") + 50
    return max(10, min(60, 250 - reserved))


def save_chat(root, state, chat, stats, limit):
    cid = chat.get("uuid") or chat.get("id")
    if not cid:
        return
    msgs = chat.get("chat_messages") or []
    count = len(msgs)
    updated = chat.get("updated_at") or ""
    info = state["chats"].get(cid)

    if info and (root / info["path"]).exists():
        md = root / info["path"]
        old_count = info.get("count") or read_meta_count(md)
        if count < old_count:                      # в экспорте короче — прежнее не теряем
            stats["same"] += 1
            return
        if count == old_count and info.get("updated") == updated:
            stats["same"] += 1
            return
        stats["upd"] += 1
    else:
        short = str(cid).replace("-", "")[:8]
        day = day_of(chat.get("created_at"))
        year = day[:4] if day != "0000-00-00" else "без-даты"
        slug = slugify(chat.get("name") or "без названия", limit)
        md = unique_path(root / "chats" / year / f"{day}_{slug}_{short}.md")
        stats["new"] += 1

    # вложения и артефакты → <имя-чата>_files\
    files_dir = md.with_name(md.stem + "_files")
    wrote = False
    for key, art in collect_artifacts(chat).items():
        write_text(files_dir / artifact_filename(art), str(art.get("content", "")))
        wrote = True
    for m in msgs:
        for i, att in enumerate(m.get("attachments") or [], 1):
            content = att.get("extracted_content")
            if content:
                name = safe_filename(att.get("file_name") or f"attachment{i}", 50)
                write_text(files_dir / name, str(content))
                wrote = True
    write_text(md, render_chat(chat, files_dir.name if wrote else ""))

    first_human = next((message_text(m)[0] for m in msgs if m.get("sender") == "human"), "")
    state["chats"][cid] = {
        "path": md.relative_to(root).as_posix(),
        "title": chat.get("name") or "Без названия",
        "created": chat.get("created_at") or "", "updated": updated, "count": count,
        "snippet": re.sub(r"\s+", " ", first_human)[:150],
    }


# ---------- память ----------

def memory_from_json(data):
    """memories.json из экспорта: структуру не знаем наверняка — выводим всё текстовое."""
    items = data if isinstance(data, list) else [data]
    out = []
    for it in items:
        if isinstance(it, str):
            out.append(it)
        elif isinstance(it, dict):
            for k, v in it.items():
                if isinstance(v, str) and v.strip():
                    out.append(f"## {k}\n\n{v.strip()}\n")
                elif isinstance(v, (dict, list)) and v:
                    out.append(f"## {k}\n\n```json\n{json.dumps(v, ensure_ascii=False, indent=1)}\n```\n")
    return "\n".join(out).strip()


def short_diff(old, new, cap=40):
    old_l = [l.strip() for l in old.splitlines() if l.strip()]
    new_l = [l.strip() for l in new.splitlines() if l.strip()]
    os_, ns = set(old_l), set(new_l)
    added = [l for l in new_l if l not in os_]
    removed = [l for l in old_l if l not in ns]
    lines = []
    for sign, items in (("+", added), ("-", removed)):
        for l in items[:cap]:
            lines.append(f"{sign} {l[:300]}")
        if len(items) > cap:
            lines.append(f"{sign} … и ещё {len(items) - cap}")
    return lines, len(added), len(removed)


def save_memory(root, state, text, mdate):
    mem = root / "memory"
    text = text.strip() + "\n"
    write_text(unique_path(mem / f"memory_{mdate}.md"), text)
    cur = mem / "CURRENT.md"
    cur_date = state.get("current_memory_date")
    if cur_date and mdate < cur_date:
        print(f"  Память от {mdate} старше текущей ({cur_date}): сохранена в memory, CURRENT не тронут.")
        return
    old = read_text(cur) if cur.exists() else None
    if old is not None and old.strip() == text.strip():
        print(f"  Память от {mdate}: без изменений.")
    else:
        if old is None:
            entry = f"## {mdate}\n\nПервая версия памяти ({len(text.splitlines())} строк).\n\n"
        else:
            diff, a, r = short_diff(old, text)
            entry = f"## {mdate}\n\nДобавлено: {a}, убрано: {r}\n\n```diff\n" + "\n".join(diff) + "\n```\n\n"
            print(f"  Память от {mdate}: добавлено {a}, убрано {r} (см. memory\\CHANGELOG.md).")
        log_p = mem / "CHANGELOG.md"
        prev = read_text(log_p) if log_p.exists() else "# История изменений памяти\n\n"
        head, _, rest = prev.partition("\n\n")          # новые записи — сверху
        write_text(log_p, head + "\n\n" + entry + rest)
    write_text(cur, text)
    state["current_memory_date"] = mdate
    state["last_memory"] = today()


# ---------- индекс ----------

def rebuild_index(root, state):
    chats = sorted(state["chats"].values(), key=lambda c: c.get("created", ""), reverse=True)
    lines = ["# Архив чатов Claude", "",
             f"Чатов: {len(chats)}. Обновлено: {datetime.now():%Y-%m-%d %H:%M}.",
             "Полнотекстовый поиск: Проводник → папка chats → строка поиска (или `findstr /s /i слово chats\\*.md`).",
             "Одна строка на чат: [SEARCH.txt](SEARCH.txt).", ""]
    month = None
    for c in chats:
        m = day_of(c["created"])[:7]
        if m != month:
            month = m
            lines += ["", f"## {m}", "", "| Дата | Название | Реплик |", "|---|---|---|"]
        title = c["title"].replace("|", "\\|").replace("\n", " ")
        lines.append(f"| {day_of(c['created'])} | [{title}]({quote(c['path'])}) | {c['count']} |")
    write_text(root / "INDEX.md", "\n".join(lines) + "\n")
    rows = ["\t".join([day_of(c["created"]), c["title"].replace("\t", " "), str(c["count"]),
                       c["path"].replace("/", "\\"), c.get("snippet", "")]) for c in chats]
    write_text(root / "SEARCH.txt", "\n".join(rows) + "\n")


# ---------- git ----------

def git(root, *args):
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, encoding="utf-8")


def git_commit(root, new, upd):
    try:
        if not (root / ".git").exists():
            git(root, "init")
            git(root, "config", "core.quotepath", "false")
        # сырые zip (inbox, processed) в историю не кладём: они большие и уже хранятся как файлы
        gi = root / ".gitignore"
        if not gi.exists():
            write_text(gi, "inbox/\nprocessed/\nstate.json.tmp\n")
        git(root, "add", "-A")
        if not git(root, "status", "--porcelain").stdout.strip():
            return "git: изменений нет, коммит не нужен."
        ident = []
        if not git(root, "config", "user.name").stdout.strip():
            ident = ["-c", "user.name=claude-archive", "-c", "user.email=archive@localhost"]
        msg = f"archive {today()}: {new} новых, {upd} обновлённых"
        r = git(root, *ident, "commit", "-m", msg)
        return f"git: коммит «{msg}»" if r.returncode == 0 else f"git: ошибка коммита: {r.stderr.strip()}"
    except FileNotFoundError:
        return "git не найден в системе — версия не сохранена (установите Git for Windows)."


# ---------- обработка inbox ----------

def process_zip(root, state, path, stats, limit):
    """True, если архив разобран."""
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        print(f"  {path.name}: это не zip-архив или он повреждён. Скачайте экспорт заново.")
        return False
    with zf:
        names = {Path(n).name: n for n in zf.namelist() if not n.endswith("/")}
        if "conversations.json" not in names:
            print(f"  {path.name}: не похоже на экспорт Claude — внутри нет файла conversations.json.\n"
                  "  Нужен архив из письма после «Settings → Privacy → Export data».\n"
                  f"  Внутри этого архива: {', '.join(list(names)[:8]) or 'пусто'}.")
            return False
        try:
            data = json.loads(zf.read(names["conversations.json"]).decode("utf-8-sig"))
        except Exception as e:
            print(f"  {path.name}: conversations.json не читается ({e}).")
            return False
        if isinstance(data, dict):                     # на случай обёртки {"conversations": [...]}
            data = data.get("conversations") or data.get("chats") or []
        for chat in data:
            if isinstance(chat, dict):
                save_chat(root, state, chat, stats, limit)
        if "memories.json" in names:                   # память внутри экспорта, если она там есть
            try:
                text = memory_from_json(json.loads(zf.read(names["memories.json"]).decode("utf-8-sig")))
                if text:
                    save_memory(root, state, text, today())
            except Exception as e:
                print(f"  memories.json пропущен: {e}")
        print(f"  Файлы экспорта: {', '.join(sorted(names))}")
    state["last_export"] = today()
    return True


def move_processed(root, path, prefix=""):
    dest = root / "processed" / today()
    dest.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(unique_path(dest / (prefix + path.name))))


def inbox_files(root, state):
    """Возвращает (новые, повторы, непонятные) файлы из inbox."""
    new, dup, other = [], [], []
    for p in sorted((root / "inbox").iterdir()):
        if not p.is_file() or p.name.startswith((".", "~")):
            continue
        low = p.name.lower()
        if not (low.endswith(".zip") or re.match(r"memory.*\.(md|txt)$", low)):
            other.append(p)
            continue
        h = sha256(p)
        (dup if h in state["hashes"] else new).append((p, h))
    return new, dup, other


def run_export(root, state):
    new, dup, other = inbox_files(root, state)
    for p in other:
        print(f"Пропускаю {p.name}: не zip экспорта и не memory-*.md/txt.")
    if not new and not dup:
        print("Новых файлов нет.")
        d = days_ago(state.get("last_export"))
        print("Экспорт ещё ни разу не обрабатывался." if d is None
              else f"Последний экспорт обработан {d} дн. назад.")
        print("Выберите пункт 1, чтобы увидеть, как получить свежие данные.")
        return
    stats = {"new": 0, "upd": 0, "same": 0}
    limit = slug_limit(root)
    done = False
    for p, h in dup:
        print(f"{p.name}: уже обрабатывался раньше, переношу в processed как повтор.")
        move_processed(root, p, "повтор_")
    # сначала архивы, потом память (по дате в имени)
    zips = [x for x in new if x[0].suffix.lower() == ".zip"]
    mems = sorted((x for x in new if x[0].suffix.lower() != ".zip"), key=lambda x: x[0].name)
    for p, h in zips:
        print(f"Разбираю {p.name} …")
        if process_zip(root, state, p, stats, limit):
            state["hashes"][h] = {"file": p.name, "date": today()}
            save_state(root, state)
            move_processed(root, p)
            done = True
    for p, h in mems:
        print(f"Память: {p.name}")
        m = re.search(r"(\d{4}-\d{2}-\d{2})", p.name)
        mdate = m.group(1) if m else date.fromtimestamp(p.stat().st_mtime).isoformat()
        save_memory(root, state, read_text(p), mdate)
        state["hashes"][h] = {"file": p.name, "date": today()}
        save_state(root, state)
        move_processed(root, p)
        done = True
    if not done:
        print("Ни один файл не обработан.")
        return
    save_state(root, state)
    rebuild_index(root, state)
    print(git_commit(root, stats["new"], stats["upd"]))
    summary = f"новых чатов: {stats['new']}, обновлённых: {stats['upd']}, без изменений: {stats['same']}"
    log(root, summary)
    print(f"\nГотово. {summary.capitalize()}.")
    print(f"Индекс: {root / 'INDEX.md'}")
    d = days_ago(state.get("last_memory"))
    if d is None or d > MEMORY_REMIND_DAYS:
        print("Напоминание: память давно не сохранялась (шаг 4 инструкции — пункт 1 меню).")


# ---------- меню ----------

def open_path(p):
    if hasattr(os, "startfile"):
        os.startfile(str(p))
    else:
        print(f"  (не Windows) {p}")


def show_instruction(root):
    print("\nКАК ПОЛУЧИТЬ СВЕЖИЕ ДАННЫЕ\n")
    print(INSTRUCTION)
    if input("Открыть папку inbox и страницу claude.ai? (д/н) ").strip().lower() in ("д", "y", "да"):
        open_path(root / "inbox")
        webbrowser.open("https://claude.ai")


def status_line(root, state):
    new, dup, _ = inbox_files(root, state)
    d = days_ago(state.get("last_export"))
    when = "ещё ни разу" if d is None else f"{d} дн. назад"
    return f"Последний экспорт обработан {when}, в inbox ждут {len(new)} новых файлов"


def main():
    for s in (sys.stdout, sys.stderr, sys.stdin):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(HERE / "config.json"))
    ap.add_argument("--run", action="store_true", help="сразу выполнить пункт 2 (для проверки)")
    args = ap.parse_args()

    cfg = load_config(Path(args.config))
    root = Path(cfg["archive_root"])
    err = check_root(root)
    if err:
        print(err)
        return 1
    ensure_dirs(root)
    state = load_state(root)

    if args.run:
        run_export(root, state)
        return 0

    print(status_line(root, state))
    print("\n  1 — Показать инструкцию: как получить свежие данные\n"
          "  2 — Выгрузить: обработать то, что лежит в inbox\n"
          "  3 — Открыть папки (inbox, архив) в Проводнике\n"
          "  0 — Выход\n")
    while True:
        choice = input("Ваш выбор (0–3): ").strip()
        if choice in ("0", "1", "2", "3"):
            break
        print("Введите цифру 0, 1, 2 или 3.")
    if choice == "1":
        show_instruction(root)
    elif choice == "2":
        try:
            run_export(root, state)
        except Exception as e:
            log(root, f"ОШИБКА: {e!r}")
            print(f"\nОшибка: {e}\nПодробности — в log.txt. Файлы в inbox не тронуты.")
            return 1
    elif choice == "3":
        open_path(root / "inbox")
        open_path(root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
