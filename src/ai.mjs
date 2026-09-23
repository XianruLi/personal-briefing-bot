/**
 * DeepSeek 客户端。要求模型输出 JSON，并做容错解析。
 */
import { config } from './config.mjs';
import { sleep } from './util.mjs';

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 300000);

/** 从模型输出里抠出 JSON（兼容被 ```json 包起来的情况）。 */
export function extractJson(text) {
  let t = String(text == null ? '' : text).trim();
  t = t.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('AI 返回内容中没有找到 JSON');
  return JSON.parse(t.slice(start, end + 1));
}

/**
 * 调用 DeepSeek，返回解析后的 JSON 对象。
 */
export async function chatJson({ system, user, label = 'AI', maxTokens = 4000, temperature = 0.6, retries = 2 }) {
  if (!config.deepseekApiKey) throw new Error('DEEPSEEK_API_KEY 未配置，无法调用 AI');

  const body = {
    model: config.deepseekModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  };
  if (config.thinkingEnabled) {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = config.reasoningEffort;
  } else {
    body.thinking = { type: 'disabled' };
  }

  // 思考模式的 reasoning token 也算在 max_tokens 里。
  // 内容一多（比如加了时政源），思考就可能把预算吃光、正文变空或 JSON 被截断。
  // 所以这里不写死：一旦发现被截断，就把预算翻倍重试，直到上限。
  const MAX_BUDGET = Number(process.env.AI_MAX_BUDGET_TOKENS || 64000);
  let budget = maxTokens;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const startedAt = Date.now();
    body.max_tokens = budget;
    try {
      const res = await fetch(config.deepseekBaseUrl, {
        method: 'POST',
        signal: ac.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + config.deepseekApiKey,
        },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error('DeepSeek HTTP ' + res.status + ': ' + raw.slice(0, 300));

      const payload = JSON.parse(raw);
      const choice = (payload.choices && payload.choices[0]) || {};
      const content = (choice.message && choice.message.content) || '';
      const usage = payload.usage || {};
      const reasoningTokens = (usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) || 0;
      console.log(
        '[ai] ' + label + ' 返回：finish_reason=' + choice.finish_reason +
        '，正文 ' + content.length + ' 字，tokens in/out=' + (usage.prompt_tokens || '?') + '/' + (usage.completion_tokens || '?') +
        '（其中思考 ' + reasoningTokens + '），用时 ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's'
      );
      // 预算不够的两种情况：正文为空，或者 JSON 被截断
      if (!content.trim()) {
        escalate('正文为空，思考占用了 ' + reasoningTokens + ' tokens');
        throw new Error('模型没有返回正文（finish_reason=' + choice.finish_reason + '，思考占用 ' + reasoningTokens + ' tokens）');
      }
      let parsed;
      try {
        parsed = extractJson(content);
      } catch (err) {
        escalate('正文 ' + content.length + ' 字但 JSON 不完整');
        throw new Error(err.message + '（finish_reason=' + choice.finish_reason + '）');
      }
      return parsed;
    } catch (err) {
      lastErr = err;
      console.warn('[ai] ' + label + ' 第 ' + (attempt + 1) + ' 次失败: ' + err.message);
      if (attempt < retries) await sleep(3000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  /** 把预算翻倍（不超过上限），下次重试就用新预算。 */
  function escalate(reason) {
    const next = Math.min(budget * 2, MAX_BUDGET);
    if (next > budget) {
      console.warn('[ai] ' + label + ' ' + reason + '，把 max_tokens 从 ' + budget + ' 提到 ' + next + ' 后重试');
      budget = next;
    } else {
      console.warn('[ai] ' + label + ' ' + reason + '，但预算已经是上限 ' + MAX_BUDGET + '，无法再加');
    }
  }
  throw new Error(label + ' 调用失败: ' + (lastErr && lastErr.message));
}
