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

/**
 * Decode HTML entities once.
 * `&amp;` is decoded LAST: doing it first would turn `&amp;lt;` into `&lt;` and
 * then into `<`, inventing markup that was never in the source.
 */
const decodeEntities = (t: string): string => t
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&mdash;|&ndash;/gi, '-')
  .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&');

/**
 * Extract the TEXT of an element.
 *
 * ORDER MATTERS. A feed carrying escaped HTML — `&lt;a href=...&gt;` — has its
 * markup restored if tags are stripped before entities are decoded, and Google
 * News does exactly that: every <description> is an escaped <ol> of related
 * articles nested inside CDATA.
 *
 * So: decode, strip, and REPEAT until the text stops changing, because one pass
 * unwraps only one level of escaping.
 */
const tagText = (xml: string, tag: string): string | null => {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return null;

  let t = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  for (let pass = 0; pass < 3; pass++) {
    const before = t;
    t = decodeEntities(t).replace(/<[^>]+>/g, ' ');
    if (t === before) break;
  }
  return t.replace(/\s+/g, ' ').trim() || null;
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


/**
 * Context sources: what is happening around a company rather than to it.
 *
 * A tariff change, an export-control rule, a Singapore budget commitment or a
 * sector-wide funding wave changes what EDB can offer and whether a company is
 * reachable at all, without ever naming the company. These land with no
 * company_id and a sector tag, and feed the company assessment as context.
 *
 * Singapore agencies publish no usable feed — EDB, MTI, A*STAR and IMDA all
 * serve JS-rendered pages with no RSS at any path tried — so agency news
 * arrives through Google News as reported, which is what an RD would see
 * anyway. The Federal Register is the authoritative primary source for export
 * controls and is used directly.
 */
export type ContextSource = {
  id: string;
  name: string;
  url: string;
  /** What kind of context, for the assessment prompt to weigh appropriately. */
  kind: 'sg_policy' | 'export_control' | 'sector' | 'competitor_ipa' | 'regional' | 'trade';
  /** Sectors this bears on. Empty means all four. */
  sectors: string[];
  enabled: boolean;
  note?: string;
};

export const CONTEXT_SOURCES: ContextSource[] = [
  {
    id: 'fedreg_bis',
    name: 'Federal Register — Bureau of Industry and Security',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=industry-and-security-bureau',
    kind: 'export_control',
    sectors: ['deeptech', 'defence_tech', 'ai'],
    enabled: true,
  },
  {
    id: 'fedreg_itar',
    name: 'Federal Register — State Department, ITAR',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=state-department&conditions%5Bterm%5D=ITAR',
    kind: 'export_control',
    sectors: ['defence_tech'],
    enabled: true,
  },
  /**
   * One agency per query. A single query stacking several OR terms returns
   * almost nothing recent — the compound form of these two was answering with
   * results months old while the same agencies had news that week — so each
   * agency is asked for separately and the results merge on the way in.
   */
  {
    id: 'sg_edb',
    name: 'Singapore EDB',
    url: googleNewsTopicUrl('"Economic Development Board" Singapore'),
    kind: 'sg_policy',
    sectors: [],
    enabled: true,
  },
  {
    id: 'sg_mti',
    name: 'Singapore MTI',
    url: googleNewsTopicUrl('"Ministry of Trade and Industry" Singapore'),
    kind: 'sg_policy',
    sectors: [],
    enabled: true,
  },
  {
    id: 'sg_astar',
    name: 'Singapore A*STAR',
    url: googleNewsTopicUrl('"A*STAR" Singapore research'),
    kind: 'sg_policy',
    sectors: [],
    enabled: true,
  },
  {
    id: 'sg_imda',
    name: 'Singapore IMDA',
    url: googleNewsTopicUrl('"IMDA" Singapore digital'),
    kind: 'sg_policy',
    sectors: [],
    enabled: true,
  },
  {
    id: 'sg_enterprise',
    name: 'Enterprise Singapore',
    url: googleNewsTopicUrl('"Enterprise Singapore"'),
    kind: 'sg_policy',
    sectors: [],
    enabled: true,
  },
  {
    id: 'sg_jtc',
    name: 'JTC Corporation — industrial land',
    url: googleNewsTopicUrl('"JTC Corporation" Singapore industrial'),
    kind: 'sg_policy',
    sectors: [],
    enabled: true,
  },
  {
    id: 'sg_datacentre',
    name: 'Singapore data centre capacity',
    url: googleNewsTopicUrl('Singapore data centre capacity'),
    kind: 'sg_policy',
    sectors: ['ai', 'deeptech'],
    enabled: true,
  },
  {
    id: 'sg_semiconductor',
    name: 'Singapore semiconductor investment',
    url: googleNewsTopicUrl('Singapore semiconductor investment'),
    kind: 'sg_policy',
    sectors: ['deeptech'],
    enabled: true,
  },
  {
    id: 'export_controls_news',
    name: 'Export controls and trade policy, as reported',
    url: googleNewsTopicUrl('("export controls" OR ITAR OR "entity list" OR tariff) AND (semiconductor OR defense OR "advanced manufacturing")'),
    kind: 'export_control',
    sectors: ['deeptech', 'defence_tech', 'ai'],
    enabled: true,
  },
  {
    id: 'sector_waves',
    name: 'Sector-wide movement',
    url: googleNewsTopicUrl('(semiconductor OR biotech OR robotics OR "AI infrastructure") AND ("record funding" OR "capacity expansion" OR consolidation OR "industry shift")'),
    kind: 'sector',
    sectors: [],
    enabled: true,
  },
  {
    id: 'competitor_ipa',
    name: 'Competing investment promotion agencies',
    url: googleNewsTopicUrl('("IDA Ireland" OR "Invest India" OR MIDA Malaysia OR "Abu Dhabi" OR "Saudi Arabia") AND (semiconductor OR biotech OR "data centre" OR "R&D centre") investment'),
    kind: 'competitor_ipa',
    sectors: [],
    enabled: true,
  },

  /**
   * Publications read in the region, taken from their own feeds rather than
   * through a Google News query. A search returns what matched the words; a
   * masthead's own feed returns what its editors led with, and an RD reads the
   * second. These carry the Singapore and ASEAN business news that a
   * company-name search never surfaces because the company is not named.
   *
   * Every URL below was fetched and returned same-day items on 2026-08-27.
   */
  {
    id: 'cna_business',
    name: 'CNA — Business',
    url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6936',
    kind: 'regional',
    sectors: [],
    enabled: true,
  },
  {
    id: 'straits_times_business',
    name: 'The Straits Times — Business',
    url: 'https://www.straitstimes.com/news/business/rss.xml',
    kind: 'regional',
    sectors: [],
    enabled: true,
  },
  {
    id: 'business_times_sg',
    name: 'The Business Times — Singapore',
    url: 'https://www.businesstimes.com.sg/rss/top-stories',
    kind: 'regional',
    sectors: [],
    enabled: true,
  },
  {
    id: 'tech_in_asia',
    name: 'Tech in Asia',
    url: 'https://www.techinasia.com/feed',
    kind: 'regional',
    sectors: ['ai', 'deeptech'],
    enabled: true,
  },
  {
    id: 'nikkei_asia',
    name: 'Nikkei Asia',
    url: 'https://asia.nikkei.com/rss/feed/nar',
    kind: 'regional',
    sectors: [],
    enabled: true,
  },
  {
    id: 'scmp_business',
    name: 'South China Morning Post — Business',
    url: 'https://www.scmp.com/rss/92/feed',
    kind: 'regional',
    sectors: [],
    enabled: true,
  },

  /**
   * Sector trade press. A siting decision, a fab announcement or a trial
   * readout appears here before it reaches general business news, and often
   * with the detail — capacity, location, timing — that the general story drops.
   */
  {
    id: 'ee_times',
    name: 'EE Times',
    url: 'https://www.eetimes.com/feed/',
    kind: 'trade',
    sectors: ['deeptech', 'ai'],
    enabled: true,
  },
  {
    id: 'semiconductor_digest',
    name: 'Semiconductor Digest',
    url: 'https://www.semiconductor-digest.com/feed/',
    kind: 'trade',
    sectors: ['deeptech'],
    enabled: true,
  },
  {
    id: 'endpoints_news',
    name: 'Endpoints News',
    url: 'https://endpts.com/feed/',
    kind: 'trade',
    sectors: ['biotech'],
    enabled: true,
  },
  {
    id: 'fierce_biotech',
    name: 'Fierce Biotech',
    url: 'https://www.fiercebiotech.com/rss/xml',
    kind: 'trade',
    sectors: ['biotech'],
    enabled: true,
  },
  {
    id: 'breaking_defense',
    name: 'Breaking Defense',
    url: 'https://breakingdefense.com/feed/',
    kind: 'trade',
    sectors: ['defence_tech'],
    enabled: true,
  },
  {
    id: 'defense_news',
    name: 'Defense News',
    url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml',
    kind: 'trade',
    sectors: ['defence_tech'],
    enabled: true,
  },
  {
    id: 'robot_report',
    name: 'The Robot Report',
    url: 'https://www.therobotreport.com/feed/',
    kind: 'trade',
    sectors: ['deeptech', 'ai'],
    enabled: true,
  },
  {
    id: 'techcrunch',
    name: 'TechCrunch',
    url: 'https://techcrunch.com/feed/',
    kind: 'trade',
    sectors: ['ai', 'deeptech'],
    enabled: true,
  },
];
