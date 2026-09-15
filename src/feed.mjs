/**
 * 零依赖 RSS 2.0 / Atom 解析器。
 * 只依赖正则，够用且不吃依赖；遇到畸形 feed 也不会抛异常。
 */
import { stripTags } from './util.mjs';

/** 还原 XML 实体与 CDATA。 */
export function decodeEntities(input) {
  return String(input == null ? '' : input)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

/** 取某个标签的文本内容（不匹配自闭合标签）。 */
function tagText(block, tag) {
  const m = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? decodeEntities(m[1]).trim() : '';
}

/** 取 Atom 风格的 <link href="..."/>。 */
function linkHref(block) {
  const m = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]).trim() : '';
}

/**
 * 解析 feed，返回 [{ title, link, description, pubDate, categories }]。
 */
export function parseFeed(xml) {
  const items = [];
  const re = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[0];
    const rawDesc = tagText(block, 'description') || tagText(block, 'summary') || tagText(block, 'content');
    const cats = [];
    const catRe = /<category\b[^>]*>([\s\S]*?)<\/category>/gi;
    let c;
    while ((c = catRe.exec(block)) !== null) {
      const v = decodeEntities(c[1]).trim();
      if (v) cats.push(v);
    }
    items.push({
      title: stripTags(tagText(block, 'title')),
      link: tagText(block, 'link') || linkHref(block),
      description: stripTags(rawDesc),
      rawDescription: rawDesc,
      pubDate: tagText(block, 'pubDate') || tagText(block, 'published') || tagText(block, 'updated'),
      categories: cats,
    });
  }
  return items;
}
