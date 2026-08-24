/**
 * News and signal sources. Brief §5.5.
 *
 * What each feed actually serves:
 *
 *   Google News RSS       100 items per company query, with pubDate + source
 *   Business Wire         served only from feed.businesswire.com;
 *                         www.businesswire.com/rss/... returns 403
 *   PR Newswire           20 items
 *   GlobeNewswire         connection failure on every URL tried — parked in
 *                         BLOCKERS.md, marked down in source health
 */

export type NewsSource = {
  id: string;
  name: string;
  /** 'company' feeds are templated per company; 'wire' feeds are fetched once. */
  kind: 'company' | 'wire';
  url: string;
  sourceType: 'news' | 'wire';
  enabled: boolean;
  note?: string;
};

/** Google News RSS per company. Brief §5.5 gives this exact format. */
export function googleNewsUrl(companyName: string): string {
  const q = encodeURIComponent(`"${companyName}"`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

export const WIRE_SOURCES: NewsSource[] = [
  {
    id: 'businesswire_hightech',
    name: 'Business Wire — High Tech',
    kind: 'wire',
    // The www host 403s; feed.businesswire.com serves the same feed.
    url: 'https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEFpQXA==',
    sourceType: 'wire',
    enabled: true,
  },
  {
    id: 'prnewswire_all',
    name: 'PR Newswire — news releases',
    kind: 'wire',
    url: 'https://www.prnewswire.com/rss/news-releases-list.rss',
    sourceType: 'wire',
    enabled: true,
  },
  {
    id: 'globenewswire_tech',
    name: 'GlobeNewswire — Technology',
    kind: 'wire',
    url: 'https://www.globenewswire.com/RssFeed/subjectcode/22-Technology/feedTitle/GlobeNewswire%20-%20Technology',
    sourceType: 'wire',
    // Connection failure on every URL variant tried, so this is disabled rather
    // than left to fail quietly every run. See BLOCKERS.md.
    enabled: false,
    note: 'connection failure 2026-08-24; needs a working feed URL',
  },
];

export type FeedItem = {
  title: string;
  link: string;
  publishedAt: Date | null;
  source: string | null;
  snippet: string | null;
};

const UA = 'Mozilla/5.0 (compatible; AMOpsCoyTracker/1.0; +research)';

const tagText = (xml: string, tag: string): string | null => {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return null;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
};

/** Parse an RSS or Atom feed. Never throws. */
export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = [
    ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  for (const b of blocks) {
    const title = tagText(b, 'title');
    let link = tagText(b, 'link');
    if (!link) link = b.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? null;
    if (!title || !link) continue;

    const dateRaw = tagText(b, 'pubDate') ?? tagText(b, 'published') ?? tagText(b, 'updated') ?? tagText(b, 'dc:date');
    let publishedAt: Date | null = null;
    if (dateRaw) {
      const d = new Date(dateRaw);
      if (!Number.isNaN(d.getTime())) publishedAt = d;
    }
    out.push({
      title, link,
      publishedAt,
      source: tagText(b, 'source'),
      snippet: tagText(b, 'description') ?? tagText(b, 'summary'),
    });
  }
  return out;
}

export async function fetchFeed(url: string): Promise<{ items: FeedItem[]; error: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` };
    const xml = await res.text();
    const items = parseFeed(xml);
    // An empty parse is a source-health event rather than a silent skip.
    return { items, error: items.length ? null : 'feed parsed to zero items' };
  } catch (e) {
    return { items: [], error: (e as Error).message };
  }
}

/**
 * Untargeted topic queries — the activity-driven discovery channel.
 *
 * Company-directed news is a *why now* trigger for companies already held, while
 * activity is the main route by which a new company should surface to EDB at
 * all. The fetch runs at step 8 so discovery is activity-driven and not purely
 * structural; name-extraction from the same news follows at step 16.
 *
 * Each query pairs an event verb with a sector term, using the quoted phrases
 * and boolean OR that Google News RSS supports. A sector term on its own returns
 * commentary; the event verb is what makes it a *moment*.
 *
 * They skew toward expansion and Asia-entry language, because that is the signal
 * the digest exists to catch (brief §7: score 3 is a decision window with a
 * plausible Singapore angle).
 */
export const TOPIC_QUERIES: Array<{ id: string; query: string; note: string }> = [
  // Funding moments — the discovery workhorse. Form D catches these only when
  // the issuer actually files, and §5.1 notes that net is incomplete.
  { id: 'topic_funding_deeptech', note: 'funding · deeptech',
    query: '("raises" OR "Series A" OR "Series B" OR "Series C") AND (semiconductor OR photonics OR robotics OR quantum OR "advanced materials")' },
  { id: 'topic_funding_biotech', note: 'funding · biotech',
    query: '("raises" OR "Series A" OR "Series B" OR "Series C") AND (biotech OR therapeutics OR diagnostics OR "medical device")' },
  { id: 'topic_funding_ai', note: 'funding · ai',
    query: '("raises" OR "Series A" OR "Series B") AND ("AI chip" OR "AI infrastructure" OR "machine learning" OR "artificial intelligence")' },
  { id: 'topic_funding_defence', note: 'funding · defence tech',
    query: '("raises" OR "Series A" OR "Series B") AND ("defense tech" OR "defence tech" OR "dual-use" OR aerospace)' },

  // Expansion moments — the highest-value class, and invisible to Form D.
  { id: 'topic_expansion_asia', note: 'Asia / APAC expansion',
    query: '("expands into Asia" OR "Asia-Pacific expansion" OR "APAC expansion" OR "opens Asia office" OR "regional headquarters")' },
  { id: 'topic_expansion_singapore', note: 'Singapore entry',
    query: '("opens Singapore" OR "Singapore office" OR "Singapore facility" OR "expands to Singapore" OR "Singapore subsidiary")' },
  { id: 'topic_facility', note: 'new facility / manufacturing',
    query: '("new facility" OR "manufacturing plant" OR "opens fab" OR "production facility") AND (semiconductor OR biotech OR robotics OR battery)' },
];

/** Google News RSS for a raw topic query (not a quoted company name). */
export function googleNewsTopicUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}
