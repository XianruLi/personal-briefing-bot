/**
 * 数据采集：arXiv 论文 / 科技新闻 / 央视新闻 / 新闻联播。
 * 每个源互相独立，单个失败不影响整体 —— 失败信息会收集到 errors 里。
 */
import { config } from './config.mjs';
import { parseFeed } from './feed.mjs';
import { fetchText, truncate, uniqueBy, dateInZone } from './util.mjs';

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
    errors.push(err.message);
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

  const [arxiv, techNews, cctv] = await Promise.all([
    collectArxiv(state).catch((err) => ({ items: [], errors: [err.message] })),
    needNews ? collectTechNews(state).catch((err) => ({ items: [], errors: [err.message] })) : { items: [], errors: [] },
    needNews ? collectCctv(state).catch((err) => ({ items: [], errors: [err.message] })) : { items: [], errors: [] },
  ]);

  let xwlb = { text: '', url: '', date: null, errors: [] };
  if (needNews) xwlb = await collectXwlb(timeZone);

  errors.push(...arxiv.errors, ...techNews.errors, ...cctv.errors, ...xwlb.errors);

  return {
    papers: arxiv.items,
    techNews: techNews.items,
    cnNews: cctv.items,
    xwlb: xwlb.text,
    xwlbUrl: xwlb.url,
    xwlbDate: xwlb.date,
    errors,
  };
}
