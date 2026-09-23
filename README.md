# 个人咨询管家 · Personal Briefing Bot

每天早上 **07:00** 一份早报，晚上 **21:30** 一份复盘，推送到你的 Discord 频道。

内容包含：**墨尔本天气** + **今天的任务** + **arXiv 论文精选（机器人 / 自动化，本科可读）** + **科技动态** + **国内要闻快速解读（央视新闻 + 新闻联播）**。

晚间复盘包含：**明日天气** + 当天完成情况 + 明日建议。

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

任务全部放在 **`tasks/tasks.md`** 一个文件里，用 Markdown 复选框。三种改法，按场景挑一个。

### 写法规则

```markdown
## 进行中

- [ ] Yahboom 小车循迹与避障调试 @2026-09-25 !高 #硬件
- [ ] FYP things to note #FYP
- [x] 完成 fyp 毕业设计意向表格的填写
```

| 写法 | 含义 |
|---|---|
| `- [ ]` | 未完成 |
| `- [x]` 或 `- [X]` | 已完成，大小写都认 |
| `@2026-09-25` | 截止日期（会算逾期 / 今天到期 / 还剩几天） |
| `!高` `!中` `!低` | 优先级（也可以写 `!high` `!medium` `!low`） |
| `#标签` | 标签，方便自己归类 |
| `* [ ] xxx` | 用星号当列表符号也行 |

三个容易踩的坑：

1. 方括号里**必须有空格**：`- [ ] 任务` ✅ ／ `- [ ]任务` ❌ 识别不到
2. 标签**前面要有空格**：`做作业 #FYP` ✅ ／ `做作业#FYP` ❌ 不算标签
3. `@` `!` `#` 标记会从标题里去掉，这是正常的 —— AI 看到的是干净标题 + 单独的结构化字段

---

### 桌面端（主力方式）

#### 方式 A：一键脚本（推荐）

右键 `setup\edit-tasks.ps1` → **使用 PowerShell 运行**。脚本会自动：

1. `git pull --rebase` 同步云端 —— **这一步很关键**，见下方说明
2. 用编辑器（优先 VS Code，否则记事本）打开 `tasks/tasks.md`
3. 你改完保存，回终端按回车
4. 显示改动 diff，确认后自动 `commit` + `push`

#### 方式 B：手动 git

```powershell
cd D:\personal_proj\task-bot

git pull --rebase          # ← 一定要先拉，否则推送会被拒

# 用编辑器改 tasks/tasks.md

git add tasks/tasks.md
git commit -m "task: 加了几个任务"
git push
```

> ⚠️ **忘记 `git pull --rebase` 是这里唯一的坑。**
> GitHub Actions 每天会往仓库提交 `data/state.json`（去重表 + 任务归档），
> 本地落后时 `git push` 会报 `rejected`。真遇到了，`git pull --rebase` 再 push 一次就好。

---

### 手机端

#### 方式 A：快捷任务按钮（推荐，最快）

仓库 → **Actions** → 左侧 **📌 快捷任务** → **Run workflow** → 填表单 → 绿色按钮。

| 场景 | 怎么填 |
|---|---|
| **加任务** | action 选「添加任务」，`task` 填内容；截止日期、优先级、标签可选填 |
| **完成任务** | action 选「完成任务」，`task` 那栏**只填关键词**——模糊匹配，比如填「导师」 |

完成任务时如果匹配到多条，它会**列出来让你写得更具体**，不会乱勾。
不管哪种，跑完页面会直接显示结果摘要，仓库也会自动多一个提交。

#### 方式 B：GitHub App 直接改文件

GitHub App → 打开仓库 → `tasks/tasks.md` → 铅笔图标 ✏️ → 改 → **Commit changes**。
大约 7~8 次点击，适合坐下来慢慢整理，不适合随手记。

---

完成超过 14 天的任务会被**自动归档**到 `tasks/done.md`，`tasks.md` 不会越用越长。

---

## 二、部署（一次性，约 10 分钟）

### 第 1 步：创建 Discord Webhook

1. 打开 Discord，进你想收简报的频道
2. 频道名右边齿轮 → **整合 (Integrations)** → **Webhook** → **新建 Webhook**
3. 改个名字（比如「咨询管家」），**复制 Webhook URL**
4. 建**两个** Webhook，分别指向两个频道（当前配置）：

   | 频道 | 配置到哪个变量 |
   |---|---|
   | `#每日早报` | `DISCORD_WEBHOOK_URL` |
   | `#每日复盘` | `DISCORD_WEBHOOK_URL_EVENING` |

   > 只建一个也能用：`DISCORD_WEBHOOK_URL_EVENING` 留空时，晚间复盘会自动复用早报那个频道。
   > 拆成两个频道的好处是**手机端可以单独静音其中一个**。

### 第 2 步：把 Webhook 填进 `.env`

代码仓库**已经创建好并推送完成**：<https://github.com/XianruLi/personal-briefing-bot>（私有）。

现在只要把第 1 步复制的 Webhook 填到项目根目录的 `.env` 里：

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/............/....................
```

> `DEEPSEEK_API_KEY` 已经填好了，不用动。
> `.env` 在 `.gitignore` 里，不会进仓库。

### 第 3 步：运行激活脚本

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File setup\activate.ps1
```

或者直接**右键 `setup\activate.ps1` → 使用 PowerShell 运行**。

脚本会自动做完剩下所有事：

1. 校验 `.env` 填得对不对
2. 引导你补上 GitHub 的 `workflow` 权限（会打开浏览器，点一下 Authorize 就行）
3. 把定时工作流推送到仓库
4. 把 API Key 和 Webhook 写进 GitHub Secrets
5. 触发一次 **dry-run** 测试并打印日志地址

### 第 4 步：确认后正式发一次

```powershell
gh workflow run briefing.yml -f mode=morning -f dry_run=false
```

去 Discord 看有没有收到。收到之后就不用再管了 —— **这台电脑开不开机都一样**。

> 也可以完全不用脚本，手动在 GitHub 网页上操作：
> **Settings → Secrets and variables → Actions** 里加 `DEEPSEEK_API_KEY` 和 `DISCORD_WEBHOOK_URL`，
> 再把 `.github/workflows/briefing.yml` 通过网页上传即可。
> 选填的 Secrets / Variables：
>
> | 名称 | 类型 | 默认值 |
> |---|---|---|
> | `DISCORD_WEBHOOK_URL_EVENING` | Secret | 复用 `DISCORD_WEBHOOK_URL` |
> | `DISCORD_MENTION` | Secret | 不 @ 人 |
> | `FEISHU_WEBHOOK_URL` | Secret | 不启用飞书 |
> | `FEISHU_SECRET` | Secret | 飞书机器人未开签名校验 |
> | `FEISHU_WEBHOOK_URL_EVENING` | Secret | 复用 `FEISHU_WEBHOOK_URL` |
> | `WECOM_WEBHOOK_URL` | Secret | 不启用企业微信 |
> | `BRIEFING_TIMEZONE` | Variable | `Australia/Melbourne` |
> | `USER_NAME` | Variable | `老李` |
> | `DEEPSEEK_MODEL` | Variable | `deepseek-v4-pro` |

---

## 三、关于定时与夏令时

GitHub Actions 的 cron **只认 UTC**，而墨尔本有夏令时（AEST UTC+10 / AEDT UTC+11），
所以工作流把**两个候选时刻都排上了**，真正发不发由脚本按本地时间判断：

| 简报 | 墨尔本时间 | 夏令时 (AEDT, 10月~4月) | 冬令时 (AEST, 4月~10月) |
|---|---|---|---|
| 早报 | 07:00 | 20:00 UTC | 21:00 UTC |
| 复盘 | 21:30 | 10:30 UTC | 11:30 UTC |

脚本内部还会检查「今天这个时段是不是已经推过了」（记录在 `data/state.json`），
所以多排几组 cron 不会导致重复推送 —— **夏令时切换后你什么都不用改**。

> **想改推送时间？** 见 [6.1 改发送时间](#61-改发送时间)。
> 一句话：Cloudflare 的 cron 和 GitHub Variables 要一起改。

### 为什么用 Cloudflare 当闹钟（以及 GitHub 定时器的历史问题）

**2026-09-15 实测**：本仓库从创建到当时的 7 小时内，约 13 个应触发的 cron 时刻
**一次都没触发**，包括一个每 5 分钟的探针；而手动触发完全正常。
工作流文件、Actions 权限、仓库状态逐项核对均正常。

这匹配一个**已知的 GitHub bug：全新的私有仓库上 `schedule` 触发器不工作**
（社区讨论 [#201436](https://github.com/orgs/community/discussions/201436)，症状完全一致）。

**后来它自己恢复了**（2026-09-17 起观察到 `schedule` 事件正常运行），
推测就是「新仓库」这个条件随时间消失。

**但现在仍然是 Cloudflare 当主闹钟**，原因有三：

1. Cloudflare 的触发**非常准时**（实测都在目标时刻 +43 秒左右），GitHub 的经常延迟
2. GitHub 那次故障说明它**不可依赖**，留作备份更稳妥
3. 两套一起跑**不会重复推送**（靠 `data/state.json` 去重），所以留着纯属白赚的冗余

> **并发安全**：工作流启动时会强制同步到最新提交，避免两套闹钟几乎同时触发时
> 用到了过期的去重状态而重复推送。

**Cloudflare Worker 部署步骤**（代码在 `setup/cloudflare-worker.js`）：

1. 注册 [Cloudflare](https://dash.cloudflare.com) → Workers & Pages → Create → Workers → Deploy
2. Edit code，把 `setup/cloudflare-worker.js` 整个粘进去 → Deploy
3. Settings → Variables and Secrets 加三个变量：

   | 变量名 | 类型 | 值 |
   |---|---|---|
   | `GH_TOKEN` | Secret | 你的 GitHub 细粒度令牌 |
   | `GH_REPO` | Text | `XianruLi/personal-briefing-bot` |
   | `GH_WORKFLOW` | Text | `briefing.yml` |

4. Settings → Triggers → Cron Triggers 加 2 条（Cloudflare 的 cron 用 UTC）：

   | Cron 表达式 | 作用 |
   |---|---|
   | `0 20,21 * * *` | 早报：墨尔本 07:00（含夏令时两个分支） |
   | `30 10,11 * * *` | 复盘：墨尔本 21:30（含夏令时两个分支） |

   一天共触发 4 次，其中 2 次会因为不在时间窗口内而自动跳过。
5. 浏览器访问 Worker 根地址 → 只返回自检信息（不触发）；
   访问 `<地址>/trigger` → 才真正触发一次

**GitHub 令牌怎么建（权限最小化）：**
头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens →
Generate new token：
- Repository access 选 **Only select repositories**，只勾 `personal-briefing-bot`
- Permissions → Repository permissions → **Actions: Read and write**
- 有效期最长 1 年，到期换新令牌并更新 Worker 变量即可

> **不会重复推送**：Worker 触发时不带任何参数，工作流会按墨尔本本地时间自动判断该发早报
> 还是复盘，并遵守「今天已发过」的去重。所以 GitHub 自带定时器哪天修好了，
> 两套一起跑也不会重复 —— 可以放心留着当备份。

---

## 四、天气

早报第一块就是天气，复盘里会带**明天**的天气。数据来自 [Open-Meteo](https://open-meteo.com)：
**免费、不需要 API Key**，所以没有额外的注册和配额烦恼。

包含：今日实况（实际温度 / 体感 / 湿度 / 风速）、今明预报（温度区间、天气、降水概率、雨量、
最大风速、UV 指数、日出日落）。AI 会基于这些**真实数字**给一句穿衣和出行建议 ——
比如「体感只有 5°C，风大，别只穿卫衣」，而不是泛泛地说「今天有点冷」。

**换位置**：改 `config/sources.json` 里的 `weather` 段：

```json
"weather": {
  "enabled": true,
  "name": "墨尔本 Oakleigh East",
  "postcode": "3166",
  "latitude": -37.9,
  "longitude": 145.1167,
  "timezone": "Australia/Melbourne",
  "forecastDays": 2
}
```

`latitude` / `longitude` 去 [open-meteo 地理编码](https://geocoding-api.open-meteo.com/v1/search?name=Oakleigh+East&count=5&countryCode=AU)
查，或者地图上右键复制坐标。天气是区域性的，精确到 suburb 就够了。

> 天气抓取失败不影响其他内容 —— 那一块会自动消失，简报照常发。

---

## 五、推送渠道

支持三个渠道，**可以同时开** —— 填了几个就推几个，互不影响：

| 渠道 | 变量 | 大陆可用 |
|---|---|---|
| Discord | `DISCORD_WEBHOOK_URL` | ❌ 需要梯子 |
| 飞书 / Lark | `FEISHU_WEBHOOK_URL` | ✅ 原生可用 |
| 企业微信 | `WECOM_WEBHOOK_URL` | ✅ 原生可用 |

单个渠道失败**不影响**其他渠道；**全部失败时不会记录「今天已发」**，所以下次定时器还会重试。

### 飞书怎么配

1. 建一个飞书群（自定义机器人只能加群、不能私聊；只有你自己也行）
2. 群 → `···` → 设置 → **群机器人** → 添加机器人 → **自定义机器人**
3. 名字随意，比如「咨询管家」
4. **安全设置选「签名校验」**

   | 选项 | 能否使用 |
   |---|---|
   | **签名校验** | ✅ 推荐，密钥填到 `FEISHU_SECRET` |
   | 自定义关键词 | ⚠️ 每条消息都必须包含该关键词，会限制内容 |
   | IP 白名单 | ❌ **不能用** —— GitHub Actions 出口 IP 是动态的 |

5. 复制 Webhook 地址，填进 `.env` 或 GitHub Secrets：

   ```
   FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx
   FEISHU_SECRET=你的密钥
   ```

6. 想让早晚发到不同群，再配一个 `FEISHU_WEBHOOK_URL_EVENING`

> **实测结论（2026-09-16）**：GitHub 的服务器（美国）能正常发到飞书（国内），
> 这条跨境链路验证通过。换渠道或改配置后，建议用下面那个自检工作流复查一次。

### 企业微信怎么配

企业微信群 → 右上角 → 群机器人 → 添加 → 复制 Webhook 地址 → 填到 `WECOM_WEBHOOK_URL`。

### 随时自检

仓库 → **Actions** → **🔔 推送自检** → **Run workflow**

会往所有已配置的渠道各发一条测试消息，用来验证「GitHub → 各渠道」这条链路通不通。

> **本地能发不代表云端能发** —— 网络环境不同。加了新渠道之后建议跑一次。

---

## 六、改造指南

### 6.1 改发送时间

**要改两个地方，必须对齐**（一个是"闹钟"，一个是"门卫"）：

| 改什么 | 在哪改 | 作用 |
|---|---|---|
| **闹钟何时响** | Cloudflare → 你的 Worker → **Settings → Triggers → Cron Triggers** | 到点叫醒工作流（用 **UTC**） |
| **响了之后发不发** | GitHub 仓库 → **Settings → Secrets and variables → Actions → Variables** | 工作流醒来后看墨尔本几点，不在窗口内就跳过 |

只改一个会出问题：
- 只改 Cloudflare → 工作流醒来发现不在窗口内，**静默跳过**（不报错，但收不到）
- 只改 Variable → 闹钟还是老时间响，照样跳过

**UTC 换算规则**（墨尔本）：

| 季节 | 墨尔本 | 对应的 UTC |
|---|---|---|
| 冬令时 AEST | UTC+10 | 本地时间 **−10 小时** |
| 夏令时 AEDT（10月~4月） | UTC+11 | 本地时间 **−11 小时** |

**示例：想改成早上 8:00 / 晚上 22:00**

1. 本地 08:00 → 冬令时是 UTC 22:00、夏令时是 UTC 21:00 → 写 `0 21,22 * * *`
2. 本地 22:00 → 冬令时是 UTC 12:00、夏令时是 UTC 11:00 → 写 `0 11,12 * * *`
3. GitHub Variables 改成 `MORNING_HOUR=8`、`EVENING_HOUR=22`、`EVENING_MINUTE=0`

> **为什么每条 cron 要写两个小时**：因为夏令时切换会让同一个本地时间对应两个不同的 UTC 小时。
> 两个都排上，由工作流的窗口判断决定哪个真正生效，并且靠 `data/state.json` 去重保证不会发两次。
> **这样你一年只需要改一次都不到 —— 夏令时切换本身不用管。**

### 6.2 改推送内容

全部集中在 **`config/sources.json`**，改完直接提交即可。

| 想改什么 | 改哪个字段 |
|---|---|
| 增删新闻源 | 对应板块的 `feeds` 数组 |
| 每天推几条 | 对应板块的 `maxPicks`（AI 从中挑选的数量） |
| 每个源抓几条候选 | `maxPerFeed` |
| **丢弃多少天前的旧闻** | `maxAgeDays` |
| arXiv 抓哪些分类 | `arxiv.feeds`（默认 cs.RO / eess.SY / cs.CV） |
| 天气位置、邮编、坐标 | `weather` 段 |

各板块对应简报里的哪一块：

| 板块 | 简报里的位置 |
|---|---|
| `weather` | 🌤 今日天气（第一块） |
| `arxiv` | 📄 arXiv 论文精选 |
| `techNews` | 📰 科技动态 |
| `cnNews` | 🇨🇳 国内要闻速读（央视 + 新闻联播） |
| `politics` | 🌏 时政要闻与解读 |

#### ⚠️ 加新闻源之前，务必先验证它「还活着」

**这是踩过的坑**：很多中文媒体的 RSS 接口还在，但内容早就停更了——
新华社的 RSS 停在 **2022-12**，人民网的停在 **2025-06**。不验证的话，
会把四年前的旧闻当成今天的新闻推给你。

两条防线：

1. **`maxAgeDays`（默认 3 天）** —— 代码会从 `pubDate` 或链接里的日期
   （`/2022-12/14/`、`/2026/09/24/`）推断发布时间，超期的条目直接丢弃，
   并在日志里打印 `丢弃 N 条超过 3 天的旧闻（源可能已停更）`。
2. **加源前本地跑一次**：

   ```powershell
   npm run dry:offline    # 不调 AI，只用抓到的原文拼，几秒出结果
   ```

   如果某个板块是空的，或者日志里出现"丢弃…旧闻"，说明那个源不要加。

**已验证可用的源（2026-09）**：

| 板块 | 源 | 状态 |
|---|---|---|
| 时政 | 中新网·国内 / 国际 / 财经 | ✅ 当天更新 |
| 时政 | RT（今日俄罗斯） | ✅ 当天更新 |
| 时政 | ~~新华社~~ / ~~人民网~~ | ❌ RSS 已停更，别加 |
| 时政 | ~~BBC / CNN / 经济学人~~ | 🚫 按你的要求不采用 |
| 时政 | ~~China Daily~~ | ❌ 官方 RSS 已下线（/rss/ 全部 404） |
| 科技 | IEEE Spectrum / ROS Discourse / 量子位 / IT之家 | ✅ |
| 国内 | 央视新闻接口 / 新闻联播文字稿 | ✅ |

### 6.3 改 AI 的风格与侧重

| 想改什么 | 改哪里 |
|---|---|
| **AI 对你的了解**（专业方向、在乎什么、不想要什么） | `config/profile.md` ← **最值得改的就是这个** |
| AI 的挑选原则、解读角度、语气 | `src/prompts.mjs` 的 `STYLE_RULES` 和各板块规则 |
| 每段说什么、排版长什么样 | `src/render.mjs` |
| 用哪个模型、推理强度 | GitHub Variables `DEEPSEEK_MODEL`、`.env` 的 `DEEPSEEK_REASONING_EFFORT` |

`config/profile.md` 越具体，AI 挑东西越准。比如写「我在用 Yahboom 小车跑 Nav2 导航」，
它就会优先挑导航相关、能落地的论文，而不是纯理论证明。

### 6.4 改完怎么验证

1. **本地预览**（不推送、不写文件）：
   ```powershell
   npm run dry:morning     # 早报
   npm run dry:evening     # 复盘
   npm run dry:offline     # 不调 AI，快速测数据源
   ```
2. **云端验证**：仓库 → Actions → **🔔 推送自检** → Run workflow
   （验证 GitHub 服务器能不能真的发到各渠道）
3. **真实预览**：Actions → **每日简报** → Run workflow → mode 选 `morning`，
   勾上 `dry_run` 和 `force` —— 会在日志里打印完整简报但不真发

> 改完记得 `git push`。**云端跑的是仓库里的代码**，本地改了不推等于没改。

---

## 七、本地调试

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

## 八、代码结构

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
├── sources/weather.mjs  天气（Open-Meteo，免费无需 API Key）
├── task-action.mjs  快捷任务按钮的后端（加任务 / 按关键词完成任务）
├── notify-failure.mjs 失败告警
└── util.mjs         抓取、时区、文本工具

.github/workflows/
├── briefing.yml     定时工作流（早 7:00 / 晚 21:30）
└── add-task.yml     「📌 快捷任务」按钮

setup/
├── activate.ps1     一次性激活（推工作流 + 写 Secrets）
└── edit-tasks.ps1   桌面端改任务的一键脚本
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
| 天气 | Open-Meteo `api.open-meteo.com`（实况 + 今明预报 + UV + 日出日落） |

**零第三方依赖** —— 只用 Node 内置能力，云端不用 `npm install`，启动只要几秒。
少一层依赖就少一类「昨天还好好的今天跑不起来」。

### 防 AI 编造链接

候选论文和新闻由我们自己抓取并带上 id，AI **只能引用这些 id** 来挑选和写解读，
最终链接是用 id 回查我们自己抓的数据填进去的。所以 AI 写的话可能是主观的，
但**链接和标题一定是真实的**。

---

## 九、出问题时

| 现象 | 原因 / 处理 |
|---|---|
| 到点了没收到 | 去 Actions 看有没有跑。GitHub 定时任务高峰期可能延迟几分钟到半小时 |
| 收到「每日简报任务失败」 | 点里面的日志链接看报错。最常见是 API Key 或 Webhook 失效 |
| 连续 60 天没收到 | GitHub 会停用长期无活动的定时工作流。本项目每天提交状态文件，正常不会触发；真遇到了去 Actions 页面点一次 Enable |
| 想临时补发一次 | Actions → Run workflow → 选 morning / evening，不勾 dry_run |
| 论文推送重复了 | `data/state.json` 的 `seenPaperIds` 被清掉了，不用管，第二天自然恢复 |
| AI 挂了怎么办 | 脚本会自动降级：照常推送任务 + 抓到的原文，只是没有中文解读 |

---

## 十、和旧版的关系

旧的 Discord Bot 代码完整保留在 `legacy/` 目录（原 `src/`、`run_bot.py`、`start_bot.bat`、
旧的 README），随时可以翻回去看。
旧的任务计划程序自启项 `TaskBot` 已删除，备份在 `_backup/TaskBot.task.xml`，
想恢复的话双击 `_backup/restore-task.ps1`（需要管理员权限）。
旧清单里的任务已经迁移进 `tasks/tasks.md`。
