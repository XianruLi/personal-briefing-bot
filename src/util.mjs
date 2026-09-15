/**
 * 通用工具：HTTP 抓取（超时 + 重试）、时区日期、文本清洗。
 * 全项目零第三方依赖，只用 Node 内置能力。
 */
import { setTimeout as sleep } from 'node:timers/promises';

const UA = 'personal-briefing-bot/2.0 (personal daily briefing; contact via GitHub)';

export { sleep };

/**
 * 带超时与重试的文本抓取。
 */
export async function fetchText(url, opts = {}) {
  const { timeoutMs = 20000, retries = 2, headers = {}, label = url } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
      });
      const text = await res.text();
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('[fetch] ' + label + ' 失败: ' + (lastErr && lastErr.message));
}

/**
 * 抓取并解析 JSON。
 */
export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  return JSON.parse(text);
}

/** 去掉 HTML 标签，还原成纯文本。 */
export function stripTags(html) {
  return String(html == null ? '' : html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 截断到 n 个字符。 */
export function truncate(value, n) {
  const t = String(value == null ? '' : value).trim();
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + '…';
}

/** 按 key 去重，保留首次出现的元素。 */
export function uniqueBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = keyFn(item);
    if (k == null || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

// ============================================================
//  时区相关：所有「今天 / 昨天 / 7:00」都以 BRIEFING_TIMEZONE 为准
// ============================================================

export const WEEKDAY_CN = {
  Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四',
  Fri: '周五', Sat: '周六', Sun: '周日',
};

/** 取某个时区下的年月日时分。 */
export function zoneParts(timeZone, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', weekday: 'short',
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  const iso = out.year + '-' + out.month + '-' + out.day;
  return {
    iso,
    hour: Number(out.hour),
    minute: Number(out.minute),
    weekday: out.weekday,
    weekdayCn: WEEKDAY_CN[out.weekday] || out.weekday,
    label: Number(out.month) + '月' + Number(out.day) + '日 ' + (WEEKDAY_CN[out.weekday] || ''),
  };
}

/** ISO 日期加减天数（用正午锚点，避开夏令时边界）。 */
export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** 目标时区里「今天（或偏移若干天）」的日期，返回 { iso, compact }。 */
export function dateInZone(timeZone, offsetDays = 0, date = new Date()) {
  const base = zoneParts(timeZone, date).iso;
  const iso = offsetDays === 0 ? base : addDays(base, offsetDays);
  return { iso, compact: iso.replace(/-/g, '') };
}

/** 相差天数：a - b（都是 YYYY-MM-DD）。 */
export function daysBetween(a, b) {
  const toTs = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d, 12);
  };
  return Math.round((toTs(a) - toTs(b)) / 86400000);
}
