/**
 * 个人咨询管家 · 外部定时触发器（Cloudflare Worker）
 * ============================================================
 * 为什么需要它：GitHub 自带的 schedule 定时器在新建的私有仓库上不触发
 * （已知 bug，社区讨论 #201436）。这个 Worker 用 Cloudflare 的调度器
 * 按时调用 GitHub API，效果和 GitHub 自己的定时器一样。
 *
 * 业务代码一行都不用改 —— 换的只是「闹钟」。
 *
 * ------------------------------------------------------------
 * 部署步骤（网页控制台，不用装 wrangler）
 * ------------------------------------------------------------
 * 1. https://dash.cloudflare.com → 注册/登录 → 左侧 Workers & Pages
 * 2. Create → Workers → 起个名字（如 briefing-cron）→ Deploy
 * 3. 点 Edit code，把本文件内容整个粘进去，Deploy
 * 4. Settings → Variables and Secrets，加三个：
 *      GH_TOKEN   （类型选 Secret）你的 GitHub 细粒度令牌
 *      GH_REPO    （类型选 Text）  XianruLi/personal-briefing-bot
 *      GH_WORKFLOW（类型选 Text）  briefing.yml
 * 5. Settings → Triggers → Cron Triggers，加 2 条（Cloudflare 的 cron 用 UTC）：
 *      0 20,21 * * *
 *      30 10,11 * * *
 *    说明：墨尔本有夏令时（AEST UTC+10 / AEDT UTC+11）
 *      早报 07:00 墨尔本 = 21:00 UTC（冬令时）或 20:00 UTC（夏令时）
 *      复盘 21:30 墨尔本 = 11:30 UTC（冬令时）或 10:30 UTC（夏令时）
 *    所以每条都用「小时列表」把两个可能的小时都排上，一天共触发 4 次。
 *    真正发不发由工作流按本地时间判断，多触发的会自动跳过，不会重复推送。
 * 6. 部署完在浏览器访问一次 Worker 地址，应当返回 dispatched；
 *    也可以访问 <地址>?dry=1 只看配置不真的触发。
 *
 * ------------------------------------------------------------
 * GitHub 令牌怎么建（细粒度 PAT，权限最小化）
 * ------------------------------------------------------------
 * GitHub → 右上角头像 → Settings → Developer settings →
 * Personal access tokens → Fine-grained tokens → Generate new token
 *   - Repository access: Only select repositories → 只勾 personal-briefing-bot
 *   - Permissions → Repository permissions → Actions: Read and write
 *   - 有效期按需（最长 1 年），到期后来这里换新令牌并更新 Worker 变量
 * 生成后复制（ghp_ 开头），填到 Worker 的 GH_TOKEN。
 */

export default {
  // Cloudflare 定时触发
  async scheduled(controller, env, ctx) {
    const result = await dispatch(env);
    console.log('[cron] ' + (controller.cron || '?') + ' -> ' + JSON.stringify(result));
  },

  // 手动访问 Worker 地址也能触发一次，方便测试
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('dry') === '1') {
      return json({
        ok: true,
        dry: true,
        repo: env.GH_REPO || '(未配置 GH_REPO)',
        workflow: env.GH_WORKFLOW || '(未配置 GH_WORKFLOW)',
        hasToken: Boolean(env.GH_TOKEN),
        note: '配置齐全的话，去掉 ?dry=1 再访问就会真的触发一次',
      });
    }
    const result = await dispatch(env);
    return json(result, result.ok ? 200 : 500);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function dispatch(env) {
  const repo = env.GH_REPO;
  const workflow = env.GH_WORKFLOW || 'briefing.yml';
  const ref = env.GH_REF || 'master';

  if (!repo || !env.GH_TOKEN) {
    return { ok: false, error: '缺少 GH_REPO 或 GH_TOKEN，请检查 Worker 的变量配置' };
  }

  const url = 'https://api.github.com/repos/' + repo + '/actions/workflows/' + workflow + '/dispatches';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + env.GH_TOKEN,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'personal-briefing-cron',
        'Content-Type': 'application/json',
      },
      // 不传 inputs：工作流会按墨尔本本地时间自动判断该发早报还是复盘，
      // 并且遵守「今天已发过」的去重，所以多触发几次也不会重复推送。
      body: JSON.stringify({ ref }),
    });

    const text = await res.text();
    if (res.status === 204) {
      return { ok: true, dispatched: true, at: new Date().toISOString(), repo, workflow, ref };
    }
    return { ok: false, status: res.status, body: text.slice(0, 500) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}
