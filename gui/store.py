# -*- coding: utf-8 -*-
"""
任务数据层：解析 / 回写 tasks/tasks.md，并汇总完成历史给热度图用。

刻意和 Node 那边的 src/tasks.mjs 保持同样的文件格式：
    - [ ] 标题 @2026-09-25 !高 #标签
    - [x] 标题（已完成）
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Iterable

# ---------------------------------------------------------------- 文件位置

def project_root() -> Path:
    """找到项目根目录（含 tasks/tasks.md 的那一层）。

    冻结成 exe 后 __file__ 指向临时解包目录，所以必须用 sys.executable。
    """
    import sys

    candidates: list[Path] = []
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        candidates.append(exe_dir)
        # exe 放在 gui/dist 里也能向上找
        candidates.extend(list(exe_dir.parents)[:3])
    else:
        here = Path(__file__).resolve().parent
        candidates.append(here)
        candidates.extend(list(here.parents)[:3])

    # 1) 同目录有配置就按配置走
    for base in candidates:
        cfg = base / "gui_config.json"
        if cfg.is_file():
            try:
                data = json.loads(cfg.read_text(encoding="utf-8"))
                p = Path(data.get("project_root", "")).expanduser()
                if p.is_dir() and (p / "tasks" / "tasks.md").is_file():
                    return p.resolve()
            except Exception:
                pass

    # 2) 否则自动向上找 tasks/tasks.md
    for base in candidates:
        if (base / "tasks" / "tasks.md").is_file():
            return base.resolve()

    # 3) 兜底：exe 所在目录
    return candidates[0] if candidates else Path.cwd()


ROOT = project_root()
TASKS_FILE = ROOT / "tasks" / "tasks.md"
DONE_FILE = ROOT / "tasks" / "done.md"
STATE_FILE = ROOT / "data" / "state.json"
LOCAL_LOG = ROOT / "data" / "gui_completions.json"

# ---------------------------------------------------------------- 解析

TASK_LINE = re.compile(r"^(\s*)[-*]\s+\[([ xX])\]\s+(.*?)\s*$")
SECTION_LINE = re.compile(r"^\s*#{2,4}\s+(.+?)\s*$")
DUE_RE = re.compile(r"@(\d{4}-\d{2}-\d{2})")
PRIO_RE = re.compile(r"!(高|中|低|high|medium|low)", re.IGNORECASE)
TAG_RE = re.compile(r"(?:^|\s)#\s*([^\s#]+)")
COMMENT_RE = re.compile(r"<!--[\s\S]*?-->")

PRIORITY_MAP = {"高": "high", "中": "medium", "低": "low",
                "high": "high", "medium": "medium", "low": "low"}
PRIORITY_CN = {"high": "高", "medium": "中", "low": "低"}
PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}


@dataclass
class Task:
    line_index: int
    raw: str
    done: bool
    title: str
    due: str | None = None
    priority: str = "medium"
    tags: list[str] = field(default_factory=list)
    section: str = ""

    @property
    def key(self) -> str:
        """稳定标识：和 Node 那边的归一化方式一致（标题小写、压缩空格）。"""
        return re.sub(r"\s+", " ", self.title).strip().lower()

    def due_delta(self, today: date | None = None) -> int | None:
        """距离截止还有几天（负数=已逾期）。"""
        if not self.due:
            return None
        try:
            d = date.fromisoformat(self.due)
        except ValueError:
            return None
        return (d - (today or date.today())).days


def _blank_comments(text: str) -> str:
    """把 HTML 注释挖空但保留换行，保证行号不错位。"""
    return COMMENT_RE.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)


def load_tasks(path: Path | None = None) -> tuple[list[Task], list[str], str]:
    """返回 (任务列表, 出现的分组名, 文件原文)。"""
    path = path or TASKS_FILE
    content = path.read_text(encoding="utf-8")
    lines = _blank_comments(content).splitlines()

    tasks: list[Task] = []
    sections: list[str] = []
    current = ""

    for i, line in enumerate(lines):
        sec = SECTION_LINE.match(line)
        if sec:
            current = sec.group(1)
            if current not in sections:
                sections.append(current)
            continue

        m = TASK_LINE.match(line)
        if not m:
            continue

        done = m.group(2).lower() == "x"
        body = m.group(3)

        due = None
        dm = DUE_RE.search(body)
        if dm:
            due = dm.group(1)
            body = DUE_RE.sub(" ", body)

        priority = "medium"
        pm = PRIO_RE.search(body)
        if pm:
            priority = PRIORITY_MAP.get(pm.group(1).lower(), "medium")
            body = PRIO_RE.sub(" ", body)

        tags = [t.strip() for t in TAG_RE.findall(body) if t.strip()]
        body = TAG_RE.sub(" ", body)

        title = re.sub(r"\s+", " ", body).strip()
        if not title:
            continue

        tasks.append(Task(
            line_index=i,
            raw=line,
            done=done,
            title=title,
            due=due,
            priority=priority,
            tags=tags,
            section=current,
        ))

    return tasks, sections, content


def toggle_done(task: Task, tasks: list[Task], path: Path | None = None) -> bool:
    """翻转一条任务的完成状态并写回文件，返回新状态。"""
    path = path or TASKS_FILE
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    if task.line_index >= len(lines):
        raise IndexError("行号越界，文件可能已被外部修改")

    line = lines[task.line_index]
    if re.search(r"\[ \]", line):
        lines[task.line_index] = re.sub(r"\[ \]", "[x]", line, count=1)
        new_done = True
    elif re.search(r"\[[xX]\]", line):
        lines[task.line_index] = re.sub(r"\[[xX]\]", "[ ]", line, count=1)
        new_done = False
    else:
        raise ValueError("这一行不是任务格式")

    path.write_text("".join(lines), encoding="utf-8")
    task.done = new_done
    return new_done


def append_task(title: str, due: str = "", priority: str = "", tags: str = "",
                section: str = "进行中", path: Path | None = None) -> str:
    """在指定分组末尾追加一条任务，返回写入的那一行。"""
    path = path or TASKS_FILE
    content = path.read_text(encoding="utf-8")
    lines = content.splitlines()

    meta = []
    if due:
        meta.append("@" + due)
    if priority and priority in ("高", "中", "低"):
        meta.append("!" + priority)
    for t in re.split(r"[\s,，、]+", tags or ""):
        t = t.strip().lstrip("#")
        if t:
            meta.append("#" + t)

    new_line = "- [ ] " + title.strip() + ((" " + " ".join(meta)) if meta else "")

    heading = SECTION_LINE
    start = -1
    end = len(lines)
    for i, line in enumerate(lines):
        m = heading.match(line)
        if m and m.group(1) == section:
            start = i
            for j in range(i + 1, len(lines)):
                if heading.match(lines[j]):
                    end = j
                    break
            break

    if start == -1:
        out = content.rstrip() + "\n\n## " + section + "\n\n" + new_line + "\n"
    else:
        insert_at = end
        while insert_at > start + 1 and not lines[insert_at - 1].strip():
            insert_at -= 1
        lines.insert(insert_at, new_line)
        out = "\n".join(lines) + "\n"

    path.write_text(out, encoding="utf-8")
    return new_line


# ---------------------------------------------------------------- 完成历史（热度图）

DONE_ARCHIVE_RE = re.compile(r"-\s*\[x\]\s*(.*?)（完成于\s*(\d{4}-\d{2}-\d{2})）")


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_local_log() -> dict[str, str]:
    """GUI 自己记的完成日期：{任务标题: YYYY-MM-DD}。"""
    return _read_json(LOCAL_LOG, {})


def record_completion(task: Task, when: date | None = None) -> None:
    log = load_local_log()
    log[task.title] = (when or date.today()).isoformat()
    _write_json(LOCAL_LOG, log)


def forget_completion(task: Task) -> None:
    log = load_local_log()
    if log.pop(task.title, None) is not None:
        _write_json(LOCAL_LOG, log)


def completion_by_day() -> dict[str, int]:
    """汇总三种来源，返回 {YYYY-MM-DD: 完成数量}。

    优先级（后者覆盖前者）：
      1. tasks/done.md 归档记录（最全的历史，来自云端自动归档）
      2. data/state.json 的 completedAt（云端每天晚上记录的）
      3. data/gui_completions.json（GUI 本地即时记录的）
    """
    merged: dict[str, str] = {}   # 任务标题 -> 完成日期

    if DONE_FILE.is_file():
        text = DONE_FILE.read_text(encoding="utf-8")
        for title, d in DONE_ARCHIVE_RE.findall(text):
            merged[title.strip()] = d

    state = _read_json(STATE_FILE, {})
    for title, d in (state.get("completedAt") or {}).items():
        if isinstance(d, str) and len(d) == 10:
            merged[title] = d

    for title, d in load_local_log().items():
        if isinstance(d, str) and len(d) == 10:
            merged[title] = d

    by_day: dict[str, int] = {}
    for d in merged.values():
        by_day[d] = by_day.get(d, 0) + 1
    return by_day


def stats() -> dict:
    tasks, _, _ = load_tasks()
    today = date.today()
    open_tasks = [t for t in tasks if not t.done]
    overdue = [t for t in open_tasks if (t.due_delta(today) or 0) < 0]
    by_day = completion_by_day()
    month = today.strftime("%Y-%m")
    return {
        "open": len(open_tasks),
        "done": len([t for t in tasks if t.done]),
        "overdue": len(overdue),
        "done_today": by_day.get(today.isoformat(), 0),
        "done_this_month": sum(v for k, v in by_day.items() if k.startswith(month)),
    }
