#!/usr/bin/env node
/**
 * 快捷任务：由 .github/workflows/add-task.yml 的「Run workflow」表单调用。
 *
 * 输入（环境变量）：
 *   INPUT_ACTION    添加任务 | 完成任务
 *   INPUT_TASK      任务内容；完成模式下作为模糊匹配关键词
 *   INPUT_DUE       截止日期 YYYY-MM-DD（仅添加）
 *   INPUT_PRIORITY  不设置 | 高 | 中 | 低（仅添加）
 *   INPUT_TAGS      标签，空格或逗号分隔，可不带 #（仅添加）
 *   INPUT_SECTION   加到哪个分组，默认「进行中」（仅添加）
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { TASKS_FILE } from './config.mjs';
import { parseTasks } from './tasks.mjs';

const ACTION_ADD = '添加任务';
const ACTION_DONE = '完成任务';

const action = (process.env.INPUT_ACTION || ACTION_ADD).trim();
const rawTask = (process.env.INPUT_TASK || '').trim();
const dueRaw = (process.env.INPUT_DUE || '').trim();
const priorityRaw = (process.env.INPUT_PRIORITY || '').trim();
const tagsRaw = (process.env.INPUT_TAGS || '').trim();
const section = (process.env.INPUT_SECTION || '进行中').trim() || '进行中';

/** 既打印到日志，也写到 GitHub 的 Job Summary 面板上，方便在网页直接看结果。 */
function report(lines, ok = true) {
  const text = lines.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n' + (ok ? '### ✅ ' : '### ❌ ') + text.replace(/\n/g, '\n\n') + '\n', 'utf-8');
  }
}

function fail(message, extra = []) {
  report([message, ...extra], false);
  process.exit(1);
}

// ---------- 校验 ----------
if (!rawTask) fail('任务内容不能为空。');
if (/[\r\n]/.test(rawTask)) fail('任务内容不能包含换行，一次只加一条。');
if (rawTask.length > 200) fail('任务内容太长了（' + rawTask.length + ' 字），请控制在 200 字以内。');

const due = dueRaw ? dueRaw.replace(/[/.]/g, '-') : '';
if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
  fail('截止日期格式不对：' + dueRaw, ['请用 2026-09-25 这种格式，或者留空。']);
}
if (due && Number.isNaN(Date.parse(due + 'T00:00:00Z'))) fail('截止日期不是一个真实存在的日期：' + due);

const PRIORITY_MAP = { '高': '高', '中': '中', '低': '低', 'high': '高', 'medium': '中', 'low': '低' };
let priority = '';
if (priorityRaw && priorityRaw !== '不设置') {
  priority = PRIORITY_MAP[priorityRaw] || '';
  if (!priority) fail('优先级只支持 高 / 中 / 低（收到：' + priorityRaw + '）');
}

const tags = tagsRaw
  .split(/[\s,，、]+/)
  .map((t) => t.replace(/^#/, '').trim())
  .filter(Boolean)
  .slice(0, 6);

// ---------- 读取任务文件 ----------
const original = readFileSync(TASKS_FILE, 'utf-8');
const parsed = parseTasks(original);
const lines = original.split(/\r?\n/);

// ============================================================
//  模式一：添加任务
// ============================================================
if (action === ACTION_ADD) {
  const dup = parsed.tasks.find((t) => !t.done && t.title.toLowerCase() === rawTask.toLowerCase());
  if (dup) {
    fail('已经有一条一样的未完成任务了，没有重复添加：', ['- ' + dup.title]);
  }

  const meta = [];
  if (due) meta.push('@' + due);
  if (priority) meta.push('!' + priority);
  for (const t of tags) meta.push('#' + t);
  const newLine = '- [ ] ' + rawTask + (meta.length ? ' ' + meta.join(' ') : '');

  // 找到目标分组的起止行
  const heading = (line) => {
    const m = line.match(/^\s*#{2,4}\s+(.+?)\s*$/);
    return m ? m[1] : null;
  };
  let startIdx = -1;
  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (heading(lines[i]) === section) {
      startIdx = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (heading(lines[j])) { endIdx = j; break; }
      }
      break;
    }
  }

  let updated;
  if (startIdx === -1) {
    // 分组不存在就在文件末尾新建一个
    updated = original.replace(/\s*$/, '\n') + '\n## ' + section + '\n\n' + newLine + '\n';
  } else {
    // 插到该分组最后一行内容之后
    let insertAt = endIdx;
    while (insertAt > startIdx + 1 && lines[insertAt - 1].trim() === '') insertAt--;
    lines.splice(insertAt, 0, newLine);
    updated = lines.join('\n');
  }

  writeFileSync(TASKS_FILE, updated, 'utf-8');
  report([
    '已添加任务：' + rawTask,
    '',
    '- 分组：' + section,
    '- 截止：' + (due || '未设置'),
    '- 优先级：' + (priority || '未设置（按中）'),
    '- 标签：' + (tags.length ? tags.map((t) => '#' + t).join(' ') : '无'),
    '',
    '写入的那一行：',
    '`' + newLine + '`',
  ]);
  process.exit(0);
}

// ============================================================
//  模式二：完成任务（模糊匹配）
// ============================================================
if (action === ACTION_DONE) {
  const open = parsed.tasks.filter((t) => !t.done);
  if (!open.length) fail('清单里没有未完成的任务。');

  const needle = rawTask.toLowerCase();
  const matches = open.filter((t) => t.title.toLowerCase().includes(needle));

  if (matches.length === 0) {
    fail('没找到包含「' + rawTask + '」的未完成任务。', [
      '',
      '当前未完成任务：',
      ...open.slice(0, 20).map((t) => '- ' + t.title),
      '',
      '换个更短的关键词再试一次。',
    ]);
  }
  if (matches.length > 1) {
    fail('「' + rawTask + '」匹配到 ' + matches.length + ' 条，请写得更具体一点：', [
      '',
      ...matches.map((t) => '- ' + t.title),
    ]);
  }

  const target = matches[0];
  const before = lines[target.lineIndex];
  lines[target.lineIndex] = before.replace(/\[( |x|X)\]/, '[x]');
  if (lines[target.lineIndex] === before) {
    fail('定位到了任务但没能改写复选框，请手动改一下：', ['- ' + target.title]);
  }
  writeFileSync(TASKS_FILE, lines.join('\n'), 'utf-8');

  const remaining = open.length - 1;
  report([
    '已完成任务：' + target.title,
    '',
    '剩余未完成：' + remaining + ' 项',
    '',
    '改写后的那一行：',
    '`' + lines[target.lineIndex].trim() + '`',
    '',
    '晚上的复盘会统计到这一条。',
  ]);
  process.exit(0);
}

fail('不认识的操作：' + action, ['只支持「' + ACTION_ADD + '」和「' + ACTION_DONE + '」。']);
