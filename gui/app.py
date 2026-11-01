# -*- coding: utf-8 -*-
"""个人咨询管家 · 任务面板（customtkinter / 可打包成 exe）"""
from __future__ import annotations

import subprocess
import threading
import tkinter as tk
from datetime import date
from pathlib import Path

import customtkinter as ctk

import store
from heatmap import Heatmap, CalendarView

APP_TITLE = "个人咨询管家 · 任务面板"
FONT = "Microsoft YaHei UI"

PRIORITY_COLOR = {
    "high": ("#d64545", "#ff6b6b"),
    "medium": ("#c77d1a", "#ffb454"),
    "low": ("#7a828e", "#8b949e"),
}
PRIORITY_CN = {"high": "高", "medium": "中", "low": "低"}


def _font(size: int, weight: str = "normal") -> ctk.CTkFont:
    return ctk.CTkFont(family=FONT, size=size, weight=weight)


def _dark() -> bool:
    return ctk.get_appearance_mode().lower() == "dark"


def _fg(light_hex: str, dark_hex: str) -> str:
    return dark_hex if _dark() else light_hex


# ==================================================================== 任务卡片

class TaskCard(ctk.CTkFrame):
    def __init__(self, master, task: store.Task, on_toggle, today: date):
        super().__init__(master, corner_radius=8, border_width=0,
                         fg_color=_fg("#ffffff", "#252526"))
        self.task = task
        self._on_toggle = on_toggle

        self.grid_columnconfigure(1, weight=1)

        self.var = tk.BooleanVar(value=task.done)
        self.cb = ctk.CTkCheckBox(
            self, text="", width=22, variable=self.var,
            checkbox_width=18, checkbox_height=18, corner_radius=4,
            border_width=2, command=self._toggled)
        self.cb.grid(row=0, column=0, rowspan=2, padx=(8, 4), pady=8, sticky="n")

        self.title_lbl = ctk.CTkLabel(
            self, text=task.title, font=_font(13),
            anchor="w", justify="left", wraplength=360,
            text_color=_fg("#1f2328", "#e6edf3"))
        self.title_lbl.grid(row=0, column=1, sticky="w", padx=(0, 8), pady=(8, 0))

        # 元信息：截止 / 优先级 / 标签
        bits = []
        delta = task.due_delta(today)
        if task.due:
            if delta is None:
                bits.append(task.due)
            elif delta < 0:
                bits.append(f"逾期 {-delta} 天")
            elif delta == 0:
                bits.append("今天到期")
            else:
                bits.append(f"{delta} 天后")
        if task.priority != "medium":
            bits.append("!" + PRIORITY_CN.get(task.priority, "中"))
        bits.extend("#" + t for t in task.tags)

        self.meta_lbl = ctk.CTkLabel(
            self, text="   ".join(bits) if bits else " ", font=_font(11),
            anchor="w", justify="left", wraplength=360,
            text_color=PRIORITY_COLOR.get(task.priority, ("#7a828e", "#8b949e"))
            if task.priority == "high" else _fg("#6e7781", "#8b949e"))
        self.meta_lbl.grid(row=1, column=1, sticky="w", padx=(0, 8), pady=(0, 8))

        if task.done:
            self.title_lbl.configure(text_color=_fg("#8b949e", "#6e7681"))

    def _toggled(self) -> None:
        self._on_toggle(self.task, self.var.get())

    def set_wrap(self, px: int) -> None:
        w = max(160, px)
        self.title_lbl.configure(wraplength=w)
        self.meta_lbl.configure(wraplength=w)


class TaskPane(ctk.CTkFrame):
    """一列任务列表（未完成 / 已完成）。"""

    def __init__(self, master, title: str, empty_text: str, on_toggle):
        super().__init__(master, corner_radius=10, fg_color=_fg("#f6f8fa", "#1e1e1e"))
        self._on_toggle = on_toggle
        self._cards: list[TaskCard] = []
        self._title = title
        self._empty_text = empty_text
        self._today = date.today()

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        head = ctk.CTkFrame(self, fg_color="transparent", height=30)
        head.grid(row=0, column=0, sticky="ew", padx=10, pady=(8, 2))
        head.grid_columnconfigure(1, weight=1)
        self.head_lbl = ctk.CTkLabel(head, text=title, font=_font(14, "bold"), anchor="w")
        self.head_lbl.grid(row=0, column=0, sticky="w")
        self.count_lbl = ctk.CTkLabel(head, text="", font=_font(11),
                                      text_color=_fg("#6e7781", "#8b949e"))
        self.count_lbl.grid(row=0, column=1, sticky="e")

        self.scroll = ctk.CTkScrollableFrame(self, fg_color="transparent", corner_radius=0)
        self.scroll.grid(row=1, column=0, sticky="nsew", padx=4, pady=(0, 6))
        self.scroll.grid_columnconfigure(0, weight=1)
        # 滚动容器内部还有一个 canvas，宽度变化实际发生在它身上
        inner = getattr(self.scroll, "_parent_canvas", None)
        target = inner if inner is not None else self.scroll
        target.bind("<Configure>", self._on_resize, add="+")

    def _on_resize(self, event) -> None:
        px = max(160, event.width - 78)
        for c in self._cards:
            if isinstance(c, TaskCard):
                c.set_wrap(px)

    def update_wrap(self) -> None:
        """内容重建后按当前宽度重算换行。"""
        width = self.scroll.winfo_width()
        if width <= 1:
            width = self.winfo_width()
        for c in self._cards:
            if isinstance(c, TaskCard):
                c.set_wrap(max(160, width - 78))

    def set_tasks(self, tasks: list[store.Task]) -> None:
        # 直接清空容器里的所有子控件。
        # 不能只销毁 self._cards 里记录的：空状态提示标签没有进那个列表，
        # 只销毁卡片会让「还没有完成的任务」这类占位每次刷新都残留一份，越积越多。
        for w in self.scroll.winfo_children():
            w.destroy()
        self._cards.clear()

        self.head_lbl.configure(text=self._title)
        self.count_lbl.configure(text=f"{len(tasks)} 项")

        if not tasks:
            lbl = ctk.CTkLabel(self.scroll, text=self._empty_text, font=_font(12),
                               text_color=_fg("#8b949e", "#6e7681"))
            lbl.pack(pady=24)
            return

        for t in tasks:
            card = TaskCard(self.scroll, t, self._on_toggle, self._today)
            card.pack(fill="x", padx=4, pady=3)
            self._cards.append(card)

        self.after(30, self.update_wrap)


# ==================================================================== 新建对话框

class AddTaskDialog(ctk.CTkToplevel):
    def __init__(self, master, on_submit):
        super().__init__(master)
        self.title("新建任务")
        self.geometry("460x330")
        self.resizable(False, False)
        self.transient(master)
        self._on_submit = on_submit

        self.grid_columnconfigure(1, weight=1)
        pad = {"padx": 14, "pady": 6}

        ctk.CTkLabel(self, text="任务内容", font=_font(12)).grid(row=0, column=0, sticky="w", **pad)
        self.title_entry = ctk.CTkEntry(self, font=_font(13), placeholder_text="要做什么")
        self.title_entry.grid(row=0, column=1, sticky="ew", **pad)

        ctk.CTkLabel(self, text="截止日期", font=_font(12)).grid(row=1, column=0, sticky="w", **pad)
        self.due_entry = ctk.CTkEntry(self, font=_font(13), placeholder_text="2026-11-10（可留空）")
        self.due_entry.grid(row=1, column=1, sticky="ew", **pad)

        ctk.CTkLabel(self, text="优先级", font=_font(12)).grid(row=2, column=0, sticky="w", **pad)
        self.prio = ctk.CTkSegmentedButton(self, values=["不设置", "高", "中", "低"], font=_font(12))
        self.prio.set("不设置")
        self.prio.grid(row=2, column=1, sticky="ew", **pad)

        ctk.CTkLabel(self, text="标签", font=_font(12)).grid(row=3, column=0, sticky="w", **pad)
        self.tags_entry = ctk.CTkEntry(self, font=_font(13), placeholder_text="空格分隔，不用写 #")
        self.tags_entry.grid(row=3, column=1, sticky="ew", **pad)

        ctk.CTkLabel(self, text="加到分组", font=_font(12)).grid(row=4, column=0, sticky="w", **pad)
        self.section_entry = ctk.CTkEntry(self, font=_font(13))
        self.section_entry.insert(0, "进行中")
        self.section_entry.grid(row=4, column=1, sticky="ew", **pad)

        self.msg = ctk.CTkLabel(self, text="", font=_font(11), text_color=("#c0392b", "#ff6b6b"))
        self.msg.grid(row=5, column=0, columnspan=2, sticky="w", padx=14)

        btns = ctk.CTkFrame(self, fg_color="transparent")
        btns.grid(row=6, column=0, columnspan=2, sticky="e", padx=14, pady=10)
        ctk.CTkButton(btns, text="取消", width=80, fg_color="transparent", border_width=1,
                      command=self.destroy).pack(side="right", padx=(8, 0))
        ctk.CTkButton(btns, text="添加", width=90, command=self._submit).pack(side="right")

        self.title_entry.focus_set()
        self.bind("<Return>", lambda _e: self._submit())
        self.bind("<Escape>", lambda _e: self.destroy())
        self.after(120, self.grab_set)

    def _submit(self) -> None:
        title = self.title_entry.get().strip()
        if not title:
            self.msg.configure(text="任务内容不能为空")
            return
        due = self.due_entry.get().strip()
        if due:
            try:
                date.fromisoformat(due.replace("/", "-"))
                due = due.replace("/", "-")
            except ValueError:
                self.msg.configure(text="日期格式应为 2026-11-10")
                return
        prio = self.prio.get()
        self._on_submit(title, due, "" if prio == "不设置" else prio,
                        self.tags_entry.get().strip(), self.section_entry.get().strip() or "进行中")
        self.destroy()


# ==================================================================== 主窗口

class App(ctk.CTk):
    def __init__(self, layout: str = "horizontal"):
        super().__init__()
        self.title(APP_TITLE)
        self._fit_to_screen()
        self.minsize(900, 560)

        self._layout = "vertical" if layout == "vertical" else "horizontal"
        self._cal_view = "heatmap"
        self._cal_widget = None
        self._by_day_cache: dict[str, int] = {}
        self._busy = False

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)   # 任务区吃掉多余空间
        self.grid_rowconfigure(2, weight=0)   # 热度图保持自然高度
        self.grid_rowconfigure(3, weight=0)   # 状态栏

        self._build_header()
        self._build_panes()
        self._build_heatmap()
        self._build_statusbar()

        self.bind("<F5>", lambda _e: self.reload())
        self.bind("<Control-n>", lambda _e: self.open_add_dialog())

        self.reload(initial=True)

    # ------------------------------------------------------------ 尺寸

    def _fit_to_screen(self) -> None:
        """按屏幕尺寸自适应。

        注意 customtkinter 会把 geometry 的数值再乘一次 DPI 缩放（常见 1.25），
        所以这里要先把屏幕尺寸换算成「逻辑像素」再算窗口大小，否则窗口会溢出屏幕。
        """
        self.update_idletasks()
        try:
            scale = ctk.ScalingTracker.get_window_scaling(self) or 1.0
        except Exception:
            scale = 1.0

        sw, sh = self.winfo_screenwidth(), self.winfo_screenheight()
        lw, lh = sw / scale, sh / scale

        w = int(max(880, min(1260, lw - 50)))
        h = int(max(560, min(760, lh - 120)))
        x = int(max(0, (lw - w) / 2))
        y = int(max(0, (lh - h) / 2 - 18))
        self.geometry(f"{w}x{h}+{x}+{y}")

    # ------------------------------------------------------------ 头部

    def _build_header(self) -> None:
        head = ctk.CTkFrame(self, corner_radius=0, height=64,
                            fg_color=_fg("#ffffff", "#1a1a1a"))
        head.grid(row=0, column=0, sticky="ew")
        head.grid_columnconfigure(1, weight=1)

        left = ctk.CTkFrame(head, fg_color="transparent")
        left.grid(row=0, column=0, sticky="w", padx=16, pady=10)

        ctk.CTkLabel(left, text="个人咨询管家", font=_font(18, "bold")).grid(row=0, column=0, sticky="w")
        self.date_lbl = ctk.CTkLabel(left, text="", font=_font(11),
                                     text_color=_fg("#6e7781", "#8b949e"))
        self.date_lbl.grid(row=1, column=0, sticky="w")

        self.stat_lbl = ctk.CTkLabel(head, text="", font=_font(12),
                                     text_color=_fg("#57606a", "#8b949e"))
        self.stat_lbl.grid(row=0, column=1, sticky="e", padx=16)

        btns = ctk.CTkFrame(head, fg_color="transparent")
        btns.grid(row=0, column=2, sticky="e", padx=(0, 16))

        self.btn_add = ctk.CTkButton(btns, text="＋ 新建任务", width=110, height=30,
                                     font=_font(12, "bold"), command=self.open_add_dialog)
        self.btn_add.pack(side="left", padx=4)

        outline = dict(fg_color="transparent", border_width=1,
                       border_color=_fg("#d0d7de", "#3d444d"),
                       text_color=_fg("#1f2328", "#e6edf3"),
                       hover_color=_fg("#f3f4f6", "#2d333b"))

        self.btn_layout = ctk.CTkButton(
            btns, width=104, height=30, font=_font(12), command=self.toggle_layout,
            text="⇅ 上下分栏" if self._layout == "horizontal" else "⇄ 左右分栏", **outline)
        self.btn_layout.pack(side="left", padx=4)

        self.btn_theme = ctk.CTkButton(btns, text="◐ 主题", width=78, height=30,
                                       font=_font(12), command=self.toggle_theme, **outline)
        self.btn_theme.pack(side="left", padx=4)

        self.btn_sync = ctk.CTkButton(btns, text="⟳ 同步", width=82, height=30,
                                      font=_font(12), command=self.do_sync)
        self.btn_sync.pack(side="left", padx=4)

    # ------------------------------------------------------------ 任务区

    def _build_panes(self) -> None:
        self.split = ctk.CTkFrame(self, fg_color="transparent")
        self.split.grid(row=1, column=0, sticky="nsew", padx=12, pady=(10, 6))

        self.pane_open = TaskPane(self.split, "未完成", "全部做完了 🎉", self.on_toggle)
        self.pane_done = TaskPane(self.split, "已完成", "还没有完成的任务", self.on_toggle)

        self._apply_layout()

    def _apply_layout(self) -> None:
        for w in self.split.grid_slaves():
            w.grid_forget()

        if self._layout == "horizontal":
            self.split.grid_rowconfigure(0, weight=1)
            self.split.grid_rowconfigure(1, weight=0)
            self.split.grid_columnconfigure(0, weight=1, uniform="p")
            self.split.grid_columnconfigure(1, weight=1, uniform="p")
            self.pane_open.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
            self.pane_done.grid(row=0, column=1, sticky="nsew", padx=(6, 0))
        else:
            self.split.grid_columnconfigure(0, weight=1)
            self.split.grid_columnconfigure(1, weight=0)
            self.split.grid_rowconfigure(0, weight=1, uniform="p")
            self.split.grid_rowconfigure(1, weight=1, uniform="p")
            self.pane_open.grid(row=0, column=0, sticky="nsew", pady=(0, 6))
            self.pane_done.grid(row=1, column=0, sticky="nsew", pady=(6, 0))

    def toggle_layout(self) -> None:
        self._layout = "vertical" if self._layout == "horizontal" else "horizontal"
        store.save_pref("layout", self._layout)
        self.btn_layout.configure(text="⇅ 上下分栏" if self._layout == "horizontal" else "⇄ 左右分栏")
        self._apply_layout()
        self.after(60, lambda: self.reload())

    # ------------------------------------------------------------ 热度图

    def _build_heatmap(self) -> None:
        box = ctk.CTkFrame(self, corner_radius=10, fg_color=_fg("#f6f8fa", "#1e1e1e"))
        box.grid(row=2, column=0, sticky="ew", padx=12, pady=(0, 4))
        box.grid_columnconfigure(0, weight=1)
        self.heat_box = box

        head = ctk.CTkFrame(box, fg_color="transparent")
        head.grid(row=0, column=0, sticky="ew", padx=12, pady=(6, 0))
        head.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(head, text="完成情况", font=_font(13, "bold"), anchor="w").grid(
            row=0, column=0, sticky="w")

        self.view_switch = ctk.CTkSegmentedButton(
            head, values=["热力图", "日历"], font=_font(11), height=24,
            text_color=_fg("#1f2328", "#e6edf3"),
            unselected_color=_fg("#eef1f4", "#2d333b"),
            unselected_hover_color=_fg("#e3e7ec", "#353b45"),
            command=self._switch_view)
        self.view_switch.set("热力图" if self._cal_view == "heatmap" else "日历")
        self.view_switch.grid(row=0, column=2, sticky="e")

        self._mount_view()

    def _mount_view(self) -> None:
        """按当前选择挂载热力图或日历。"""
        if getattr(self, "_cal_widget", None) is not None:
            self._cal_widget.destroy()

        cls = Heatmap if self._cal_view == "heatmap" else CalendarView
        self._cal_widget = cls(self.heat_box, getattr(self, "_by_day_cache", {}))
        self._cal_widget.grid(row=1, column=0, sticky="w", padx=12, pady=(2, 8))

    def _switch_view(self, value: str) -> None:
        self._cal_view = "heatmap" if value == "热力图" else "calendar"
        store.save_pref("view", self._cal_view)
        self._mount_view()

    def _update_calendar(self, by_day: dict) -> None:
        self._by_day_cache = by_day
        if getattr(self, "_cal_widget", None) is not None:
            self._cal_widget.set_data(by_day)

    # ------------------------------------------------------------ 状态栏

    def _build_statusbar(self) -> None:
        bar = ctk.CTkFrame(self, corner_radius=0, height=26, fg_color="transparent")
        bar.grid(row=3, column=0, sticky="ew")
        bar.grid_columnconfigure(0, weight=1)

        self.status = ctk.CTkLabel(bar, text="", font=_font(10), anchor="w",
                                   text_color=_fg("#6e7781", "#8b949e"))
        self.status.grid(row=0, column=0, sticky="w", padx=16, pady=(0, 6))

        ctk.CTkLabel(bar, text=str(store.ROOT), font=_font(10), anchor="e",
                     text_color=_fg("#8b949e", "#6e7681")).grid(row=0, column=1, sticky="e", padx=16, pady=(0, 6))

    # ------------------------------------------------------------ 行为

    def set_status(self, text: str) -> None:
        self.status.configure(text=text)

    def reload(self, initial: bool = False) -> None:
        try:
            tasks, _sections, _raw = store.load_tasks()
        except Exception as exc:
            self.set_status(f"读取 tasks.md 失败：{exc}")
            return

        today = date.today()
        open_tasks = [t for t in tasks if not t.done]
        done_tasks = [t for t in tasks if t.done]

        def sort_open(t: store.Task):
            delta = t.due_delta(today)
            return (0 if delta is not None else 1,
                    delta if delta is not None else 10_000,
                    store.PRIORITY_ORDER.get(t.priority, 1),
                    t.title)

        open_tasks.sort(key=sort_open)

        by_day = store.completion_by_day()
        done_tasks.sort(key=lambda t: (by_day.get(t.title, "0000-00-00"), t.title), reverse=True)

        self.pane_open.set_tasks(open_tasks)
        self.pane_done.set_tasks(done_tasks)

        self.pane_open.head_lbl.configure(text=f"未完成（{len(open_tasks)}）")
        self.pane_done.head_lbl.configure(text=f"已完成（{len(done_tasks)}）")

        s = store.stats()
        self.date_lbl.configure(text=f"{today.strftime('%Y 年 %m 月 %d 日')}  " +
                                     ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][today.weekday()])
        self.stat_lbl.configure(
            text=f"未完成 {s['open']}   ·   逾期 {s['overdue']}   ·   "
                 f"今天完成 {s['done_today']}   ·   本月完成 {s['done_this_month']}")
        self._update_calendar(by_day)

        if initial:
            self.set_status("就绪 —— 勾选即保存到 tasks.md；点「同步」推送云端")

    def on_toggle(self, task: store.Task, checked: bool) -> None:
        try:
            new_done = store.toggle_done(task, [])
            if new_done:
                store.record_completion(task)
            else:
                store.forget_completion(task)
            self.set_status(("已完成：" if new_done else "已恢复未完成：") + task.title[:36])
        except Exception as exc:
            self.set_status(f"写回失败：{exc}")
        self.after(40, lambda: self.reload())

    def open_add_dialog(self) -> None:
        AddTaskDialog(self, self._on_add)

    def _on_add(self, title, due, prio, tags, section) -> None:
        try:
            line = store.append_task(title, due, prio, tags, section)
            self.set_status("已添加：" + line[:48])
        except Exception as exc:
            self.set_status(f"添加失败：{exc}")
        self.reload()

    def toggle_theme(self) -> None:
        new_mode = "light" if _dark() else "dark"
        ctk.set_appearance_mode(new_mode)
        store.save_pref("theme", new_mode)
        self._rebuild_theme()

    def _rebuild_theme(self) -> None:
        for w in self.winfo_children():
            w.destroy()
        self._cal_widget = None
        self._fit_to_screen()
        self._build_header()
        self._build_panes()
        self._build_heatmap()
        self._build_statusbar()
        self.reload()

    # ------------------------------------------------------------ git 同步

    def do_sync(self) -> None:
        if self._busy:
            return
        self._busy = True
        self.btn_sync.configure(state="disabled", text="同步中…")
        self.set_status("正在同步…")
        threading.Thread(target=self._sync_worker, daemon=True).start()

    @staticmethod
    def _git(*args: str) -> tuple[int, str]:
        try:
            p = subprocess.run(["git", *args], cwd=str(store.ROOT),
                               capture_output=True, text=True, timeout=90,
                               encoding="utf-8", errors="replace")
            return p.returncode, (p.stdout or "") + (p.stderr or "")
        except FileNotFoundError:
            return -1, "找不到 git，请确认已安装并在 PATH 中"
        except subprocess.TimeoutExpired:
            return -2, "git 超时"
        except Exception as exc:  # noqa: BLE001
            return -3, str(exc)

    def _sync_worker(self) -> None:
        steps = []
        code, out = self._git("pull", "--rebase", "--autostash")
        steps.append(("拉取", code, out))

        code, out = self._git("add", "tasks", "data")
        if code != 0:
            steps.append(("暂存", code, out))
        code, out = self._git("status", "--porcelain", "--", "tasks", "data")
        has_change = bool(out.strip())

        if has_change:
            code, out = self._git("commit", "-m", f"gui: {date.today().isoformat()} 更新任务")
            steps.append(("提交", code, out))
            if code == 0:
                code, out = self._git("push")
                steps.append(("推送", code, out))

        self.after(0, lambda: self._sync_done(steps, has_change))

    def _sync_done(self, steps, has_change: bool) -> None:
        self._busy = False
        self.btn_sync.configure(state="normal", text="⟳ 同步")
        failed = [s for s in steps if s[1] not in (0,)]
        if failed:
            name, _code, out = failed[0]
            first = [l for l in out.splitlines() if l.strip()][:1]
            self.set_status(f"{name}失败：{first[0] if first else '未知错误'}")
        elif not has_change:
            self.set_status("已是最新，没有需要同步的改动")
        else:
            self.set_status("已同步到云端 ✓")
        self.reload()


def _selftest() -> None:
    """无界面自检：验证路径解析 + 读写 tasks.md 都正常（打包后用 exe 跑一次）。"""
    print("ROOT      :", store.ROOT)
    print("tasks.md  :", store.TASKS_FILE, "exists =", store.TASKS_FILE.is_file())
    print("done.md   :", store.DONE_FILE.is_file())
    print("state.json:", store.STATE_FILE.is_file())

    tasks, sections, _ = store.load_tasks()
    print("sections  :", sections)
    print("tasks     :", len(tasks))

    if not tasks:
        print("SELFTEST SKIP (没有任务可以翻转)")
        return

    target = tasks[0]
    before = target.done
    idx = target.line_index

    store.toggle_done(target, tasks)
    mid = [t for t in store.load_tasks()[0] if t.line_index == idx][0].done

    # 再翻回去，别把用户数据改了
    store.toggle_done(mid_task := [t for t in store.load_tasks()[0] if t.line_index == idx][0], tasks)
    after = [t for t in store.load_tasks()[0] if t.line_index == idx][0].done

    ok = (mid != before) and (after == before)
    print(f"toggle    : {before} -> {mid} -> {after}   {'OK' if ok else 'FAIL'}")
    print("SELFTEST", "OK" if ok else "FAILED")
    if not ok:
        raise SystemExit(1)


def main() -> None:
    import sys

    try:
        from ctypes import windll
        windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass

    prefs = store.load_prefs()
    layout = prefs.get("layout", "horizontal")
    theme = prefs.get("theme", "dark")
    screenshot = ""
    view = prefs.get("view", "heatmap")
    for arg in sys.argv[1:]:
        if arg.startswith("--layout="):
            layout = arg.split("=", 1)[1]
        elif arg.startswith("--theme="):
            theme = arg.split("=", 1)[1]
        elif arg.startswith("--screenshot="):
            screenshot = arg.split("=", 1)[1]
        elif arg.startswith("--view="):
            view = arg.split("=", 1)[1]
        elif arg == "--selftest":
            _selftest()
            return

    ctk.set_default_color_theme("blue")
    ctk.set_appearance_mode(theme)
    app = App(layout=layout)

    if view == "calendar":
        app._cal_view = "calendar"
        app.view_switch.set("日历")
        app._mount_view()
        app._update_calendar(app._by_day_cache)

    if screenshot:
        # 自截图模式：用于开发时检查布局，不影响正常使用
        def _snap() -> None:
            try:
                from PIL import ImageGrab
                app.update_idletasks()
                app.update()
                x, y = app.winfo_rootx(), app.winfo_rooty()
                w, h = app.winfo_width(), app.winfo_height()
                img = ImageGrab.grab(bbox=(x, y, x + w, y + h), all_screens=True)
                img.save(screenshot)
                print(f"SCREENSHOT {w}x{h} -> {screenshot}")
            except Exception as exc:  # noqa: BLE001
                print("SCREENSHOT FAILED:", exc)
            finally:
                app.after(50, app.destroy)

        app.after(1200, _snap)

    app.mainloop()


if __name__ == "__main__":
    main()
