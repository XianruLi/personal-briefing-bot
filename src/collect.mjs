/**
 * 数据采集：arXiv 论文 / 科技新闻 / 央视新闻 / 新闻联播。
 * 每个源互相独立，单个失败不影响整体 —— 失败信息会收集到 errors 里。
 */
import { config } from './config.mjs';
import { parseFeed } from './feed.mjs';
import { fetchText, truncate, uniqueBy, dateInZone, isFresh } from './util.mjs';
import { collectWeather } from './sources/weather.mjs';

/** 简单哈希，用于给新闻生成稳定 ID。 */
function hashId(text) {
  let h = 5381;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** 每轮取一批，轮转多个 feed，保证来源均衡。 */
function roundRobin(buckets, total) {
  const out = [];
  let idx = 0;
  let added = true;
  while (out.length < total && added) {
    added = false;
    for (const bucket of buckets) {
      if (idx < bucket.length && out.length < total) {
        out.push(bucket[idx]);
        added = true;
      }
    }
    idx++;
  }
  return out;
}

// ============================================================
//  arXiv 论文
// ============================================================
export async function collectArxiv(state) {
  const cfg = config.sources.arxiv;
  const seen = new Set(state.seenPaperIds || []);
  const errors = [];
  const perFeedCap = Math.ceil(cfg.maxCandidates / Math.max(1, cfg.feeds.length));
  const buckets = [];

  for (const feed of cfg.feeds) {
    try {
      const xml = await fetchText(feed.url, { timeoutMs: 30000, label: 'arXiv ' + feed.id });
      const bucket = [];
      for (const item of parseFeed(xml)) {
        const announce = (item.description.match(/Announce Type:\s*([A-Za-z-]+)/) || [])[1] || 'new';
        if (!cfg.announceTypes.includes(announce)) continue;

        const idMatch = item.description.match(/arXiv:([0-9]{4}\.[0-9]{4,5})(v\d+)?/) || item.link.match(/abs\/([0-9]{4}\.[0-9]{4,5})/);
        const id = idMatch ? idMatch[1] : hashId(item.link);
        if (seen.has(id)) continue;

        const abstract = item.description
          .replace(/^arXiv:[\s\S]*?Abstract:\s*/, '')
          .replace(/^arXiv:[\s\S]*?Announce Type:[^\n]*\n?/, '')
          .trim();

        bucket.push({
          kind: 'paper',
          id,
          source: feed.name,
          category: feed.id,
          title: item.title,
          abstract: truncate(abstract || item.description, cfg.abstractChars),
          url: item.link || 'https://arxiv.org/abs/' + id,
        });
        if (bucket.length >= perFeedCap) break;
      }
      buckets.push(bucket);
    } catch (err) {
      errors.push(err.message);
      buckets.push([]);
    }
  }

  return { items: roundRobin(buckets, cfg.maxCandidates), errors };
}

// ============================================================
//  科技新闻（IEEE Spectrum / ROS / 量子位 / IT之家）
// ============================================================
export async function collectTechNews(state) {
  const cfg = config.sources.techNews;
  const seen = new Set(state.seenNewsIds || []);
  const errors = [];
  const buckets = [];

  for (const feed of cfg.feeds) {
    try {
      const xml = await fetchText(feed.url, { timeoutMs: 25000, label: 'news ' + feed.id });
      const bucket = [];
      for (const item of parseFeed(xml)) {
        if (!item.title || !item.link) continue;
        const id = hashId(item.link);
        if (seen.has(id)) continue;
        const f = isFresh(item, cfg.maxAgeDays || 14);
        if (!f.fresh) continue;
        bucket.push({
          kind: 'news',
          id,
          source: feed.name,
          feedId: feed.id,
          title: item.title,
          summary: truncate(item.description, 400),
          url: item.link,
        });
        if (bucket.length >= cfg.maxPerFeed) break;
      }
      buckets.push(bucket);
    } catch (err) {
      errors.push(err.message);
      buckets.push([]);
    }
  }

  return { items: roundRobin(buckets, cfg.maxPerFeed * cfg.feeds.length), errors };
}

// ============================================================
//  时政新闻（国内 + 国际）
//  和「央视新闻」分开：央视偏国内官方口径，这里补国际视角。
// ============================================================
export async function collectPolitics(state) {
  const cfg = config.sources.politics;
  if (!cfg || !cfg.feeds) return { items: [], errors: [] };

  const seen = new Set(state.seenNewsIds || []);
  const errors = [];
  const buckets = [];

  const maxAgeDays = cfg.maxAgeDays || 7;
  let stale = 0;

  for (const feed of cfg.feeds) {
    try {
      const xml = await fetchText(feed.url, { timeoutMs: 25000, label: '时政 ' + feed.id });
      const bucket = [];
      for (const item of parseFeed(xml)) {
        if (!item.title || !item.link) continue;
        const id = hashId('politics:' + item.link);
        if (seen.has(id)) continue;
        // 停更的源会一直返回几年前的内容，必须挡掉
        const f = isFresh(item, maxAgeDays);
        if (!f.fresh) { stale++; continue; }
        bucket.push({
          kind: 'politics',
          id,
          source: feed.name,
          feedId: feed.id,
          title: item.title,
          summary: truncate(item.description, 400),
          time: item.pubDate || '',
          url: item.link,
        });
        if (bucket.length >= cfg.maxPerFeed) break;
      }
      buckets.push(bucket);
    } catch (err) {
      errors.push('时政/' + feed.id + ': ' + err.message);
      buckets.push([]);
    }
  }

  if (stale) console.warn('[collect] 时政：丢弃 ' + stale + ' 条超过 ' + maxAgeDays + ' 天的旧闻（源可能已停更）');
  return { items: roundRobin(buckets, cfg.maxPerFeed * cfg.feeds.length), errors };
}

// ============================================================
//  央视新闻（JSONP 接口）
// ============================================================
export async function collectCctv(state) {
  const cfg = config.sources.cnNews;
  const seen = new Set(state.seenNewsIds || []);
  const errors = [];
  const items = [];

  try {
    const text = await fetchText(cfg.cctvApi, {
      timeoutMs: 25000,
      label: '央视新闻',
      headers: { Referer: 'https://news.cctv.com/' },
    });
    const start = text.indexOf('(');
    const end = text.lastIndexOf(')');
    const payload = JSON.parse(start >= 0 && end > start ? text.slice(start + 1, end) : text);
    const list = (payload && payload.data && payload.data.list) || [];

    for (const entry of list) {
      const title = String(entry.title || '').trim();
      if (!title) continue;
      const id = hashId('cctv:' + (entry.url || title));
      if (seen.has(id)) continue;
      const focus = String(entry.focus_date || '').trim();
      if (focus && !isFresh({ pubDate: focus }, cfg.maxAgeDays || 7).fresh) continue;
      items.push({
        kind: 'cnnews',
        id,
        source: '央视新闻',
        title,
        summary: truncate(String(entry.brief || '').trim(), 300),
        time: String(entry.focus_date || '').slice(0, 16),
        url: entry.url || '',
      });
      if (items.length >= cfg.maxCctv) break;
    }
  } catch (err) {
    errors.push('央视新闻: ' + err.message);
  }

  // 央视接口从境外网络偶尔不通，抓到的太少就用中国新闻网兜底
  if (items.length < 3 && cfg.cnFallbackRss) {
    try {
      const xml = await fetchText(cfg.cnFallbackRss, { timeoutMs: 25000, label: '中国新闻网' });
      for (const entry of parseFeed(xml)) {
        if (!entry.title || !entry.link) continue;
        const id = hashId('cnnews:' + entry.link);
        if (seen.has(id)) continue;
        items.push({
          kind: 'cnnews',
          id,
          source: cfg.cnFallbackSourceName || '中国新闻网',
          title: entry.title,
          summary: truncate(entry.description, 300),
          time: entry.pubDate || '',
          url: entry.link,
        });
        if (items.length >= cfg.maxCctv) break;
      }
      if (items.length) console.log('[collect] 央视接口不可用，已用中国新闻网兜底 ' + items.length + ' 条');
    } catch (err) {
      errors.push('中国新闻网: ' + err.message);
    }
  }

  return { items, errors };
}

// ============================================================
//  新闻联播（前一天的文字稿）
// ============================================================
export async function collectXwlb(timeZone) {
  const cfg = config.sources.cnNews;
  const errors = [];
  // 源站通常比播出晚一天左右，所以往前找 1~3 天，取最近一期能拿到的
  for (const offset of [-1, -2, -3]) {
    const { iso, compact } = dateInZone(timeZone, offset);
    const url = cfg.xwlbRawTemplate.replace('{date}', compact);
    try {
      const md = await fetchText(url, { timeoutMs: 25000, label: '新闻联播 ' + compact, retries: 0 });
      const body = md
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/\*\*/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (body.length < 200) continue;
      return { text: truncate(body, cfg.maxXwlbChars), url: cfg.xwlbPageUrl, date: iso, errors };
    } catch {
      // 源头本身有延迟，前一两期抓不到是正常的，静默换更早的日期
    }
  }
  errors.push('新闻联播：最近三天都没抓到文字稿，本期跳过');
  return { text: '', url: '', date: null, errors };
}

// ============================================================
//  汇总
// ============================================================
export async function collectAll({ state, mode, timeZone }) {
  const errors = [];
  const needNews = mode === 'morning';
  const needPapers = mode === 'morning';

  const emptyWeather = { location: '', timezone: '', current: null, days: [], errors: [] };

  const [arxiv, techNews, cctv, politics, weather] = await Promise.all([
    needPapers ? collectArxiv(state).catch((err) => ({ items: [], errors: [err.message] })) : { items: [], errors: [] },
    needNews ? collectTechNews(state).catch((err) => ({ items: [], errors: [err.message] })) : { items: [], errors: [] },
    needNews ? collectCctv(state).catch((err) => ({ items: [], errors: [err.message] })) : { items: [], errors: [] },
    needNews ? collectPolitics(state).catch((err) => ({ items: [], errors: [err.message] })) : { items: [], errors: [] },
    collectWeather().catch((err) => ({ ...emptyWeather, errors: ['天气：' + err.message] })),
  ]);

  let xwlb = { text: '', url: '', date: null, errors: [] };
  if (needNews) xwlb = await collectXwlb(timeZone);

  errors.push(...arxiv.errors, ...techNews.errors, ...cctv.errors, ...politics.errors, ...xwlb.errors, ...weather.errors);

  return {
    papers: arxiv.items,
    techNews: techNews.items,
    cnNews: cctv.items,
    politics: politics.items,
    xwlb: xwlb.text,
    xwlbUrl: xwlb.url,
    xwlbDate: xwlb.date,
    weather,
    errors,
  };
}
