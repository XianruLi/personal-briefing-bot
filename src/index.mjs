#!/usr/bin/env node
/**
 * 入口：node src/index.mjs --mode=morning|evening [--dry-run] [--no-ai] [--force]
 *
 * morning  早上 7:00 早报（任务 + arXiv + 科技新闻 + 国内要闻）
 * evening  晚上 21:30 复盘（完成情况 + 明日建议）
 *
 * --dry-run 只打印不推送，也不写任何文件
 * --no-ai   跳过 AI，用原始抓取内容拼简报（离线自测 / AI 挂了的兜底）
 * --force   忽略时间窗口与「今天已发过」的判断
 */
import { config, validateConfig } from './config.mjs';
import { loadState, saveState } from './state.mjs';
import { parseTasks, groupTasks, tasksToPromptText, trackCompletions, archiveOldCompleted } from './tasks.mjs';
import { collectAll } from './collect.mjs';
import { buildMorningPrompt, buildEveningPrompt } from './prompts.mjs';
import { chatJson } from './ai.mjs';
import { renderMorning, renderEvening } from './render.mjs';
import { pushDiscord } from './push.mjs';
import { zoneParts, dateInZone } from './util.mjs';

function parseArgs(argv) {
  const args = { mode: 'morning', dryRun: false, noAi: false, force: false };
  for (const a of argv) {
    if (a.startsWith('--mode=')) args.mode = a.slice('--mode='.length);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-ai') args.noAi = true;
    else if (a === '--force') args.force = true;
  }
  if (!args.mode) args.mode = 'auto'; // 外部定时器用 API 触发时不会带 mode
  if (!['auto', 'morning', 'evening'].includes(args.mode)) throw new Error('未知的 --mode: ' + args.mode);
  return args;
}

/** 是否处在允许推送的本地时间窗口内。 */
function inWindow(mode, zone) {
  if (mode === 'morning') return zone.hour === config.morningHour || zone.hour === config.morningHour + 1;
  return zone.hour === config.eveningHour || zone.hour === config.eveningHour + 1;
}

/** AI 不可用时的兜底内容：直接用抓到的原文。 */
function rawAiMorning(data) {
  return {
    greeting: '（AI 分析本次不可用，下面是抓取到的原始内容）',
    taskComment: '',
    taskFocus: [],
    papers: data.papers.slice(0, config.sources.arxiv.maxPicks).map((p) => ({
      id: p.id, titleZh: p.title, what: p.abstract.slice(0, 260), why: '',
    })),
    techNews: data.techNews.slice(0, config.sources.techNews.maxPicks).map((n) => ({
      id: n.id, titleZh: n.title, summary: n.summary.slice(0, 180),
    })),
    cnNews: data.cnNews.slice(0, config.sources.cnNews.maxPicks).map((n) => ({
      id: n.id, titleZh: n.title, topic: '', summary: n.summary.slice(0, 180), take: '',
    })),
    xwlb: null,
    weather: null,
    tip: '',
  };
}

function rawAiEvening(grouped, newlyDone) {
  return {
    greeting: '（AI 分析本次不可用，下面是清单原始数据）',
    progress: '未完成 ' + grouped.openCount + ' 项，已完成 ' + grouped.completed.length + ' 项。',
    doneList: grouped.completed.map((t) => t.title),
    remaining: [...grouped.overdue, ...grouped.dueToday, ...grouped.upcoming, ...grouped.noDue].slice(0, 5).map((t) => t.title),
    tomorrow: newlyDone.length ? [] : grouped.overdue.slice(0, 3).map((t) => t.title),
    comment: '',
    weather: null,
    tip: '',
  };
}

async function runMorning({ args, state, zone }) {
  const todayIso = zone.iso;
  const parsed = parseTasks();
  const grouped = groupTasks(parsed.tasks, todayIso);
  grouped.promptText = tasksToPromptText(grouped, todayIso);

  console.log('[tasks] 未完成 ' + grouped.openCount + ' 项（逾期 ' + grouped.overdue.length + '，今天到期 ' + grouped.dueToday.length + '），已完成 ' + grouped.completed.length + ' 项');

  const data = await collectAll({ state, mode: 'morning', timeZone: config.timeZone });
  console.log('[collect] 论文候选 ' + data.papers.length + ' 篇，科技新闻 ' + data.techNews.length + ' 条，央视新闻 ' + data.cnNews.length + ' 条，新闻联播 ' + (data.xwlb ? data.xwlb.length + ' 字' : '缺失'));
  if (data.errors.length) console.warn('[collect] 部分源失败: ' + data.errors.join(' | '));

  let ai;
  if (args.noAi) {
    ai = rawAiMorning(data);
  } else {
    try {
      const { system, user } = buildMorningPrompt({ data, grouped, todayIso, zone });
      ai = await chatJson({ system, user, label: '早报', maxTokens: 12000 });
    } catch (err) {
      console.error('[ai] 早报生成失败，改用原始内容兜底: ' + err.message);
      ai = rawAiMorning(data);
      data.errors.push('AI: ' + err.message);
    }
  }

  const rendered = renderMorning({ ai, data, grouped, zone, todayIso });

  // 把真正推送出去的条目记入去重表
  const pickedPaperIds = (Array.isArray(ai.papers) ? ai.papers : []).map((p) => p.id).filter(Boolean);
  const pickedNewsIds = [
    ...(Array.isArray(ai.techNews) ? ai.techNews : []).map((n) => n.id),
    ...(Array.isArray(ai.cnNews) ? ai.cnNews : []).map((n) => n.id),
  ].filter(Boolean);

  return { rendered, grouped, todayIso, pickedPaperIds, pickedNewsIds };
}

async function runEvening({ args, state, zone }) {
  const todayIso = zone.iso;
  const parsed = parseTasks();
  const grouped = groupTasks(parsed.tasks, todayIso);
  grouped.promptText = tasksToPromptText(grouped, todayIso);

  const newlyDone = trackCompletions(parsed.tasks, state, todayIso);
  const morningOpenCount = state.morningSnapshot && state.morningSnapshot.date === todayIso
    ? state.morningSnapshot.openCount
    : null;

  // 复盘只抓天气（明天穿什么、要不要带伞），不抓论文和新闻
  const data = await collectAll({ state, mode: 'evening', timeZone: config.timeZone });
  const weather = data.weather;
  if (data.errors.length) console.warn('[collect] ' + data.errors.join(' | '));

  console.log('[tasks] 未完成 ' + grouped.openCount + ' 项，已完成 ' + grouped.completed.length + ' 项，今天新勾掉 ' + newlyDone.length + ' 项');

  let ai;
  if (args.noAi) {
    ai = rawAiEvening(grouped, newlyDone);
  } else {
    try {
      const { system, user } = buildEveningPrompt({ grouped, todayIso, zone, newlyDone, morningOpenCount, weather });
      ai = await chatJson({ system, user, label: '复盘', maxTokens: 8000 });
    } catch (err) {
      console.error('[ai] 复盘生成失败，改用原始内容兜底: ' + err.message);
      ai = rawAiEvening(grouped, newlyDone);
    }
  }

  const rendered = renderEvening({ ai, grouped, zone, newlyDone, morningOpenCount, weather, todayIso });
  return { rendered, grouped, todayIso, newlyDone };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const zone = zoneParts(config.timeZone);
  const state = loadState();

  // 定时触发时 mode=auto：按本地时间自己判断该发早报还是复盘
  if (args.mode === 'auto') {
    const resolved = inWindow('morning', zone) ? 'morning' : inWindow('evening', zone) ? 'evening' : null;
    if (!resolved) {
      const now = String(zone.hour).padStart(2, '0') + ':' + String(zone.minute).padStart(2, '0');
      console.log('[skip] ' + zone.iso + ' ' + now + ' (' + config.timeZone + ') 不在任何推送窗口内，退出。');
      return;
    }
    args.mode = resolved;
    console.log('[mode] 按本地时间判定为：' + resolved);
  }

  console.log('=== 个人咨询管家 · ' + args.mode + ' · ' + zone.iso + ' ' + zone.weekdayCn + ' ' + String(zone.hour).padStart(2, '0') + ':' + String(zone.minute).padStart(2, '0') + ' (' + config.timeZone + ') ===');

  // 时间窗口 / 重复推送判断
  if (!args.force) {
    if (!inWindow(args.mode, zone)) {
      console.log('[skip] 当前本地时间不在 ' + args.mode + ' 推送窗口内，退出。');
      return;
    }
    const lastKey = args.mode === 'morning' ? 'lastMorningDate' : 'lastEveningDate';
    if (state[lastKey] === zone.iso) {
      console.log('[skip] ' + zone.iso + ' 的' + (args.mode === 'morning' ? '早报' : '复盘') + '今天已经推过了，退出。');
      return;
    }
  }

  validateConfig({ needAi: !args.noAi, needWebhook: !args.dryRun });

  const result = args.mode === 'morning'
    ? await runMorning({ args, state, zone })
    : await runEvening({ args, state, zone });

  const { rendered, grouped, todayIso } = result;

  if (args.dryRun) {
    console.log('\n================ DRY RUN 预览 ================');
    console.log(rendered.header);
    for (const s of rendered.sections) {
      console.log('\n--- ' + s.title + ' ---');
      console.log(s.body);
    }
    console.log('\n================ 预览结束（未推送、未写文件）================');
    return;
  }

  const webhookUrl = args.mode === 'evening' && config.webhookUrlEvening ? config.webhookUrlEvening : config.webhookUrl;
  const sent = await pushDiscord({ header: rendered.header, sections: rendered.sections, webhookUrl });
  console.log('[push] 已推送 ' + sent + ' 条消息到 Discord');

  // ---- 状态落盘 ----
  if (args.mode === 'morning') {
    state.lastMorningDate = todayIso;
    state.morningSnapshot = { date: todayIso, openCount: grouped.openCount };
    state.seenPaperIds = [...new Set([...(state.seenPaperIds || []), ...result.pickedPaperIds])].slice(-600);
    state.seenNewsIds = [...new Set([...(state.seenNewsIds || []), ...result.pickedNewsIds])].slice(-600);
    console.log('[state] 记录 ' + result.pickedPaperIds.length + ' 篇论文 / ' + result.pickedNewsIds.length + ' 条新闻 到去重表');
  } else {
    state.lastEveningDate = todayIso;
    console.log('[state] 记录今日完成 ' + result.newlyDone.length + ' 项');
  }

  const parsedNow = parseTasks();
  const archived = archiveOldCompleted(parsedNow, state, todayIso);
  if (archived) console.log('[tasks] 归档 ' + archived + ' 项已完成任务到 tasks/done.md');

  saveState(state);
  console.log('=== 完成 ===');
}

main().catch((err) => {
  console.error('[fatal] ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
