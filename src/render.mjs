/**
 * 把 AI 的结构化结果渲染成 Discord 内容块。
 * 链接一律来自我们自己抓取的数据，按 id 回填，杜绝 AI 编造 URL。
 */
import { config } from './config.mjs';

export const COLORS = {
  task: 0x5865f2,
  paper: 0x57f287,
  tech: 0xfee75c,
  cn: 0xed4245,
  tip: 0xeb459e,
  fail: 0xed4245,
};

const byId = (items) => {
  const map = new Map();
  for (const it of items || []) map.set(it.id, it);
  return map;
};

const clip = (s, n) => {
  const t = String(s == null ? '' : s).trim();
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
};

/**
 * 天气区块。数字永远来自抓取结果，AI 只补一句摘要和建议 —— 所以即使 AI 挂了也有天气看。
 */
function weatherSection(weather, todayIso, aiWeather, { tomorrowOnly = false } = {}) {
  if (!weather || (!weather.days || !weather.days.length) && !weather.current) return null;

  const days = weather.days || [];
  if (tomorrowOnly) {
    const tomorrow = days.find((d) => d.date !== todayIso) || days[0];
    if (!tomorrow) return null;
    const body = ['**' + tomorrow.weekday + ' ' + tomorrow.min + '~' + tomorrow.max + '°C** · ' + tomorrow.text + ' ' + tomorrow.emoji +
      ' · 降水概率 ' + (tomorrow.rainChance == null ? '?' : tomorrow.rainChance + '%')];
    if (tomorrow.uvMax != null && tomorrow.uvMax >= 6) body.push('UV 指数 ' + tomorrow.uvMax + '，中午注意防晒');
    if (aiWeather && aiWeather.advice) body.push('', '👕 ' + clip(aiWeather.advice, 300));
    return { title: '🌤 明天天气 · ' + (weather.location || ''), body: body.join('\n'), color: 0x3498db };
  }

  const today = days.find((d) => d.date === todayIso) || days[0];
  if (!today) return null;

  const lines = [];
  lines.push('**' + today.min + '~' + today.max + '°C** · ' + today.text + ' ' + today.emoji +
    (today.rainChance == null ? '' : ' · 降水概率 ' + today.rainChance + '%'));

  const facts = [];
  if (weather.current) {
    facts.push('实况 ' + weather.current.temp + '°C');
    if (weather.current.feelsLike != null && Math.abs(weather.current.feelsLike - weather.current.temp) >= 2) {
      facts.push('体感 ' + weather.current.feelsLike + '°C');
    }
    if (weather.current.humidity != null) facts.push('湿度 ' + weather.current.humidity + '%');
    if (weather.current.wind != null) facts.push('风 ' + weather.current.wind + ' km/h');
  } else if (today.windMax != null) {
    facts.push('最大风 ' + today.windMax + ' km/h');
  }
  if (today.uvMax != null) facts.push('UV ' + today.uvMax);
  if (facts.length) lines.push(facts.join(' · '));

  if (today.sunrise || today.sunset) {
    lines.push('日出 ' + today.sunrise + ' · 日落 ' + today.sunset);
  }

  if (aiWeather && aiWeather.summary) lines.push('', '💬 ' + clip(aiWeather.summary, 300));
  if (aiWeather && aiWeather.advice) lines.push('👕 ' + clip(aiWeather.advice, 300));

  const title = '🌤 今日天气 · ' + (weather.location || '') + (weather.postcode ? ' ' + weather.postcode : '');
  return { title, body: lines.join('\n'), color: 0x3498db };
}

/**
 * 早报：返回 [{ title, body, color }]
 */
export function renderMorning({ ai, data, grouped, zone, todayIso }) {
  const paperMap = byId(data.papers);
  const techMap = byId(data.techNews);
  const cnMap = byId(data.cnNews);
  const politicsMap = byId(data.politics);
  const sections = [];

  const wx = weatherSection(data.weather, todayIso, ai.weather);
  if (wx) sections.push(wx);

  // ---- 任务 ----
  const focus = Array.isArray(ai.taskFocus) ? ai.taskFocus.filter(Boolean) : [];
  const taskLines = [];
  if (grouped.overdue.length) {
    taskLines.push('**🔴 已逾期 ' + grouped.overdue.length + ' 项**');
    for (const t of grouped.overdue.slice(0, 6)) taskLines.push('• ' + clip(t.title, 90) + '（逾期 ' + t.overdueDays + ' 天）');
  }
  if (grouped.dueToday.length) {
    taskLines.push('**🟠 今天到期 ' + grouped.dueToday.length + ' 项**');
    for (const t of grouped.dueToday) taskLines.push('• ' + clip(t.title, 90));
  }
  if (grouped.upcoming.length) {
    taskLines.push('**🟡 即将到期**');
    for (const t of grouped.upcoming.slice(0, 6)) taskLines.push('• ' + clip(t.title, 90) + '（' + t.dueInDays + ' 天后）');
  }
  if (grouped.noDue.length) {
    taskLines.push('**⚪ 待办池 ' + grouped.noDue.length + ' 项**');
    for (const t of grouped.noDue.slice(0, 8)) taskLines.push('• ' + clip(t.title, 90));
  }
  if (!taskLines.length) taskLines.push('清单是空的，今天没有待办 🎉');

  const taskBody = [];
  if (focus.length) taskBody.push('**👉 建议先做：**\n' + focus.map((f, i) => (i + 1) + '. ' + clip(f, 90)).join('\n'), '');
  taskBody.push(taskLines.join('\n'));
  if (ai.taskComment) taskBody.push('', '💬 ' + clip(ai.taskComment, 400));
  sections.push({ title: '📋 今日任务（未完成 ' + grouped.openCount + ' 项）', body: taskBody.join('\n'), color: COLORS.task });

  // ---- 论文 ----
  const papers = (Array.isArray(ai.papers) ? ai.papers : [])
    .map((p) => ({ meta: paperMap.get(p.id), ai: p }))
    .filter((x) => x.meta);
  if (papers.length) {
    const body = papers
      .map((x, i) => {
        const lines = ['**' + (i + 1) + '. ' + clip(x.ai.titleZh || x.meta.title, 120) + '**'];
        lines.push('*' + clip(x.meta.title, 180) + '*');
        if (x.ai.what) lines.push('🔍 ' + clip(x.ai.what, 400));
        if (x.ai.why) lines.push('🎯 ' + clip(x.ai.why, 300));
        lines.push('🔗 ' + x.meta.url + '  ·  ' + x.meta.source);
        return lines.join('\n');
      })
      .join('\n\n');
    sections.push({ title: '📄 arXiv 论文精选', body, color: COLORS.paper });
  }

  // ---- 科技新闻 ----
  const tech = (Array.isArray(ai.techNews) ? ai.techNews : [])
    .map((n) => ({ meta: techMap.get(n.id), ai: n }))
    .filter((x) => x.meta);
  if (tech.length) {
    const body = tech
      .map((x) => {
        const lines = ['**' + clip(x.ai.titleZh || x.meta.title, 120) + '**'];
        if (x.ai.summary) lines.push(clip(x.ai.summary, 350));
        lines.push('🔗 ' + x.meta.url + '  ·  ' + x.meta.source);
        return lines.join('\n');
      })
      .join('\n\n');
    sections.push({ title: '📰 科技动态', body, color: COLORS.tech });
  }

  // ---- 国内要闻 ----
  const cn = (Array.isArray(ai.cnNews) ? ai.cnNews : [])
    .map((n) => ({ meta: cnMap.get(n.id), ai: n }))
    .filter((x) => x.meta);
  const cnBlocks = [];
  if (cn.length) {
    cnBlocks.push(
      cn
        .map((x) => {
          const head = x.ai.topic ? '**' + clip(x.ai.topic, 20) + '** · ' + clip(x.ai.titleZh || x.meta.title, 90) : '**' + clip(x.meta.title, 110) + '**';
          const lines = [head];
          if (x.ai.summary) lines.push(clip(x.ai.summary, 300));
          if (x.ai.take) lines.push('💡 ' + clip(x.ai.take, 250));
          return lines.join('\n');
        })
        .join('\n\n')
    );
  }
  if (ai.xwlb && ai.xwlb.summary) {
    const lines = ['**📺 昨晚《新闻联播》· ' + clip(ai.xwlb.headline || '', 30) + '**', clip(ai.xwlb.summary, 700)];
    if (ai.xwlb.take) lines.push('💡 ' + clip(ai.xwlb.take, 250));
    if (data.xwlbUrl) lines.push('🔗 ' + data.xwlbUrl);
    cnBlocks.push(lines.join('\n'));
  }
  if (cnBlocks.length) {
    sections.push({ title: '🇨🇳 国内要闻速读', body: cnBlocks.join('\n\n'), color: COLORS.cn });
  }

  // ---- 国际 / 国内时政 ----
  const politics = (Array.isArray(ai.politics) ? ai.politics : [])
    .map((n) => ({ meta: politicsMap.get(n.id), ai: n }))
    .filter((x) => x.meta);
  if (politics.length) {
    const body = politics
      .map((x) => {
        const scope = x.ai.scope === '国际' ? '🌐' : x.ai.scope === '国内' ? '🇨🇳' : '•';
        const lines = [scope + ' **' + clip(x.ai.title || x.meta.title, 110) + '**'];
        if (x.ai.summary) lines.push(clip(x.ai.summary, 320));
        if (x.ai.take) lines.push('💡 ' + clip(x.ai.take, 250));
        lines.push('🔗 ' + x.meta.url + '  ·  ' + x.meta.source);
        return lines.join('\n');
      })
      .join('\n\n');
    sections.push({ title: '🌏 时政要闻与解读', body, color: COLORS.cn });
  }

  // ---- 今日一句 ----
  if (ai.tip) sections.push({ title: '💡 今日一句', body: clip(ai.tip, 500), color: COLORS.tip });

  const header = '**🌅 ' + config.userName + '，早上好 · ' + zone.label + '**\n' + (ai.greeting ? clip(ai.greeting, 200) : '');

  // 数据源异常时给个提示，避免「今天怎么没论文」的困惑
  if (data.errors && data.errors.length) {
    sections.push({ title: '⚠️ 数据源提示', body: '以下来源本次抓取失败（不影响其余内容）：\n' + data.errors.slice(0, 5).map((e) => '• ' + clip(e, 180)).join('\n'), color: COLORS.fail });
  }

  return { header, sections };
}

/**
 * 晚间复盘：返回 [{ title, body, color }]
 */
export function renderEvening({ ai, grouped, zone, newlyDone, morningOpenCount, weather, todayIso }) {
  const sections = [];

  const wx = weatherSection(weather, todayIso, ai.weather, { tomorrowOnly: true });
  if (wx) sections.push(wx);

  const stat = [];
  stat.push('未完成：**' + grouped.openCount + '** 项' + (morningOpenCount == null ? '' : '（早上是 ' + morningOpenCount + ' 项）'));
  stat.push('已完成：**' + grouped.completed.length + '** 项');
  if (newlyDone.length) stat.push('今天新勾掉：**' + newlyDone.length + '** 项');

  const body1 = [stat.join('　·　')];
  if (ai.progress) body1.push('', clip(ai.progress, 500));
  sections.push({ title: '📊 今日进度', body: body1.join('\n'), color: COLORS.task });

  const done = Array.isArray(ai.doneList) ? ai.doneList.filter(Boolean) : [];
  if (done.length) {
    sections.push({ title: '✅ 今天完成的', body: done.map((d) => '• ' + clip(d, 100)).join('\n'), color: COLORS.paper });
  }

  const remaining = Array.isArray(ai.remaining) ? ai.remaining.filter(Boolean) : [];
  const tomorrow = Array.isArray(ai.tomorrow) ? ai.tomorrow.filter(Boolean) : [];
  const body3 = [];
  if (remaining.length) body3.push('**还欠着的：**\n' + remaining.map((r) => '• ' + clip(r, 100)).join('\n'));
  if (tomorrow.length) body3.push('', '**明天先做：**\n' + tomorrow.map((t, i) => (i + 1) + '. ' + clip(t, 100)).join('\n'));
  if (!body3.length) body3.push('今天没有遗留任务，状态不错。');
  sections.push({ title: '📌 收尾与明日', body: body3.join('\n'), color: COLORS.tech });

  if (ai.comment || ai.tip) {
    const lines = [];
    if (ai.comment) lines.push('💬 ' + clip(ai.comment, 400));
    if (ai.tip) lines.push('', '🌙 ' + clip(ai.tip, 400));
    sections.push({ title: '💤 睡前一句', body: lines.join('\n'), color: COLORS.tip });
  }

  const header = '**🌙 ' + config.userName + '，今日复盘 · ' + zone.label + '**\n' + (ai.greeting ? clip(ai.greeting, 200) : '');
  return { header, sections };
}

export { clip };
