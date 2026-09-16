#!/usr/bin/env node
/**
 * 推送渠道自检：往所有已配置的渠道各发一条测试消息。
 * 由 .github/workflows/test-push.yml 调用，用来在 GitHub 的网络环境下
 * 验证「GitHub → 各渠道」这条链路通不通（本地能发不代表云端能发）。
 */
import { config, enabledChannels } from './config.mjs';
import { pushDiscord } from './push.mjs';
import { pushFeishu } from './push-feishu.mjs';
import { pushWeCom } from './push-wecom.mjs';

const channels = enabledChannels('morning');
console.log('检测到的推送渠道：' + (channels.length ? channels.join('、') : '（一个都没有）'));

if (!channels.length) {
  console.error('❌ 没有配置任何推送渠道，无法自检。');
  process.exit(1);
}

// 用当前时间当球号，方便区分哪次自检对应哪条消息
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

const payload = {
  title: '🔔 推送自检',
  header: '**这是一条测试消息**，用来确认推送链路正常。收到就说明配好了。',
  sections: [
    {
      title: '✅ 通道信息',
      body: '发送时间：' + stamp + '\n发送来源：GitHub Actions（和正式简报同一条链路）',
      color: 0x57f287,
    },
    {
      title: '💡 说明',
      body: '正式简报会在这个位置显示天气、任务、论文和新闻。\n如果你是在手机上看到这条，说明以后回大陆也能正常收。',
      color: 0x5865f2,
    },
  ],
};

const results = [];

for (const name of channels) {
  try {
    if (name === 'discord') {
      const n = await pushDiscord({ ...payload, webhookUrl: config.webhookUrl });
      results.push([name, true, n + ' 条消息']);
    } else if (name === 'feishu') {
      const n = await pushFeishu({
        ...payload,
        webhookUrl: config.feishuWebhook,
        secret: config.feishuSecret,
        color: 'green',
      });
      results.push([name, true, n + ' 张卡片']);
    } else if (name === 'wecom') {
      const n = await pushWeCom({ ...payload, webhookUrl: config.wecomWebhook });
      results.push([name, true, n + ' 条消息']);
    }
  } catch (err) {
    results.push([name, false, err.message]);
  }
}

console.log('');
console.log('========== 自检结果 ==========');
for (const [name, ok, detail] of results) {
  console.log((ok ? '✅ ' : '❌ ') + name.padEnd(8) + ' ' + detail);
}

if (results.some((r) => !r[1])) process.exit(1);
console.log('\n全部渠道推送成功。');
