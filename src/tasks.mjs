/**
 * 任务文件（tasks/tasks.md）的解析、排序与归档。
 * 格式：- [ ] 标题 @2026-09-20 !高 #标签
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DONE_FILE, TASKS_FILE, config } from './config.mjs';
import { daysBetween, truncate } from './util.mjs';

const TASK_LINE = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*?)\s*$/;
const SECTION_LINE = /^\s*#{2,4}\s+(.+?)\s*$/;
const DUE_RE = /@(\d{4}-\d{2}-\d{2})/;
const PRIO_RE = /!(高|中|低|high|medium|low)/i;
const TAG_RE = /(^|\s)#([^\s#]+)/g;

const PRIORITY_MAP = {
  '高': 'high', high: 'high',
  '中': 'medium', medium: 'medium',
  '低': 'low', low: 'low',
};
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const PRIORITY_CN = { high: '高', medium: '中', low: '低' };

/** 把 HTML 注释挖空，但保留换行，保证行号不错位。 */
function blankComments(content) {
  return content.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

function normalizeId(title) {
  return title.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 解析任务文件。
 * @returns {{ tasks: object[], sections: string[], content: string }}
 */
export function parseTasks(content = readFileSync(TASKS_FILE, 'utf-8')) {
  const lines = blankComments(content).split(/\r?\n/);
  const tasks = [];
  const sections = [];
  let currentSection = '';

  lines.forEach((line, index) => {
    const sec = line.match(SECTION_LINE);
    if (sec) {
      currentSection = sec[1];
      if (!sections.includes(currentSection)) sections.push(currentSection);
      return;
    }
    const m = line.match(TASK_LINE);
    if (!m) return;

    const done = m[2].toLowerCase() === 'x';
    let body = m[3];

    let due = null;
    const dueMatch = body.match(DUE_RE);
    if (dueMatch) {
      due = dueMatch[1];
      body = body.replace(DUE_RE, ' ');
    }

    let priority = 'medium';
    const prioMatch = body.match(PRIO_RE);
    if (prioMatch) {
      priority = PRIORITY_MAP[prioMatch[1].toLowerCase()] || 'medium';
      body = body.replace(PRIO_RE, ' ');
    }

    const tags = [];
    body = body.replace(TAG_RE, (full, lead, tag) => {
      tags.push(tag);
      return lead;
    });

    const title = body.replace(/\s+/g, ' ').trim();
    if (!title) return;

    tasks.push({
      id: normalizeId(title),
      title,
      done,
      due,
      priority,
      tags,
      section: currentSection,
      lineIndex: index,
    });
  });

  return { tasks, sections, content };
}

/** 逾期 / 今日到期 / 后续 分组，并排好序。 */
export function groupTasks(tasks, todayIso) {
  const open = tasks.filter((t) => !t.done);
  const overdue = [];
  const dueToday = [];
  const upcoming = [];
  const noDue = [];

  for (const t of open) {
    if (!t.due) { noDue.push(t); continue; }
    const delta = daysBetween(t.due, todayIso);
    if (delta < 0) { t.overdueDays = -delta; overdue.push(t); }
    else if (delta === 0) dueToday.push(t);
    else { t.dueInDays = delta; upcoming.push(t); }
  }

  const byPriority = (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  overdue.sort((a, b) => b.overdueDays - a.overdueDays || byPriority(a, b));
  dueToday.sort(byPriority);
  upcoming.sort((a, b) => (a.dueInDays - b.dueInDays) || byPriority(a, b));
  noDue.sort(byPriority);

  return {
    overdue, dueToday, upcoming, noDue,
    completed: tasks.filter((t) => t.done),
    openCount: open.length,
  };
}

/** 给 AI 看的紧凑任务清单文本。 */
export function tasksToPromptText(grouped, todayIso) {
  const fmt = (t) => {
    const bits = [PRIORITY_CN[t.priority] || '中'];
    if (t.due) {
      const d = daysBetween(t.due, todayIso);
      bits.push(d < 0 ? '逾期' + (-d) + '天(' + t.due + ')' : d === 0 ? '今天到期' : d + '天后到期(' + t.due + ')');
    }
    if (t.tags.length) bits.push(t.tags.map((x) => '#' + x).join(' '));
    return '- ' + truncate(t.title, 120) + '  [' + bits.join(' | ') + ']';
  };
  const parts = [];
  if (grouped.overdue.length) parts.push('【已逾期】\n' + grouped.overdue.map(fmt).join('\n'));
  if (grouped.dueToday.length) parts.push('【今天到期】\n' + grouped.dueToday.map(fmt).join('\n'));
  if (grouped.upcoming.length) parts.push('【即将到期】\n' + grouped.upcoming.map(fmt).join('\n'));
  if (grouped.noDue.length) parts.push('【无截止日期】\n' + grouped.noDue.map(fmt).join('\n'));
  if (!parts.length) parts.push('（当前没有未完成任务）');
  return parts.join('\n\n');
}

/** 标记完成时间，返回今天新完成的任务。 */
export function trackCompletions(tasks, state, todayIso) {
  const newlyDone = [];
  for (const t of tasks) {
    if (!t.done) continue;
    if (!state.completedAt[t.id]) {
      state.completedAt[t.id] = todayIso;
      newlyDone.push(t);
    }
  }
  // 清理已经不存在的任务，避免 completedAt 无限膨胀
  const ids = new Set(tasks.map((t) => t.id));
  for (const key of Object.keys(state.completedAt)) {
    if (!ids.has(key)) delete state.completedAt[key];
  }
  return newlyDone;
}

/**
 * 把完成超过 keepDays 天的任务移动到 tasks/done.md，保持 tasks.md 清爽。
 * @returns {number} 归档条数
 */
export function archiveOldCompleted(parsed, state, todayIso) {
  const keepDays = config.archiveAfterDays;
  const toArchive = parsed.tasks.filter((t) => {
    if (!t.done) return false;
    const when = state.completedAt[t.id];
    if (!when) return false;
    return daysBetween(todayIso, when) >= keepDays;
  });
  if (!toArchive.length) return 0;

  const dropLines = new Set(toArchive.map((t) => t.lineIndex));
  const lines = parsed.content.split(/\r?\n/);
  const kept = lines.filter((_, i) => !dropLines.has(i));

  // 顺带清掉归档后可能出现的连续空段落
  const compacted = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
  writeFileSync(TASKS_FILE, compacted, 'utf-8');

  const header = existsSync(DONE_FILE) ? readFileSync(DONE_FILE, 'utf-8').replace(/\n+$/, '\n') : '# 历史归档\n';
  const stamp = '\n## ' + todayIso + ' 归档\n\n';
  const body = toArchive.map((t) => '- [x] ' + t.title + '（完成于 ' + state.completedAt[t.id] + '）').join('\n') + '\n';
  writeFileSync(DONE_FILE, header + stamp + body, 'utf-8');

  for (const t of toArchive) delete state.completedAt[t.id];
  return toArchive.length;
}
