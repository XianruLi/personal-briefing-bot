#!/usr/bin/env node
/**
 * 工作流出错时往 Discord 发一条告警，避免「静默失败」——
 * 以前 Bot 崩了你根本不知道，这个至少会告诉你。
 */
import { config } from './config.mjs';
import { pushFailure } from './push.mjs';

const detail = process.env.FAILURE_DETAIL || '定时任务执行失败，请到 GitHub Actions 页面查看日志。';
const title = process.env.FAILURE_TITLE || '每日简报推送失败';

const ok = await pushFailure({ webhookUrl: config.webhookUrl, title, detail });
console.log(ok ? '[notify] 已发送失败告警' : '[notify] 未发送（缺少 Webhook 或发送失败）');
