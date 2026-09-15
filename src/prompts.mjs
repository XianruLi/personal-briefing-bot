/**
 * 提示词构建。所有让 AI 输出的内容都走「只做选择 + 解释，不编造链接」的路子：
 * 候选条目由我们自己抓取并编号，AI 只能引用这些 id。
 */
import { config } from './config.mjs';

const STYLE_RULES = [
  '你要为一个中文用户写每日简报，他是在读本科生，专业是机器人工程 / 机电自动化。',
  '语言：简体中文，口语化、干脆，像熟悉他的学长在讲话，不要官腔、不要「首先其次最后」。',
  '受众水平：本科。解释论文时默认他懂基础微积分、线性代数、C 语言、ROS，但没读过博士级论文。',
  '严禁编造：只能使用下面给出的条目，不许虚构标题、结论、数字或链接。',
  '长度：每条尽量 1-2 句，整份简报控制在 3 分钟能读完。',
].join('\n');

function profileBlock() {
  const p = (config.profile || '').trim();
  return p ? '\n\n===== 用户档案（越贴合这里越好）=====\n' + p : '';
}

function paperBlock(papers) {
  if (!papers.length) return '（今天没有抓到可用论文）';
  return papers
    .map((p, i) => {
      const no = String(i + 1).padStart(2, '0');
      return '[' + no + '] id=' + p.id + ' | ' + p.source + '\n标题: ' + p.title + '\n摘要: ' + p.abstract;
    })
    .join('\n\n');
}

function newsBlock(items) {
  if (!items.length) return '（今天没有抓到可用新闻）';
  return items
    .map((n, i) => {
      const no = String(i + 1).padStart(2, '0');
      const extra = n.summary ? '\n摘要: ' + n.summary : '';
      return '[' + no + '] id=' + n.id + ' | ' + n.source + '\n标题: ' + n.title + extra;
    })
    .join('\n\n');
}

// ============================================================
//  早报
// ============================================================
export function buildMorningPrompt({ data, grouped, todayIso, zone }) {
  const maxPapers = config.sources.arxiv.maxPicks;
  const maxTech = config.sources.techNews.maxPicks;
  const maxCn = config.sources.cnNews.maxPicks;

  const system = [
    '你是用户的「个人咨询管家」，负责每天早上给他一份值日简报。',
    STYLE_RULES,
    '挑选原则：优先与他专业方向（移动机器人、ROS2、嵌入式、运动控制、路径规划）相关、且本科能读懂的条目；',
    '明显是纯理论证明、需要博士背景、或者只是营销 buzzword 的，直接跳过不选。',
    '宁可少选，也不要凑数。',
    profileBlock(),
  ].join('\n');

  const user = [
    '今天是 ' + zone.label + '（' + todayIso + '），时区 ' + config.timeZone + '。请生成今天的早报内容。',
    '',
    '===== 一、我的任务清单 =====',
    grouped.promptText,
    '',
    '===== 二、arXiv 候选论文（只能从这里选，最多 ' + maxPapers + ' 篇）=====',
    paperBlock(data.papers),
    '',
    '===== 三、科技新闻候选（只能从这里选，最多 ' + maxTech + ' 条）=====',
    newsBlock(data.techNews),
    '',
    '===== 四、央视新闻候选（只能从这里选，最多 ' + maxCn + ' 条）=====',
    newsBlock(data.cnNews),
    '',
    '===== 五、昨晚《新闻联播》文字稿节选 =====',
    data.xwlb || '（今天没抓到新闻联播文字稿）',
    '',
    '===== 输出要求 =====',
    '只输出一个 JSON 对象（不要 markdown 代码块，不要多余解释），字段如下：',
    '{',
    '  "greeting": "开场白，一句，可以带今天星期几和天气式的心情，不要肉麻",',
    '  "taskComment": "针对今天任务的 1-2 句点评或建议，要具体（比如提醒先做逾期的、指出某项可以拆小）",',
    '  "taskFocus": ["今天最该先做的 1-3 件事，必须原样抄任务标题"],',
    '  "papers": [',
    '    {',
    '      "id": "上面候选里的 id，必须完全一致",',
    '      "titleZh": "把英文标题翻成地道中文，不要机翻腔",',
    '      "what": "这篇干了什么，1-2 句，讲人话，避免堆术语",',
    '      "why": "为什么值得他看 / 和他的项目有什么联系，1 句"',
    '    }',
    '  ],',
    '  "techNews": [ { "id": "候选 id", "titleZh": "中文标题", "summary": "一句话讲清楚发生了什么，以及对他有没有用" } ],',
    '  "cnNews": [ { "id": "候选 id", "topic": "8 字以内的主题词", "summary": "这条新闻说了什么，1 句", "take": "一句快速解读：这意味着什么 / 跟他有什么关系" } ],',
    '  "xwlb": { "headline": "昨晚新闻联播最值得注意的 1 件事，15 字以内", "summary": "2-3 句概括，重点说清政策或经济信号", "take": "一句解读" },',
    '  "tip": "今天给他的一句提醒或鼓励，20-40 字，不要心灵鸡汤腔"',
    '}',
    '',
    '如果某一类没有合适内容，就返回空数组；xwlb 没有文字稿时返回 null。',
  ].join('\n');

  return { system, user };
}

// ============================================================
//  晚间复盘
// ============================================================
export function buildEveningPrompt({ grouped, todayIso, zone, newlyDone, morningOpenCount }) {
  const system = [
    '你是用户的「个人咨询管家」，负责晚上 21:30 做当天复盘。',
    STYLE_RULES,
    '复盘的语气要像一个靠谱的朋友：做到的事给肯定，没做完的直接说，但不要指责，也不要灌鸡汤。',
    profileBlock(),
  ].join('\n');

  const doneList = grouped.completed.length
    ? grouped.completed.map((t) => '- ' + t.title).join('\n')
    : '（没有已完成的任务）';
  const openList = [...grouped.overdue, ...grouped.dueToday, ...grouped.upcoming, ...grouped.noDue]
    .map((t) => '- ' + t.title)
    .join('\n') || '（没有未完成任务，清单是空的）';

  const user = [
    '今天是 ' + zone.label + '（' + todayIso + '）。请生成今晚的复盘。',
    '',
    '===== 已完成 =====',
    doneList,
    '',
    '===== 仍未完成 =====',
    openList,
    '',
    '===== 背景数据 =====',
    '今天早上推送时未完成任务数：' + (morningOpenCount == null ? '（无记录）' : morningOpenCount),
    '现在未完成任务数：' + grouped.openCount,
    '今天新勾掉的任务：' + (newlyDone.length ? newlyDone.map((t) => t.title).join('、') : '无'),
    '',
    '===== 输出要求 =====',
    '只输出一个 JSON 对象（不要 markdown 代码块），字段如下：',
    '{',
    '  "greeting": "一句晚间开场",',
    '  "progress": "1-2 句总结今天的完成情况，给出具体数字对比",',
    '  "doneList": ["今天完成的任务标题，原样抄"],',
    '  "remaining": ["还没完成、且明天值得先做的任务标题，最多 5 条，按优先级"],',
    '  "tomorrow": ["明天建议做的 1-3 件事，要具体可执行"],',
    '  "comment": "一句针对他的提醒，比如某项拖太久了、某项该拆小",',
    '  "tip": "睡前一句，20-40 字，不要鸡汤"',
    '}',
  ].join('\n');

  return { system, user };
}

export { paperBlock, newsBlock };
