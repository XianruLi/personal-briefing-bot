/**
 * 企业微信群机器人推送（markdown 消息）。
 * 文档：https://developer.work.weixin.qq.com/document/path/91770
 */
import { sleep } from './util.mjs';

const MARKDOWN_LIMIT = 4000; // 官方限制 4096 字节，中文按 3 字节算，保守取 4000 字符足够安全

function splitLong(text, limit) {
  const body = String(text || '');
  if (body.length <= limit) return [body];
  const parts = [];
  let rest = body;
  while (rest.length) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  return parts;
}

async function post(url, payload, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + text.slice(0, 300));
      let body;
      try { body = JSON.parse(text); } catch { return text; }
      if (body && body.errcode !== undefined && body.errcode !== 0) {
        throw new Error('企业微信返回错误 errcode=' + body.errcode + ' errmsg=' + (body.errmsg || ''));
      }
      return body;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error('企业微信推送失败: ' + (lastErr && lastErr.message));
}

/**
 * 推送到企业微信。
 * @returns {number} 发出的消息条数
 */
export async function pushWeCom({ webhookUrl, title, header, sections }) {
  if (!webhookUrl) throw new Error('WECOM_WEBHOOK_URL 未配置');
  if (!/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/.test(webhookUrl)) {
    throw new Error('WECOM_WEBHOOK_URL 格式不对，应该形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx');
  }

  const blocks = [];
  if (header) blocks.push(header);
  for (const s of sections) blocks.push('## ' + s.title + '\n' + s.body);
  const full = blocks.join('\n\n');
  const chunks = splitLong(full, MARKDOWN_LIMIT);

  for (let i = 0; i < chunks.length; i++) {
    const content = chunks.length > 1 && i > 0 ? '**' + title + ' (' + (i + 1) + '/' + chunks.length + ')**\n' + chunks[i] : chunks[i];
    await post(webhookUrl, { msgtype: 'markdown', markdown: { content } });
    if (i < chunks.length - 1) await sleep(1200);
  }
  return chunks.length;
}
