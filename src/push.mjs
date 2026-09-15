/**
 * Discord Webhook 推送。
 * 不需要 Bot 常驻进程 —— 一条 HTTPS POST 就能把消息发进频道。
 */
import { config } from './config.mjs';
import { sleep } from './util.mjs';

const EMBED_BODY_LIMIT = 4000;
const EMBED_TITLE_LIMIT = 250;
const MESSAGE_CONTENT_LIMIT = 1900;
const MAX_EMBEDS = 10;
const MAX_TOTAL_CHARS = 5600;

export function assertWebhook(url, label = 'DISCORD_WEBHOOK_URL') {
  if (!url) throw new Error(label + ' 未配置');
  if (!/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//.test(url)) {
    throw new Error(label + ' 格式不对，应该形如 https://discord.com/api/webhooks/<id>/<token>');
  }
}

/** 超长正文按行切成多块。 */
function splitSection(section) {
  const body = String(section.body || '');
  if (body.length <= EMBED_BODY_LIMIT) return [{ ...section, title: String(section.title || '').slice(0, EMBED_TITLE_LIMIT) }];

  const parts = [];
  let rest = body;
  while (rest.length) {
    let cut = rest.lastIndexOf('\n', EMBED_BODY_LIMIT);
    if (cut < EMBED_BODY_LIMIT * 0.5) cut = EMBED_BODY_LIMIT;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  return parts.map((p, i) => ({
    ...section,
    title: (String(section.title || '') + ' (' + (i + 1) + '/' + parts.length + ')').slice(0, EMBED_TITLE_LIMIT),
    body: p,
  }));
}

/** 把 section 装进若干条消息（受 embed 数量与总字数限制）。 */
function pack(sections) {
  const flat = sections.flatMap(splitSection);
  const messages = [];
  let current = [];
  let size = 0;

  for (const s of flat) {
    const cost = s.title.length + s.body.length;
    if (current.length && (current.length >= MAX_EMBEDS || size + cost > MAX_TOTAL_CHARS)) {
      messages.push(current);
      current = [];
      size = 0;
    }
    current.push(s);
    size += cost;
  }
  if (current.length) messages.push(current);
  return messages;
}

async function post(webhookUrl, payload, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(webhookUrl + '?wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (res.status === 429) {
        let waitMs = 2500;
        try { waitMs = Math.ceil((JSON.parse(text).retry_after || 2.5) * 1000); } catch { /* 用默认值 */ }
        await sleep(waitMs + 300);
        throw new Error('被限流 429');
      }
      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + text.slice(0, 300));
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error('Discord 推送失败: ' + (lastErr && lastErr.message));
}

/**
 * 推送一则简报。
 * @returns {number} 实际发出的消息条数
 */
export async function pushDiscord({ header, sections, webhookUrl, username = '咨询管家' }) {
  const url = webhookUrl || config.webhookUrl;
  assertWebhook(url);
  if (!sections.length) throw new Error('没有可推送的内容');

  const messages = pack(sections);
  const mention = config.mention;

  for (let i = 0; i < messages.length; i++) {
    const contentParts = [];
    if (i === 0) {
      contentParts.push(header.slice(0, MESSAGE_CONTENT_LIMIT));
      if (mention) contentParts.push(mention);
    }
    const payload = {
      username,
      embeds: messages[i].map((s) => ({
        title: s.title.slice(0, EMBED_TITLE_LIMIT),
        description: s.body.slice(0, EMBED_BODY_LIMIT),
        color: s.color,
      })),
    };
    if (contentParts.length) payload.content = contentParts.join('\n').slice(0, MESSAGE_CONTENT_LIMIT);
    // 只有第一条真的 @ 人
    payload.allowed_mentions = i === 0 && mention ? { parse: ['users'] } : { parse: [] };

    const sent = await post(url, payload);
    const msgId = sent && sent.id ? sent.id : '(无 id)';
    console.log('[push] 第 ' + (i + 1) + '/' + messages.length + ' 条已送达，message id = ' + msgId);
    if (i < messages.length - 1) await sleep(1200);
  }
  return messages.length;
}

/** 失败告警（工作流出错时用）。 */
export async function pushFailure({ webhookUrl, title, detail }) {
  const url = webhookUrl || config.webhookUrl;
  if (!url) return false;
  try {
    await post(url, {
      username: '咨询管家',
      embeds: [{ title: '⚠️ ' + title, description: String(detail || '').slice(0, 3900), color: 0xed4245 }],
    });
    return true;
  } catch {
    return false;
  }
}
