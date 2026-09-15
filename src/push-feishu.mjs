/**
 * 飞书 / Lark 群自定义机器人推送。
 * 支持加签校验（机器人安全设置里开了「签名校验」时必须配 FEISHU_SECRET）。
 *
 * 文档：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 */
import { createHmac } from 'node:crypto';
import { sleep } from './util.mjs';

const CARD_ELEMENT_LIMIT = 40;      // 单卡片元素上限，保守取值
const BLOCK_LIMIT = 3500;           // 单个 div 文本上限，保守取值
const CARD_TOTAL_LIMIT = 24000;     // 单卡片 JSON 体积上限，保守取值

/** 飞书加签：key 是 "timestamp\nsecret"，消息为空。 */
export function feishuSign(timestamp, secret) {
  const stringToSign = timestamp + '\n' + secret;
  return createHmac('sha256', stringToSign).update('').digest('base64');
}

/** 把长文本按行切开。 */
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

/** 把 sections 转成飞书卡片的 elements 数组。 */
function toElements(header, sections) {
  const elements = [];
  if (header) elements.push({ tag: 'div', text: { tag: 'lark_md', content: header } });

  for (const s of sections) {
    const chunks = splitLong(s.body, BLOCK_LIMIT);
    chunks.forEach((chunk, i) => {
      const title = chunks.length > 1 ? s.title + ' (' + (i + 1) + '/' + chunks.length + ')' : s.title;
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: '**' + title + '**\n' + chunk } });
    });
    elements.push({ tag: 'hr' });
  }
  if (elements.length && elements[elements.length - 1].tag === 'hr') elements.pop();
  return elements;
}

/** 按元素数量与体积上限把 elements 分组成多张卡片。 */
function packCards(elements) {
  const cards = [];
  let current = [];
  let size = 0;

  for (const el of elements) {
    const cost = JSON.stringify(el).length;
    if (current.length && (current.length >= CARD_ELEMENT_LIMIT || size + cost > CARD_TOTAL_LIMIT)) {
      cards.push(current);
      current = [];
      size = 0;
    }
    current.push(el);
    size += cost;
  }
  if (current.length) cards.push(current);
  return cards;
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
      // 飞书即使 HTTP 200 也可能在 body 里报错，必须检查 code
      let body;
      try { body = JSON.parse(text); } catch { return text; }
      if (body && body.code !== undefined && body.code !== 0) {
        throw new Error('飞书返回错误 code=' + body.code + ' msg=' + (body.msg || ''));
      }
      return body;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error('飞书推送失败: ' + (lastErr && lastErr.message));
}

/**
 * 推送到飞书。
 * @param {{webhookUrl:string, secret?:string, title:string, header?:string, sections:object[], color?:string}} opts
 * @returns {number} 发出的卡片数
 */
export async function pushFeishu({ webhookUrl, secret, title, header, sections, color = 'blue' }) {
  if (!webhookUrl) throw new Error('FEISHU_WEBHOOK_URL 未配置');
  if (!/^https:\/\/(open\.feishu\.cn|open\.larksuite\.com)\/open-apis\/bot\/v2\/hook\//.test(webhookUrl)) {
    throw new Error('FEISHU_WEBHOOK_URL 格式不对，应该形如 https://open.feishu.cn/open-apis/bot/v2/hook/xxxx');
  }

  const cards = packCards(toElements(header, sections));
  for (let i = 0; i < cards.length; i++) {
    const cardTitle = cards.length > 1 ? title + ' (' + (i + 1) + '/' + cards.length + ')' : title;
    const payload = {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: { title: { tag: 'plain_text', content: cardTitle }, template: color },
        elements: cards[i],
      },
    };
    if (secret) {
      const ts = Math.floor(Date.now() / 1000).toString();
      payload.timestamp = ts;
      payload.sign = feishuSign(ts, secret);
    }
    await post(webhookUrl, payload);
    if (i < cards.length - 1) await sleep(1200);
  }
  return cards.length;
}
