# -*- coding: utf-8 -*-
"""完成情况的两个视图：GitHub 风格热力图 + 月历视图（纯 Canvas 手绘）。"""
from __future__ import annotations

import calendar
import tkinter as tk
from datetime import date
from tkinter import font as tkfont

import customtkinter as ctk

FONT_FAMILY = "Microsoft YaHei UI"
WEEKDAYS_CN = ["一", "二", "三", "四", "五", "六", "日"]

# 颜色：索引 0 = 没有记录
LEVELS_DARK = ["#2b2f36", "#0e4429", "#006d32", "#26a641", "#39d353"]
LEVELS_LIGHT = ["#d8dee4", "#9be9a8", "#40c463", "#30a14e", "#216e39"]


def level_of(n: int) -> int:
    if n <= 0:
        return 0
    if n == 1:
        return 1
    if n <= 3:
        return 2
    if n <= 5:
        return 3
    return 4


def _font(size: int, weight: str = "normal") -> ctk.CTkFont:
    return ctk.CTkFont(family=FONT_FAMILY, size=size, weight=weight)


def _dark() -> bool:
    return ctk.get_appearance_mode().lower() == "dark"


def _levels() -> list[str]:
    return LEVELS_DARK if _dark() else LEVELS_LIGHT


def _canvas_bg() -> str:
    return "#1e1e1e" if _dark() else "#f6f8fa"


def _muted() -> str:
    return "#8b949e" if _dark() else "#57606a"


class _MonthBase(ctk.CTkFrame):
    """月份视图公共部分：标题栏 + 上下月切换 + 本月合计。"""

    def __init__(self, master, by_day: dict[str, int], on_month_change=None, **kw):
        super().__init__(master, fg_color="transparent", **kw)
        self._by_day = dict(by_day or {})
        self._on_month_change = on_month_change
        self._cursor = date.today().replace(day=1)

        self.grid_columnconfigure(0, weight=1)

        head = ctk.CTkFrame(self, fg_color="transparent")
        head.grid(row=0, column=0, sticky="ew", pady=(0, 2))
        head.grid_columnconfigure(2, weight=1)

        ctk.CTkButton(head, text="◀", width=26, height=22, font=_font(11),
                      fg_color="transparent", hover_color=("gray85", "gray28"),
                      command=lambda: self._shift(-1)).grid(row=0, column=0)

        self.month_lbl = ctk.CTkLabel(head, text="", font=_font(13, "bold"))
        self.month_lbl.grid(row=0, column=1, padx=8)

        ctk.CTkButton(head, text="▶", width=26, height=22, font=_font(11),
                      fg_color="transparent", hover_color=("gray85", "gray28"),
                      command=lambda: self._shift(1)).grid(row=0, column=2, sticky="w")

        self.total_lbl = ctk.CTkLabel(head, text="", font=_font(11),
                                      text_color=(_muted(), _muted()))
        self.total_lbl.grid(row=0, column=3, sticky="e")

        self.canvas = tk.Canvas(self, highlightthickness=0, bd=0, bg=_canvas_bg())
        self.canvas.grid(row=1, column=0, sticky="w")

        self.hover_lbl = ctk.CTkLabel(self, text=" ", font=_font(10), anchor="w",
                                      text_color=(_muted(), _muted()), height=16)
        self.hover_lbl.grid(row=2, column=0, sticky="w", pady=(3, 0))

    # ---- 通用 ----
    def set_data(self, by_day: dict[str, int]) -> None:
        self._by_day = dict(by_day or {})
        self.refresh()

    def goto_month(self, d: date) -> None:
        self._cursor = d.replace(day=1)
        self.refresh()

    def _shift(self, months: int) -> None:
        y, m = self._cursor.year, self._cursor.month + months
        while m < 1:
            m += 12
            y -= 1
        while m > 12:
            m -= 12
            y += 1
        self._cursor = date(y, m, 1)
        self.refresh()
        if self._on_month_change:
            self._on_month_change(self._cursor)

    def _month_stats(self) -> tuple[int, int]:
        prefix = self._cursor.strftime("%Y-%m")
        vals = [v for k, v in self._by_day.items() if k.startswith(prefix)]
        return sum(vals), len(vals)

    def refresh(self) -> None:
        raise NotImplementedError


# ==================================================================== 热力图

class Heatmap(_MonthBase):
    """GitHub 贡献图风格：一行一个工作日，一列一个星期。"""

    CELL = 19
    GAP = 5
    STEP = CELL + GAP
    LEFT_W = 24
    TOP_H = 16

    def refresh(self) -> None:
        colors = _levels()
        bg = _canvas_bg()
        self.canvas.configure(bg=bg)

        first = self._cursor
        ndays = calendar.monthrange(first.year, first.month)[1]
        lead = first.weekday()
        weeks = ((lead + ndays + 6) // 7) or 1

        width = self.LEFT_W + weeks * self.STEP + 4
        height = self.TOP_H + 7 * self.STEP
        self.canvas.configure(width=width, height=height)
        self.canvas.delete("all")

        small = tkfont.Font(family=FONT_FAMILY, size=8)
        for row, name in enumerate(WEEKDAYS_CN):
            if row % 2 == 0:
                self.canvas.create_text(self.LEFT_W - 5, self.TOP_H + row * self.STEP + self.CELL / 2,
                                        text=name, anchor="e", fill=_muted(), font=small)

        total = 0
        today = date.today()
        for dnum in range(1, ndays + 1):
            d = date(first.year, first.month, dnum)
            idx = lead + dnum - 1
            col, row = idx // 7, idx % 7
            x = self.LEFT_W + col * self.STEP
            y = self.TOP_H + row * self.STEP
            n = self._by_day.get(d.isoformat(), 0)
            total += n
            self.canvas.create_rectangle(
                x, y, x + self.CELL, y + self.CELL,
                fill=colors[level_of(n)],
                outline=("#e6edf3" if d == today else ""),
                width=1.5 if d == today else 0)

        self.canvas.bind("<Motion>", self._on_move)
        self.canvas.bind("<Leave>", lambda _e: self.hover_lbl.configure(text=" "))

        self.month_lbl.configure(text=f"{first.year} 年 {first.month} 月")
        days, _ = self._month_stats()
        self.total_lbl.configure(text=f"本月 {total} 个 · 完成日 {days} 天" if total else "本月还没有记录")
        self.hover_lbl.configure(text=" ")

    def _on_move(self, event) -> None:
        first = self._cursor
        ndays = calendar.monthrange(first.year, first.month)[1]
        lead = first.weekday()
        for dnum in range(1, ndays + 1):
            idx = lead + dnum - 1
            col, row = idx // 7, idx % 7
            x = self.LEFT_W + col * self.STEP
            y = self.TOP_H + row * self.STEP
            if x <= event.x <= x + self.CELL and y <= event.y <= y + self.CELL:
                d = date(first.year, first.month, dnum)
                n = self._by_day.get(d.isoformat(), 0)
                self.hover_lbl.configure(text=f"{d.isoformat()}（周{WEEKDAYS_CN[d.weekday()]}）  完成 {n} 个")
                return
        self.hover_lbl.configure(text=" ")


# ==================================================================== 日历

class CalendarView(_MonthBase):
    """月历：每格标日期，颜色深浅表示当天完成数量。"""

    CW = 58
    CH = 44
    GAP = 4

    def refresh(self) -> None:
        colors = _levels()
        bg = _canvas_bg()
        self.canvas.configure(bg=bg)

        first = self._cursor
        ndays = calendar.monthrange(first.year, first.month)[1]
        lead = first.weekday()
        total_cells = ((lead + ndays + 6) // 7) * 7
        rows = total_cells // 7

        top = 20
        width = 7 * (self.CW + self.GAP) + 4
        height = top + rows * (self.CH + self.GAP) + 4
        self.canvas.configure(width=width, height=height)
        self.canvas.delete("all")

        small = tkfont.Font(family=FONT_FAMILY, size=9)
        for col, name in enumerate(WEEKDAYS_CN):
            self.canvas.create_text(
                col * (self.CW + self.GAP) + self.CW / 2, 9,
                text=name, fill=_muted(), font=small)

        big = tkfont.Font(family=FONT_FAMILY, size=13, weight="bold")
        tiny = tkfont.Font(family=FONT_FAMILY, size=8)
        total = 0
        today = date.today()

        for i in range(total_cells):
            dnum = i - lead + 1
            col, row = i % 7, i // 7
            x = col * (self.CW + self.GAP)
            y = top + row * (self.CH + self.GAP)

            if dnum < 1 or dnum > ndays:
                continue

            d = date(first.year, first.month, dnum)
            n = self._by_day.get(d.isoformat(), 0)
            total += n
            lvl = level_of(n)

            self.canvas.create_rectangle(
                x, y, x + self.CW, y + self.CH,
                fill=colors[lvl],
                outline=("#e6edf3" if d == today else ("#3d444d" if _dark() else "#d0d7de")),
                width=2 if d == today else 1)

            # 深色格子上用白字，浅色格子上用深字
            fg = "#e6edf3" if lvl >= 3 else ("#e6edf3" if _dark() else "#1f2328")
            self.canvas.create_text(x + 7, y + 7, text=str(dnum), anchor="nw", fill=fg, font=big)
            if n:
                self.canvas.create_text(x + self.CW - 6, y + self.CH - 5, text=f"{n} 个",
                                        anchor="se", fill=fg, font=tiny)

        self.canvas.bind("<Motion>", self._on_move)
        self.canvas.bind("<Leave>", lambda _e: self.hover_lbl.configure(text=" "))

        self.month_lbl.configure(text=f"{first.year} 年 {first.month} 月")
        days, _ = self._month_stats()
        self.total_lbl.configure(text=f"本月 {total} 个 · 完成日 {days} 天" if total else "本月还没有记录")
        self.hover_lbl.configure(text=" ")

    def _on_move(self, event) -> None:
        first = self._cursor
        ndays = calendar.monthrange(first.year, first.month)[1]
        lead = first.weekday()
        top = 20
        for dnum in range(1, ndays + 1):
            i = lead + dnum - 1
            col, row = i % 7, i // 7
            x = col * (self.CW + self.GAP)
            y = top + row * (self.CH + self.GAP)
            if x <= event.x <= x + self.CW and y <= event.y <= y + self.CH:
                d = date(first.year, first.month, dnum)
                n = self._by_day.get(d.isoformat(), 0)
                self.hover_lbl.configure(text=f"{d.isoformat()}（周{WEEKDAYS_CN[d.weekday()]}）  完成 {n} 个")
                return
        self.hover_lbl.configure(text=" ")
