# 个人咨询管家 · Personal Briefing Bot

每天早上 **07:00** 一份早报，晚上 **21:30** 一份复盘，推送到你的 Discord 频道。

内容包含：**今天的任务** + **arXiv 论文精选（机器人 / 自动化，本科可读）** + **科技动态** + **国内要闻快速解读（央视新闻 + 新闻联播）**。

---

## 为什么这次不会像上一版那样不稳定

上一版是「Discord Bot + 本机常驻进程 + 任务计划程序开机自启」：

| 上一版的问题 | 这一版怎么解决 |
|---|---|
| 电脑关机 / 休眠 = 收不到推送 | 跑在 **GitHub Actions** 云端，跟你开不开机完全无关 |
| Discord Bot 要维持长连接，断线重连经常失败 | 改用 **Webhook**，一次 HTTPS POST 就发完，没有「连接」可断 |
| Node 进程崩溃后要靠 Python 守护进程重启 | 每天都是全新的一次性任务，跑完即销毁，没有可崩溃的常驻状态 |
| 任务计划程序里的 bat 有 PATH / 工作目录坑 | 云端容器每次都是干净环境 |
| 出错了你不知道 | 任务失败时**主动推一条告警到 Discord** |

**关键：整条链路里没有任何需要一直活着的东西。**

```
GitHub Actions（定时触发，UTC cron ×4 个候选时刻）
      ↓
node src/index.mjs --mode=auto
      ↓  ① 读 tasks/tasks.md  → 今天的任务
      ↓  ② 抓 arXiv / 科技新闻 / 央视新闻 / 新闻联播
      ↓  ③ DeepSeek 挑选 + 翻译 + 写人话解读
      ↓  ④ 渲染成 Discord embed
Discord 频道 Webhook（HTTPS POST）
      ↓
把状态（去重表 / 任务归档）提交回仓库
```

---

## 一、任务怎么维护

任务全部放在 **`tasks/tasks.md`** 一个文件里，用 Markdown 复选框：

```markdown
## 进行中

- [ ] Yahboom 小车循迹与避障调试 @2026-09-25 !高 #硬件
- [ ] FYP things to note #FYP
- [x] 完成 fyp 毕业设计意向表格的填写
```

| 写法 | 含义 |
|---|---|
| `- [ ]` | 未完成 |
| `- [x]` | 已完成 |
| `@2026-09-25` | 截止日期（会算逾期 / 今天到期 / 还剩几天） |
| `!高` `!中` `!低` | 优先级（也可以写 `!high` 之类） |
| `#标签` | 标签，方便自己归类 |

**手机上怎么用：** 装一个 GitHub App，打开 `tasks/tasks.md` → 编辑 → 加一行 → 提交。
勾掉任务就把 `[ ]` 改成 `[x]`，同样保存提交。

完成超过 14 天的任务会被**自动归档**到 `tasks/done.md`，`tasks.md` 不会越来越长。

---

## 二、部署（一次性，约 10 分钟）

### 第 1 步：创建 Discord Webhook

1. 打开 Discord，进你想收简报的频道
2. 频道名右边齿轮 → **整合 (Integrations)** → **Webhook** → **新建 Webhook**
3. 改个名字（比如「咨询管家」），**复制 Webhook URL**
4. 想早晚分开发到不同频道，就再建一个，分别填到两个 secret 里

### 第 2 步：把代码推上 GitHub

```bash
cd D:/personal_proj/task-bot
git init
git add -A
git commit -m "feat: 个人咨询管家 v2（GitHub Actions + Discord Webhook）"
gh repo create personal-briefing-bot --private --source=. --push
```

> `.env`、`legacy/`、`_backup/` 已经在 `.gitignore` 里，不会被推上去。

### 第 3 步：配置 Secrets

仓库页面 → **Settings** → **Secrets and variables** → **Actions**：

**Secrets**（★ 为必填）：

| 名称 | 说明 |
|---|---|
| ★ `DEEPSEEK_API_KEY` | DeepSeek API Key |
| ★ `DISCORD_WEBHOOK_URL` | 第 1 步复制的 Webhook |
| `DISCORD_WEBHOOK_URL_EVENING` | 晚间复盘专用（不填就复用上面的） |
| `DISCORD_MENTION` | 想被 @ 就填 `<@你的用户ID>` |

**Variables**（选填，不填用默认值）：

| 名称 | 默认值 |
|---|---|
| `BRIEFING_TIMEZONE` | `Australia/Sydney` |
| `USER_NAME` | `老李` |
| `DEEPSEEK_MODEL` | `deepseek-v4-pro` |

### 第 4 步：手动跑一次验证

**Actions** → 左侧「每日简报」→ **Run workflow** → mode 选 `morning` → 先勾 `dry_run` 跑一次看日志，
确认没问题后再不勾 `dry_run` 正式跑一次，去 Discord 看有没有收到。

---

## 三、关于定时与夏令时

GitHub Actions 的 cron **只认 UTC**，而悉尼有夏令时（AEST UTC+10 / AEDT UTC+11），
所以工作流把**两个候选时刻都排上了**，真正发不发由脚本按本地时间判断：

| 简报 | 悉尼时间 | 夏令时 (AEDT) | 冬令时 (AEST) |
|---|---|---|---|
| 早报 | 07:00 | 20:00 UTC | 21:00 UTC |
| 复盘 | 21:30 | 10:30 UTC | 11:30 UTC |

脚本内部还会检查「今天这个时段是不是已经推过了」（记录在 `data/state.json`），
所以两排 cron 不会导致重复推送 —— **夏令时切换后你什么都不用改**。

想换推送时间：改 `.github/workflows/briefing.yml` 里的 cron，以及
`src/index.mjs` 里的 `MORNING_HOUR` / `EVENING_HOUR`（在 `src/config.mjs`）。

---

## 四、定制

| 想改什么 | 改哪里 |
|---|---|
| AI 对你的了解（专业方向、在乎的技术、不想要什么） | `config/profile.md` ← **最值得改的就是这个** |
| 抓哪些 arXiv 分类、哪些新闻源、每天选几篇 | `config/sources.json` |
| 简报的排版和文案结构 | `src/render.mjs` |
| AI 的提示词 | `src/prompts.mjs` |

`config/profile.md` 写得越具体，AI 挑论文就越准。比如写「我在用 Yahboom 小车跑 Nav2 导航」，
它就会优先挑导航相关、能落地的论文，而不是纯理论证明。

---

## 五、本地调试

```bash
npm run dry:morning     # 早报，预览不推送
npm run dry:evening     # 复盘，预览不推送
npm run dry:offline     # 不调 AI，只用抓到的原文拼（测数据源用）
npm run morning         # 真推送到 Discord
npm run morning -- --mode=...  # 见 package.json
```

本地跑需要 `.env`（复制 `.env.example` 填好）。

命令行参数：

| 参数 | 作用 |
|---|---|
| `--mode=morning\|evening\|auto` | 跑早报 / 复盘 / 按本地时间自动判断 |
| `--dry-run` | 只打印，不推送、不写任何文件 |
| `--no-ai` | 跳过 AI，直接用抓到的原文（测数据源、省 token） |
| `--force` | 忽略时间窗口和「今天已推送过」的判断 |

---

## 六、代码结构

```
src/
├── index.mjs        入口：判断该发早报还是复盘，串起整个流程
├── config.mjs       环境变量 + config/ 静态配置
├── state.mjs        data/state.json 读写（去重表 / 完成时间 / 早报快照）
├── tasks.mjs        tasks.md 解析、逾期计算、自动归档
├── collect.mjs      数据采集编排
├── feed.mjs         零依赖 RSS / Atom 解析
├── ai.mjs           DeepSeek 调用（JSON 模式 + 思维链 + 容错重试）
├── prompts.mjs      早报 / 复盘提示词
├── render.mjs       结构化结果 → Discord embed
├── push.mjs         Webhook 推送（自动分片、限流重试）
├── notify-failure.mjs 失败告警
└── util.mjs         抓取、时区、文本工具
```

数据源（都在 `src/collect.mjs`，配置在 `config/sources.json`）：

| 源 | 地址 |
|---|---|
| arXiv 机器人学 | `rss.arxiv.org/rss/cs.RO` |
| arXiv 系统与控制 | `rss.arxiv.org/rss/eess.SY` |
| arXiv 计算机视觉 | `rss.arxiv.org/rss/cs.CV` |
| IEEE Spectrum | `spectrum.ieee.org/feeds/feed.rss` |
| ROS Discourse | `discourse.ros.org/latest.rss` |
| 量子位 / IT之家 | `qbitai.com/feed` / `ithome.com/rss/` |
| 央视新闻 | `news.cctv.com` JSONP 接口 |
| 新闻联播 | 每日文字稿（自动往前找 1~3 天） |

**零第三方依赖** —— 只用 Node 内置能力，云端不用 `npm install`，启动只要几秒。
少一层依赖就少一类「昨天还好好的今天跑不起来」。

### 防 AI 编造链接

候选论文和新闻由我们自己抓取并带上 id，AI **只能引用这些 id** 来挑选和写解读，
最终链接是用 id 回查我们自己抓的数据填进去的。所以 AI 写的话可能是主观的，
但**链接和标题一定是真实的**。

---

## 七、出问题时

| 现象 | 原因 / 处理 |
|---|---|
| 到点了没收到 | 去 Actions 看有没有跑。GitHub 定时任务高峰期可能延迟几分钟到半小时 |
| 收到「每日简报任务失败」 | 点里面的日志链接看报错。最常见是 API Key 或 Webhook 失效 |
| 连续 60 天没收到 | GitHub 会停用长期无活动的定时工作流。本项目每天提交状态文件，正常不会触发；真遇到了去 Actions 页面点一次 Enable |
| 想临时补发一次 | Actions → Run workflow → 选 morning / evening，不勾 dry_run |
| 论文推送重复了 | `data/state.json` 的 `seenPaperIds` 被清掉了，不用管，第二天自然恢复 |
| AI 挂了怎么办 | 脚本会自动降级：照常推送任务 + 抓到的原文，只是没有中文解读 |

---

## 八、和旧版的关系

旧的 Discord Bot 代码完整保留在 `legacy/` 目录（原 `src/`、`run_bot.py`、`start_bot.bat`、
旧的 README），随时可以翻回去看。
旧的任务计划程序自启项 `TaskBot` 已删除，备份在 `_backup/TaskBot.task.xml`，
想恢复的话双击 `_backup/restore-task.ps1`（需要管理员权限）。
旧清单里的任务已经迁移进 `tasks/tasks.md`。
