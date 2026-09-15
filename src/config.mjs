/**
 * 配置加载：.env（本地）+ 真实环境变量（GitHub Actions）+ config/ 下的静态配置。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = resolve(ROOT, 'data');
export const TASKS_FILE = resolve(ROOT, 'tasks', 'tasks.md');
export const DONE_FILE = resolve(ROOT, 'tasks', 'done.md');
export const STATE_FILE = resolve(DATA_DIR, 'state.json');

/** 本地开发时读取 .env；已存在的真实环境变量优先。 */
function loadDotEnv() {
  const file = resolve(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let value = t.slice(i + 1).trim();
    if (value.length > 1 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
  }
}
loadDotEnv();

const asBool = (v, fallback) => (v === undefined || v === '' ? fallback : !/^(false|0|no|off)$/i.test(String(v)));
const asInt = (v, fallback) => {
  const n = Number.parseInt(String(v == null ? '' : v), 10);
  return Number.isFinite(n) ? n : fallback;
};

function readJson(relPath) {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), 'utf-8'));
}

function readText(relPath) {
  try {
    return readFileSync(resolve(ROOT, relPath), 'utf-8');
  } catch {
    return '';
  }
}

export const config = {
  deepseekApiKey: (process.env.DEEPSEEK_API_KEY || '').trim(),
  deepseekModel: (process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro').trim(),
  deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1/chat/completions').trim(),
  thinkingEnabled: asBool(process.env.DEEPSEEK_THINKING_ENABLED, true),
  reasoningEffort: (process.env.DEEPSEEK_REASONING_EFFORT || 'high').trim(),

  webhookUrl: (process.env.DISCORD_WEBHOOK_URL || '').trim(),
  webhookUrlEvening: (process.env.DISCORD_WEBHOOK_URL_EVENING || '').trim(),
  mention: (process.env.DISCORD_MENTION || '').trim(),

  // 飞书 / 企业微信（回大陆后可切换或同时使用）
  feishuWebhook: (process.env.FEISHU_WEBHOOK_URL || '').trim(),
  feishuSecret: (process.env.FEISHU_SECRET || '').trim(),
  feishuWebhookEvening: (process.env.FEISHU_WEBHOOK_URL_EVENING || '').trim(),
  wecomWebhook: (process.env.WECOM_WEBHOOK_URL || '').trim(),

  timeZone: (process.env.BRIEFING_TIMEZONE || 'Australia/Melbourne').trim(),
  userName: (process.env.USER_NAME || '老李').trim(),

  sources: readJson('config/sources.json'),
  profile: readText('config/profile.md'),

  // 时间窗口（本地时区）：到点才推送，避免 GitHub 定时漂移导致错发
  morningHour: asInt(process.env.MORNING_HOUR, 7),
  eveningHour: asInt(process.env.EVENING_HOUR, 21),
  eveningMinute: asInt(process.env.EVENING_MINUTE, 30),

  // 完成多久后自动归档到 done.md
  archiveAfterDays: asInt(process.env.ARCHIVE_AFTER_DAYS, 14),
};

/** 检查本次运行真正需要的配置项。 */
export function validateConfig({ needAi, needWebhook }) {
  const problems = [];
  if (needAi && !config.deepseekApiKey) problems.push('DEEPSEEK_API_KEY 未配置');
  if (needWebhook && !config.webhookUrl && !config.feishuWebhook && !config.wecomWebhook) {
    problems.push('一个推送渠道都没配（DISCORD_WEBHOOK_URL / FEISHU_WEBHOOK_URL / WECOM_WEBHOOK_URL 至少填一个）');
  }
  if (problems.length) {
    throw new Error('配置缺失：' + problems.join('；') + '。本地请检查 .env，云端请检查 GitHub Secrets。');
  }
}

/** 当前启用了哪些推送渠道。 */
export function enabledChannels(mode) {
  const list = [];
  if (config.webhookUrl || config.webhookUrlEvening) list.push('discord');
  if (config.feishuWebhook || config.feishuWebhookEvening) list.push('feishu');
  if (config.wecomWebhook) list.push('wecom');
  return list;
}
