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
import time
import unicodedata
import webbrowser
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
DEFAULT_ROOT = r"D:\ClaudeArchive"
EXPORT_REMIND_DAYS = 14

INSTRUCTION = """\
ШАГ 1. Запросить экспорт.
  claude.ai → Settings → Privacy → Export data → подтвердить.
  (Если пункт называется иначе — ищи раздел про Privacy или Data.)
  Зачем: кнопки «скачать всё напрямую» нет, экспорт — единственный
  официальный способ получить копию чатов.

ШАГ 2. Из письма скачай маленький файл manifest-….json.
  Письмо приходит на почту аккаунта Claude, обычно за несколько минут;
  проверь «Спам». Манифест качается одним кликом.
  Зачем: это список всех файлов экспорта со ссылками на них; по нему
  программа проверяет, что скачано всё. Ссылки действуют 24 часа.

ШАГ 3. Перетащи этот файл на «Выгрузить.bat».
  Программа сама откроет ссылки в браузере, дождётся загрузки, разложит
  всё по архиву и сохранит версию в git.
  Зачем: ссылки одноразовые и требуют входа в аккаунт, поэтому качает
  твой браузер, а программа только открывает их по одной и ждёт файлы.
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
            "current_memory_date": None, "manifests": {}, "opened": {}}
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
    for d in ("inbox", "chats", "memory", "projects", "raw", "processed"):
        (root / d).mkdir(exist_ok=True)


# ---------- разбор экспорта ----------

def chat_msgs(chat):
    return chat.get("chat_messages") or chat.get("messages") or []


def is_human(m):
    return (m.get("sender") or m.get("role")) in ("human", "user")


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
    for msg in chat_msgs(chat):
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
    msgs = chat_msgs(chat)
    out = [f"# {title}", "",
           f"- id: {chat.get('uuid', '')}",
           f"- создан: {fmt_ts(chat.get('created_at'))}",
           f"- обновлён: {fmt_ts(chat.get('updated_at'))}",
           f"- реплик: {len(msgs)}"]
    if files_note:
        out.append(f"- вложения и артефакты: [{files_note}]({quote(files_note)}/)")
    out += ["", "---", ""]
    for m in msgs:
        who = "Я" if is_human(m) else "Claude"
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
    msgs = chat_msgs(chat)
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

    first_human = next((message_text(m)[0] for m in msgs if is_human(m)), "")
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


def save_memory(root, state, text, mdate, copy_to=None):
    """copy_to — куда положить читаемую копию (по умолчанию memory\\memory_ДАТА.md)."""
    mem = root / "memory"
    text = text.strip() + "\n"
    write_text(unique_path(copy_to or mem / f"memory_{mdate}.md"), text)
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


# ---------- извлечение zip ----------

def extract_zip(zf, dest, skip=()):
    """Распаковывает «как есть», но безопасно: без выхода за папку, с чисткой имён
    под Windows. Существующие файлы не перезаписываем (добавляем _2, _3 ...)."""
    written = []
    for info in zf.infolist():
        if info.is_dir() or info.filename in skip:
            continue
        parts = [x for x in re.split(r"[\\/]+", info.filename) if x not in ("", ".")]
        if not parts or ".." in parts:
            continue
        target = unique_path(dest.joinpath(*[safe_filename(x, 100) for x in parts]))
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
            written.append(target)
        except OSError as e:
            print(f"    не удалось сохранить {info.filename}: {e}")
    return written


def load_json_file(path):
    try:
        return json.loads(path.read_bytes().decode("utf-8-sig"))
    except Exception:
        return None


def extract_chats(obj):
    """Список чатов из JSON или None, если это не чаты."""
    if isinstance(obj, dict):
        for k in ("conversations", "chats"):
            if isinstance(obj.get(k), list):
                obj = obj[k]
                break
        else:
            obj = [obj] if ("chat_messages" in obj or "messages" in obj) else None
    if isinstance(obj, list) and obj and all(isinstance(c, dict) for c in obj) \
            and any("chat_messages" in c or "messages" in c for c in obj):
        return obj
    return None


# ---------- проекты и голос ----------

def projects_to_md(obj, outdir):
    items = obj if isinstance(obj, list) else (obj.get("projects") if isinstance(obj, dict) else None)
    n = 0
    for pr in items or []:
        if not isinstance(pr, dict) or not (pr.get("name") or pr.get("uuid")):
            continue
        name = pr.get("name") or "Без названия"
        base = f"{slugify(name)}_{str(pr.get('uuid') or pr.get('id') or '')[:8]}".rstrip("_")
        short, long_, files = [], [], []
        for k, v in pr.items():
            if k in ("docs", "files", "documents", "attachments") and isinstance(v, list):
                for i, d in enumerate(v, 1):
                    if isinstance(d, dict):
                        fn = d.get("file_name") or d.get("filename") or d.get("name") or f"doc{i}.txt"
                        body = d.get("content") or d.get("extracted_content") or d.get("text")
                        if body:
                            write_text(unique_path(outdir / f"{base}_files" / safe_filename(fn, 60)), str(body))
                            files.append(fn)
            elif isinstance(v, str) and ("\n" in v or len(v) > 200):
                long_.append(f"## {k}\n\n{v.strip()}\n")
            elif isinstance(v, (str, int, float, bool)) or v is None:
                short.append(f"- {k}: {v}")
            elif v:
                long_.append(f"## {k}\n\n```json\n{json.dumps(v, ensure_ascii=False, indent=1)}\n```\n")
        md = [f"# {name}", ""] + short + [""]
        if files:
            md += ["## Файлы проекта", ""] + [f"- {f}" for f in files] + [""]
        write_text(unique_path(outdir / f"{base}.md"), "\n".join(md + long_))
        n += 1
    return n


def voice_to_md(obj):
    """Читаемый транскрипт, если структура похожа на реплики; иначе None."""
    items = obj if isinstance(obj, list) else [obj]
    out = []
    for it in items:
        if not isinstance(it, dict):
            return None
        turns = next((it[k] for k in ("transcript", "messages", "turns", "utterances", "segments")
                      if isinstance(it.get(k), list)), None)
        if turns is None:
            return None
        out.append(f"# {it.get('title') or it.get('name') or it.get('id') or it.get('uuid') or 'Голосовая сессия'}\n")
        for t in turns:
            if isinstance(t, dict):
                who = str(t.get("speaker") or t.get("role") or t.get("sender") or "")
                who = "Я" if who in ("user", "human") else ("Claude" if who in ("assistant", "claude") else who)
                txt = t.get("text") or t.get("content") or t.get("transcript") or ""
                out.append(f"**{who}:** {txt if isinstance(txt, str) else json.dumps(txt, ensure_ascii=False)}\n")
            elif isinstance(t, str):
                out.append(t + "\n")
    return "\n".join(out) if out else None


# ---------- обработка одного zip по категории ----------

ORDER = ["conversations", "memories", "projects", "light_metadata", "frames", "claude_code_cloud", "voice_sessions"]


def guess_category(name):
    low = name.lower()
    return next((c for c in ORDER if c in low), None)


def process_zip(root, state, path, cat, day, stats, ctx):
    """Возвращает (успех, заметка)."""
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        return False, "не zip или повреждён — скачайте файл заново"
    with zf:
        if cat == "conversations":
            skip, found = set(), 0
            for info in zf.infolist():
                if info.filename.lower().endswith(".json") and not info.is_dir():
                    try:
                        chats = extract_chats(json.loads(zf.read(info).decode("utf-8-sig")))
                    except Exception:
                        chats = None
                    if chats:
                        skip.add(info.filename)
                        for chat in chats:
                            save_chat(root, state, chat, stats, ctx["limit"])
                            found += 1
            rest = extract_zip(zf, root / "raw" / day / "conversations", skip)
            note = f"чатов в файле: {found}"
            if not found:
                note = "чаты не найдены, файл сохранён как есть в raw"
            elif rest:
                note += f"; прочих файлов сохранено как есть: {len(rest)}"
            return True, note
        if cat == "memories":
            files = extract_zip(zf, root / "memory" / day)
            for f in files:
                if f.suffix.lower() == ".json":
                    obj = load_json_file(f)
                    text = memory_from_json(obj) if obj is not None else ""
                elif f.suffix.lower() in (".md", ".txt"):
                    text = read_text(f)
                else:
                    text = ""
                if text.strip():
                    ctx["mem"].append((f.name, text.strip()))
            return True, f"файлов: {len(files)}"
        if cat == "projects":
            files = extract_zip(zf, root / "projects" / day / "_as_is")
            n = 0
            for f in files:
                if f.suffix.lower() == ".json":
                    obj = load_json_file(f)
                    if obj is not None:
                        n += projects_to_md(obj, root / "projects" / day)
            return True, f"проектов: {n}; файлов как есть: {len(files)}" + ("" if n else " (структура проектов не распознана)")
        # остальные категории: сохраняем как есть
        files = extract_zip(zf, root / "raw" / day / cat)
        note = f"сохранено как есть: {len(files)}"
        if cat == "voice_sessions":
            made = 0
            for f in files:
                if f.suffix.lower() == ".json":
                    obj = load_json_file(f)
                    md = voice_to_md(obj) if obj is not None else None
                    if md:
                        write_text(unique_path(root / "raw" / day / cat / "читаемо" / (f.stem + ".md")), md)
                        made += 1
            note += f"; читаемых md: {made}" if made else "; формат транскриптов не распознан"
        return True, note


# ---------- набор из inbox ----------

def read_manifest(p):
    m = json.loads(read_text(p).lstrip("﻿"))
    if not isinstance(m.get("data_files"), list):
        raise ValueError("нет списка data_files")
    return m


def manifest_day(m):
    return day_of(m.get("created_at")) if m.get("created_at") else today()


def move_processed(root, path, prefix=""):
    dest = root / "processed" / today()
    dest.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(unique_path(dest / (prefix + path.name))))


def list_inbox(root):
    fs = [p for p in sorted((root / "inbox").iterdir()) if p.is_file() and not p.name.startswith((".", "~"))]
    man = [p for p in fs if re.match(r"manifest.*\.json$", p.name, re.I)]
    zips = [p for p in fs if p.suffix.lower() == ".zip"]
    mems = [p for p in fs if re.match(r"memory.*\.(md|txt)$", p.name, re.I)]
    other = [p for p in fs if p not in man + zips + mems]
    return man, zips, mems, other


def build_sets(root, state, man, zips, accept_partial):
    """Группирует файлы inbox в наборы экспорта. Возвращает список наборов."""
    by_name = {z.name.lower(): z for z in zips}
    used, sets = set(), []
    for mp in man:
        try:
            m = read_manifest(mp)
        except Exception as e:
            print(f"Манифест {mp.name} не читается ({e}) — пропускаю.")
            continue
        mh = sha256(mp)
        rec = state["manifests"].setdefault(mh, {"date": manifest_day(m), "done": []})
        entries = [e for e in m["data_files"] if isinstance(e, dict) and e.get("filename")]
        total = m.get("total_files")
        if isinstance(total, int) and total != len(entries):
            print(f"Внимание: в манифесте {mp.name} total_files = {total}, а перечислено {len(entries)}.")
        items = []
        missing = []
        for e in entries:
            z = by_name.get(e["filename"].lower())
            if z:
                used.add(z.name.lower())
                items.append((z, e.get("category") or guess_category(z.name) or "unknown"))
            elif e["filename"] not in rec["done"]:
                missing.append(e)
        if not items and not missing:
            print(f"Набор {mp.name} уже обработан раньше — переношу манифест в processed.")
            move_processed(root, mp, "повтор_")
            continue
        label = f"набор от {rec['date']} ({mp.name})"
        if missing:
            print(f"\nВ {label} не хватает файлов: {len(missing)} из {len(entries)}:")
            for e in missing:
                print(f"  - {e['filename']} ({e.get('category', '?')}, часть {e.get('part', '?')})")
            print("Докачай их из ссылок в манифесте (меню → «Открыть ссылки из манифеста»): ссылки\n"
                  "действуют 24 часа от created_at и могут сработать только один раз.")
            ok = accept_partial or input("Обработать неполный набор сейчас? (д/н) ").strip().lower() in ("д", "да", "y")
            if not ok:
                print("Набор пропущен, файлы остались в inbox.")
                continue
        sets.append({"label": label, "day": rec["date"], "mp": mp, "mh": mh, "rec": rec,
                     "items": items, "entries": entries})
    orphans = [(z, guess_category(z.name) or "unknown") for z in zips if z.name.lower() not in used]
    if orphans:
        sets.append({"label": "файлы без манифеста", "day": today(), "mp": None, "mh": None,
                     "rec": None, "items": orphans, "entries": []})
    return sets


def run_set(root, state, s, stats, report):
    ctx = {"limit": slug_limit(root), "mem": []}
    items = sorted(s["items"], key=lambda x: (ORDER.index(x[1]) if x[1] in ORDER else 99, x[0].name))
    for z, cat in items:
        h = sha256(z)
        if h in state["hashes"]:
            print(f"  {z.name}: уже обрабатывался — в processed как повтор.")
            move_processed(root, z, "повтор_")
            if s["rec"] is not None:
                s["rec"]["done"].append(z.name)
            report.append((cat, z.name, "повтор", "пропущен: тот же SHA-256"))
            continue
        if cat == "unknown":
            print(f"  {z.name}: не удалось определить категорию. Это архив из экспорта Claude? Нужны файлы\n"
                  "  из письма с манифестом (conversations, memories, projects …). Файл оставлен в inbox.")
            report.append((cat, z.name, "не обработан", "категория не определена"))
            continue
        print(f"  {z.name} [{cat}] …")
        try:
            ok, note = process_zip(root, state, z, cat, s["day"], stats, ctx)
        except Exception as e:
            ok, note = False, f"ошибка: {e!r}"
            log(root, f"{z.name}: {note}")
        print(f"    {note}")
        report.append((cat, z.name, "ок" if ok else "не обработан", note))
        if ok:
            state["hashes"][h] = {"file": z.name, "size": z.stat().st_size, "date": today()}
            if s["rec"] is not None:
                s["rec"]["done"].append(z.name)
            save_state(root, state)
            move_processed(root, z)
    if ctx["mem"]:
        text = "\n\n".join(f"<!-- {n} -->\n{t}" if len(ctx["mem"]) > 1 else t for n, t in ctx["mem"])
        save_memory(root, state, text, s["day"], root / "memory" / s["day"] / "memory.md")
    # манифест уходит в processed только когда набор полный
    if s["mp"] is not None:
        if all(e["filename"] in s["rec"]["done"] for e in s["entries"]):
            state["hashes"][s["mh"]] = {"file": s["mp"].name, "size": s["mp"].stat().st_size, "date": today()}
            move_processed(root, s["mp"])
        else:
            print("  Манифест оставлен в inbox: ждёт недостающие или необработанные файлы.")
    save_state(root, state)


def run_export(root, state, accept_partial=False):
    man, zips, mems, other = list_inbox(root)
    for p in other:
        print(f"Пропускаю {p.name}: не manifest-*.json, не zip и не memory-*.md/txt.")
    mems_new = []
    for p in mems:
        h = sha256(p)
        if h in state["hashes"]:
            move_processed(root, p, "повтор_")
        else:
            mems_new.append((p, h))
    sets = build_sets(root, state, man, zips, accept_partial)
    if not sets and not mems_new:
        print("Новых файлов нет." if not (man or zips) else "Обрабатывать нечего.")
        d = days_ago(state.get("last_export"))
        print("Экспорт ещё ни разу не обрабатывался." if d is None
              else f"Последний экспорт обработан {d} дн. назад.")
        print("Выберите пункт 1, чтобы увидеть, как получить свежие данные.")
        return
    stats, report = {"new": 0, "upd": 0, "same": 0}, []
    for s in sets:
        print(f"\nОбрабатываю {s['label']}")
        run_set(root, state, s, stats, report)
    if any(r[2] == "ок" for r in report):
        state["last_export"] = today()
    for p, h in sorted(mems_new, key=lambda x: x[0].name):      # необязательные memory-*.md
        print(f"Память из файла: {p.name}")
        m = re.search(r"(\d{4}-\d{2}-\d{2})", p.name)
        save_memory(root, state, read_text(p), m.group(1) if m else date.fromtimestamp(p.stat().st_mtime).isoformat())
        state["hashes"][h] = {"file": p.name, "size": p.stat().st_size, "date": today()}
        move_processed(root, p)
        report.append(("memory-файлы", p.name, "ок", "добавлена версия памяти"))
    save_state(root, state)
    rebuild_index(root, state)
    print("\n" + git_commit(root, stats["new"], stats["upd"]))
    print("\nИТОГ ПО КАТЕГОРИЯМ")
    for cat in sorted({r[0] for r in report}, key=lambda c: ORDER.index(c) if c in ORDER else 99):
        rows = [r for r in report if r[0] == cat]
        okn = sum(1 for r in rows if r[2] == "ок")
        print(f"  {cat}: найдено файлов {len(rows)}, обработано {okn}")
        for r in rows:
            print(f"     {r[1]} — {r[2]}: {r[3]}")
    summary = f"новых чатов: {stats['new']}, обновлённых: {stats['upd']}, без изменений: {stats['same']}"
    log(root, summary)
    print(f"\nГотово. {summary.capitalize()}.\nИндекс: {root / 'INDEX.md'}")


# ---------- скачивание набора по манифесту ----------
# Python сам ничего не качает: он открывает ссылки в браузере (где вы вошли в claude.ai)
# и следит за папкой загрузок.

STABLE_SECONDS = 5          # размер файла не меняется столько секунд → файл готов
POLL_SECONDS = 1
FILE_TIMEOUT = 600          # 10 минут на файл
TEMP_EXT = (".crdownload", ".part", ".tmp", ".download", ".partial")


def detect_downloads():
    """Папка «Загрузки» из Windows (Known Folder), запасной вариант — ~/Downloads."""
    if os.name == "nt":
        try:
            import ctypes
            import uuid

            class GUID(ctypes.Structure):
                _fields_ = [("a", ctypes.c_ulong), ("b", ctypes.c_ushort),
                            ("c", ctypes.c_ushort), ("d", ctypes.c_ubyte * 8)]
            guid = GUID.from_buffer_copy(uuid.UUID("374DE290-123F-4565-9164-39C4925E467B").bytes_le)
            buf = ctypes.c_wchar_p()
            if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(guid), 0, None, ctypes.byref(buf)) == 0:
                p = buf.value
                ctypes.windll.ole32.CoTaskMemFree(buf)
                return Path(p)
        except Exception:
            pass
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as k:
                return Path(os.path.expandvars(winreg.QueryValueEx(k, "{374DE290-123F-4565-9164-39C4925E467B}")[0]))
        except Exception:
            pass
    return Path.home() / "Downloads"


def save_config(path, cfg):
    write_text(path, json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")


def pick_downloads(cfg, cfg_path):
    """Папка загрузок: определяем, показываем, спрашиваем ОДИН раз, пишем в config.json."""
    d = cfg.get("downloads_dir")
    if d and cfg.get("downloads_confirmed") and Path(d).is_dir():
        return Path(d)
    guess = Path(d) if d else detect_downloads()
    print(f"Папка загрузок браузера: {guess}")
    while True:
        a = input("Верно? (д — да, или введите другой путь) ").strip().strip('"')
        p = guess if a.lower() in ("д", "да", "y") else Path(a) if a else None
        if p is None:
            continue
        if p.is_dir():
            break
        print("Такой папки нет.")
    cfg["downloads_dir"], cfg["downloads_confirmed"] = str(p), True
    save_config(cfg_path, cfg)
    print("Путь сохранён в config.json, больше спрашивать не буду.")
    return p


def wait_for_download(dl, name, t0):
    """Ждёт файл с именем name (допускается « (1)»), созданный после t0, без временных
    файлов браузера и со стабильным размером. Возвращает путь или None по таймауту."""
    stem, ext = os.path.splitext(name)
    pat = re.compile(re.escape(stem) + r"( \(\d+\))?" + re.escape(ext) + r"$", re.I)
    start = last_print = time.time()
    last, stable_since = None, 0
    while time.time() - start < FILE_TIMEOUT:
        cands, temp = [], False
        for p in dl.iterdir():
            try:
                st = p.stat()
            except OSError:
                continue
            stamp = max(st.st_ctime, st.st_mtime) if os.name == "nt" else st.st_mtime   # на Windows ctime = время создания
            if not p.is_file() or stamp < t0 - 2:
                continue                                  # старые файлы не берём
            if p.suffix.lower() in TEMP_EXT:
                temp = True
            elif pat.match(p.name) and st.st_size > 0:
                cands.append((st.st_mtime, p, st.st_size))
        if cands and not temp:
            _, p, size = max(cands, key=lambda c: c[0])
            if last == (p, size):
                if time.time() - stable_since >= STABLE_SECONDS:
                    return p
            else:
                last, stable_since = (p, size), time.time()
        else:
            last = None
        if time.time() - last_print > 30:
            print("    …ждём загрузку")
            last_print = time.time()
        time.sleep(POLL_SECONDS)
    return None


def download_set(root, state, cfg, cfg_path, mp):
    try:
        m = read_manifest(mp)
    except Exception as e:
        print(f"Не удалось прочитать манифест {mp}: {e}")
        return
    # а) срок жизни ссылок
    try:
        created = datetime.fromisoformat(str(m["created_at"]).replace("Z", "+00:00"))
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc).timestamp() - created.timestamp() > 24 * 3600:
            print(f"С момента создания экспорта ({m['created_at']}) прошло больше 24 часов: ссылки истекли.\n"
                  "Ссылки открывать не буду. Запросите новый экспорт — шаг 1 инструкции (пункт 1 меню).")
            return
    except Exception:
        print("Не удалось определить время создания экспорта (created_at) — проверьте, не истекли ли ссылки.")
    inbox = root / "inbox"
    entries = [e for e in m["data_files"] if isinstance(e, dict) and e.get("filename")]
    done = state["manifests"].get(sha256(mp), {}).get("done", [])
    todo = [e for e in entries if not (inbox / e["filename"]).exists() and e["filename"] not in done]
    print(f"Манифест {mp.name}: файлов в наборе {len(entries)}, нужно скачать {len(todo)}.")
    # в) манифест — в inbox
    if mp.resolve().parent != inbox.resolve():
        dest = inbox / mp.name
        if not (dest.exists() and sha256(dest) == sha256(mp)):
            shutil.copy2(mp, unique_path(dest))
    if todo:
        # б) папка загрузок + время старта
        dl = pick_downloads(cfg, cfg_path)
        # г) предупреждение
        print(f"\nСейчас по очереди откроются {len(todo)} ссылок в браузере, где ты вошёл в claude.ai.\n"
              "Если браузер спросит про скачивание нескольких файлов — нажми «Разрешить».\n"
              "Вкладки не закрывай и ссылки повторно не открывай.")
        if input("Начать? (д/н) ").strip().lower() not in ("д", "да", "y"):
            print("Отменено. Манифест лежит в inbox, можно запустить позже.")
            return
        t0 = time.time()
        try:
            for i, e in enumerate(todo, 1):
                name, url = e["filename"], str(e.get("export_url", ""))
                key = sha256(mp)[:12] + ":" + name
                if not url.startswith("https://"):
                    print(f"{i}/{len(todo)}: {name} — в манифесте нет https-ссылки, пропускаю")
                    continue
                if key in state["opened"]:
                    print(f"{i}/{len(todo)}: {name} — ссылка уже открывалась {state['opened'][key]}, может не сработать.")
                    if input("  Открыть ещё раз? (д/н) ").strip().lower() not in ("д", "да"):
                        continue
                # д) одна ссылка — одно открытие, повторов не делаем
                webbrowser.open(url)
                state["opened"][key] = datetime.now().strftime("%Y-%m-%d %H:%M")
                save_state(root, state)
                print(f"{i}/{len(todo)}: {name} — открыта ссылка, ждём загрузку …")
                got = wait_for_download(dl, name, t0)
                if got is None:
                    print(f"{i}/{len(todo)}: {name} — не дождались за {FILE_TIMEOUT // 60} мин")
                    continue
                shutil.move(str(got), str(unique_path(inbox / name)))     # е) переносим, не копируем
                print(f"{i}/{len(todo)}: {name} — готово")
        except KeyboardInterrupt:
            print("\nПрервано (Ctrl+C). Уже скачанные файлы лежат в inbox.")
    # ж) проверка набора
    bad = []
    for e in entries:
        p = inbox / e["filename"]
        if e["filename"] in done:
            continue
        if not p.exists():
            bad.append(f"  - {e['filename']}: файла нет")
        elif not zipfile.is_zipfile(p):
            bad.append(f"  - {e['filename']}: файл повреждён (не открывается как zip)")
    if bad:
        print("\nНабор неполный:\n" + "\n".join(bad) +
              "\nСсылка на такой файл могла быть уже использована или истечь. Автоматически я её повторно\n"
              "не открываю: проще запросить новый экспорт (шаг 1 инструкции, пункт 1 меню).")
        return
    # з) всё на месте — обработка без вопросов
    print("\nВсе файлы набора на месте. Запускаю обработку …\n")
    run_export(root, state)


def pick_manifest(root):
    """Пункт меню 3: манифест из inbox или путь, введённый вручную."""
    man = list_inbox(root)[0]
    if len(man) == 1:
        print(f"Беру манифест из inbox: {man[0].name}")
        return man[0]
    if len(man) > 1:
        for i, p in enumerate(man, 1):
            print(f"  {i} — {p.name}")
        a = input("Номер манифеста: ").strip()
        return man[int(a) - 1] if a.isdigit() and 1 <= int(a) <= len(man) else None
    a = input("В inbox нет манифеста. Путь к manifest-….json (можно перетащить файл в окно): ").strip().strip('"')
    return Path(a) if a else None


# ---------- меню ----------

def open_path(p):
    if hasattr(os, "startfile"):
        os.startfile(str(p))
    else:
        print(f"  (не Windows) {p}")


def show_instruction(root):
    print("\nКАК ПОЛУЧИТЬ СВЕЖИЕ ДАННЫЕ\n")
    print(INSTRUCTION)
    if input("Открыть папку inbox и страницу claude.ai? (д/н) ").strip().lower() in ("д", "да", "y"):
        open_path(root / "inbox")
        webbrowser.open("https://claude.ai")


def status_line(root, state):
    man, zips, mems, _ = list_inbox(root)
    known = {(v.get("file"), v.get("size")) for v in state["hashes"].values()}
    waiting = sum(1 for p in man + zips + mems if (p.name, p.stat().st_size) not in known)
    d = days_ago(state.get("last_export"))
    when = "ещё ни разу" if d is None else f"{d} дн. назад"
    line = f"Последний экспорт обработан {when}, в inbox ждут {waiting} новых файлов"
    if d is not None and d > EXPORT_REMIND_DAYS:
        line += f"\nПоследний экспорт старше {EXPORT_REMIND_DAYS} дней — пора запросить новый (пункт 1)."
    return line


def main():
    for st in (sys.stdout, sys.stderr, sys.stdin):
        try:
            st.reconfigure(encoding="utf-8")
        except Exception:
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", nargs="?", default="", help="manifest-*.json (перетащите на Выгрузить.bat)")
    ap.add_argument("--config", default=str(HERE / "config.json"))
    ap.add_argument("--run", action="store_true", help="сразу выполнить пункт 2 (для проверки)")
    ap.add_argument("--partial", action="store_true", help="с --run: обработать неполный набор")
    args = ap.parse_args()

    cfg_path = Path(args.config)
    cfg = load_config(cfg_path)
    root = Path(cfg["archive_root"])
    err = check_root(root)
    if err:
        print(err)
        return 1
    ensure_dirs(root)
    state = load_state(root)

    try:
        if args.manifest.strip():                     # файл перетащили на .bat
            mp = Path(args.manifest.strip().strip('"'))
            if not mp.is_file() or mp.suffix.lower() != ".json":
                print(f"Нужен файл manifest-….json из письма Claude, а получено: {mp}")
                return 1
            download_set(root, state, cfg, cfg_path, mp)
            return 0
        if args.run:
            run_export(root, state, args.partial)
            return 0
        print(status_line(root, state))
        print("\n  1 — Показать инструкцию: как получить свежие данные\n"
              "  2 — Выгрузить: обработать то, что лежит в inbox\n"
              "  3 — Скачать набор по манифесту\n"
              "  4 — Открыть папки (inbox, архив) в Проводнике\n"
              "  0 — Выход\n")
        while True:
            choice = input("Ваш выбор (0–4): ").strip()
            if choice in ("0", "1", "2", "3", "4"):
                break
            print("Введите цифру от 0 до 4.")
        if choice == "1":
            show_instruction(root)
        elif choice == "2":
            run_export(root, state)
        elif choice == "3":
            mp = pick_manifest(root)
            if mp and mp.is_file():
                download_set(root, state, cfg, cfg_path, mp)
            elif mp:
                print(f"Файл не найден: {mp}")
        elif choice == "4":
            open_path(root / "inbox")
            open_path(root)
    except Exception as e:
        log(root, f"ОШИБКА: {e!r}")
        print(f"\nОшибка: {e}\nПодробности — в log.txt. Файлы в inbox не тронуты.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
