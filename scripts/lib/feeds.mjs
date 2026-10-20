// Lädt RSS-/Atom-Feeds und wandelt sie in ein einheitliches Artikel-Format um.
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

const USER_AGENT = 'Mozilla/5.0 (compatible; GuteNachrichtenBot/1.0; Uni-Projekt)';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  htmlEntities: true,
  processEntities: true,
  // Manche Feeds sind sehr groß (z. B. FOCUS mit 400 Einträgen)
  isArray: (name) => ['item', 'entry', 'enclosure', 'media:content', 'media:thumbnail', 'link'].includes(name),
});

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

const text = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return String(v['#text'] ?? '');
  return String(v);
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', euro: '€' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export function stripHtml(html) {
  let s = decodeEntities(String(html));
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s)
    // WordPress-Floskeln und „Weiterlesen“-Links entfernen
    .replace(/The post .{0,300}? appeared first on .{0,100}?\.\s*$/i, '')
    .replace(/Der Beitrag .{0,300}? erschien zuerst auf .{0,100}?\.\s*$/i, '')
    .replace(/\[?(Continue reading|Read more|Weiterlesen|mehr)\s*(\.\.\.|…)?\]?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

export function truncate(s, max = 280) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : max).replace(/[,;:.\s]+$/, '') + ' …';
}

export function normalizeLink(link) {
  try {
    const u = new URL(link.trim());
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|wt_|at_|ref$|cmp$|xtor$)/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return link.trim();
  }
}

export const articleId = (link) => createHash('sha1').update(normalizeLink(link)).digest('hex').slice(0, 16);

const looksLikeImage = (url, type) =>
  (type && type.startsWith('image/')) || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url || '');

function findImage(item, htmlFields) {
  for (const enc of asArray(item.enclosure)) {
    const url = enc['@_url'];
    if (url && looksLikeImage(url, enc['@_type'])) return url;
  }
  const media = [
    ...asArray(item['media:content']),
    ...asArray(item['media:group']).flatMap((g) => asArray(g['media:content'])),
  ].filter((m) => m['@_url'] && (m['@_medium'] === 'image' || looksLikeImage(m['@_url'], m['@_type']) || (!m['@_medium'] && !m['@_type'])));
  if (media.length) {
    media.sort((a, b) => (Number(b['@_width']) || 0) - (Number(a['@_width']) || 0));
    return media[0]['@_url'];
  }
  const thumb = [
    ...asArray(item['media:thumbnail']),
    ...asArray(item['media:group']).flatMap((g) => asArray(g['media:thumbnail'])),
  ].find((t) => t['@_url']);
  if (thumb) return thumb['@_url'];
  for (const html of htmlFields) {
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(decodeEntities(String(html || '')));
    if (m && !/(pixel|tracking|feeds\.feedburner|gravatar|emoji)/i.test(m[1])) return decodeEntities(m[1]);
  }
  return null;
}

function atomLink(entry) {
  const links = asArray(entry.link);
  const alt = links.find((l) => typeof l === 'object' && (!l['@_rel'] || l['@_rel'] === 'alternate'));
  if (alt) return alt['@_href'];
  return typeof links[0] === 'string' ? links[0] : links[0]?.['@_href'] ?? '';
}

function parseDate(...candidates) {
  for (const c of candidates) {
    const d = new Date(text(c));
    if (text(c) && !isNaN(d)) return d.toISOString();
  }
  return null;
}

function toArticle(source, { title, link, date, teaserHtml, image }) {
  title = stripHtml(title);
  link = (link || '').trim();
  if (!title || !link.startsWith('http')) return null;
  let teaser = stripHtml(teaserHtml || '');
  if (teaser === title || teaser === 'None') teaser = '';
  return {
    id: articleId(link),
    title,
    teaser: truncate(teaser),
    link,
    image: image ? decodeEntities(image).replace(/^\/\//, 'https://') : null,
    date,
    source: source.name,
    sourceId: source.id,
    region: source.region,
    lang: source.lang,
  };
}

export function parseFeed(xml, source) {
  const doc = parser.parse(xml);
  const out = [];
  if (doc.feed) {
    for (const e of asArray(doc.feed.entry)) {
      out.push(toArticle(source, {
        title: text(e.title),
        link: atomLink(e),
        date: parseDate(e.published, e.updated),
        teaserHtml: text(e.summary) || text(e.content),
        image: findImage(e, [text(e.content), text(e.summary)]),
      }));
    }
  } else {
    const channel = doc.rss?.channel ?? doc['rdf:RDF'] ?? {};
    const items = asArray(channel.item ?? doc['rdf:RDF']?.item);
    for (const i of items) {
      const link = typeof i.link?.[0] === 'object' ? i.link[0]['@_href'] ?? text(i.link[0]) : text(i.link);
      out.push(toArticle(source, {
        title: text(i.title),
        link: link || (i.guid?.['@_isPermaLink'] !== 'false' ? text(i.guid) : ''),
        date: parseDate(i.pubDate, i['dc:date'], i.published),
        teaserHtml: text(i.description) || text(i['content:encoded']),
        image: findImage(i, [text(i['content:encoded']), text(i.description)]),
      }));
    }
  }
  return out.filter(Boolean);
}

async function fetchText(url, timeoutMs) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Zeichensatz aus Header oder XML-Deklaration bestimmen (einige Feeds sind ISO-8859-1)
  const head = buf.subarray(0, 200).toString('latin1');
  const charset =
    /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '')?.[1] ||
    /encoding=["']([\w-]+)["']/i.exec(head)?.[1] ||
    'utf-8';
  try {
    return new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    return buf.toString('utf-8');
  }
}

export async function fetchSource(source, { timeoutMs = 20000, maxItems = 30 } = {}) {
  const xml = await fetchText(source.url, timeoutMs);
  const items = parseFeed(xml, source);
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return items.slice(0, maxItems);
}

// Führt async-Funktionen mit begrenzter Parallelität aus.
export async function mapLimit(list, limit, fn) {
  const results = new Array(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await fn(list[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Holt das Vorschaubild (og:image) einer Artikelseite, falls der Feed keines liefert.
export async function fetchOgImage(url, timeoutMs = 10000) {
  try {
    const html = await fetchText(url, timeoutMs);
    const head = html.slice(0, 200000);
    const m =
      /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)["']/i.exec(head) ||
      /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(head);
    if (!m) return null;
    return new URL(decodeEntities(m[1]), url).toString();
  } catch {
    return null;
  }
}
