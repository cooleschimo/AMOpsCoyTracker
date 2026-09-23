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
 *                         marked down in source health
 */

import { disambiguatedQuery, type CompanyContext } from './ambiguous';
import { SEARCHABLE_SUBSECTORS } from './subsectors';

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

/**
 * Google News RSS per company. Brief §5.5 gives this exact format.
 *
 * The query is the name in quotes, except where the name is also an ordinary
 * word: `"AIR"` returns weather forecasts, `"Temple"` returns Hindu temples.
 * lib/ambiguous.ts narrows those with the company's own sector and domain, so
 * the wrong items are never fetched rather than filtered out afterwards.
 *
 * Takes the whole company rather than its name so the caller cannot forget to
 * pass the context the narrowing needs.
 */
export function googleNewsUrl(company: string | CompanyContext): string {
  const c: CompanyContext = typeof company === 'string' ? { name: company } : company;
  const q = encodeURIComponent(disambiguatedQuery(c));
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
    // than left to fail quietly every run.
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
 * A page that asks the caller to be a browser.
 *
 * Cloudflare, Vercel and the rest answer a non-browser with an HTML challenge
 * and no consistent status: VentureBeat returns 429, techfundingnews 403, and
 * two others 200 with the challenge in the body. So the status cannot classify
 * it — a 429 reads as a rate limit and gets backed off and retried all night
 * against a guard that will never clear, and a 200 is parsed as a feed and
 * reported as a selector that stopped matching.
 *
 * Nothing here defeats the challenge; it names it, so a blocked source is
 * disabled deliberately rather than rediscovered every run.
 */
export function isBotChallenge(body: string): boolean {
  if (!body || body.length > 200_000) return false;
  if (/<(rss|feed|channel)[\s>]/i.test(body)) return false;     // a real feed
  return /Security Checkpoint|Just a moment\.\.\.|Enable JavaScript (?:and cookies )?to continue|cf-browser-verification|Attention Required!|Checking your browser before/i.test(body);
}

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

/**
 * Read vcnewsdaily's front page as though it were a feed.
 *
 * It publishes one story per fundraise — company, amount and round in the
 * headline — which is the same shape as Fundraise Insider and the grammar
 * lib/fundraise.ts parses without a model. There is simply no feed to read: it
 * declares none, and /feed, /rss, /rss.php, /rss.xml and /feed.xml all 404.
 *
 * The page is server-rendered despite the site using Vue, so the stories are in
 * the HTML that arrives. Each sits in an anchor wrapping an <h5>, with a posted
 * date and a lede paragraph beside it — enough to build a real item from.
 *
 * Anchored on that markup rather than on class names, which are Bootstrap
 * utilities here and would change with a restyle. A layout change still breaks
 * it, and the zero-items path is what makes that visible: ingest-context marks
 * a source that parses to nothing as a health event rather than skipping it.
 */
export function parseVcNewsDaily(html: string): FeedItem[] {
  const out: FeedItem[] = [];
  const seen = new Set<string>();

  // The tail stops at the end of the lede paragraph. Stopping at the next
  // anchor of any kind cut the snippet off, because the lede contains its own
  // "Read More" link back to the story; running to the next headline instead
  // swallowed the stories in between.
  const re = /<a\s+href="([^"]+)"[^>]*>\s*<h5[^>]*>([\s\S]*?)<\/h5>\s*<\/a>([\s\S]{0,700}?<\/p>)/gi;
  for (const m of html.matchAll(re)) {
    const link = m[1];
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!title || !link || seen.has(link)) continue;
    // Only story pages. The same markup carries navigation and company links.
    if (!/\/venture-capital-funding\//i.test(link)) continue;
    seen.add(link);

    const tail = m[3];
    const dateRaw = tail.match(/class="[^"]*posted-date[^"]*"[^>]*>([^<]+)</i)?.[1]?.trim() ?? null;
    let publishedAt: Date | null = null;
    if (dateRaw) {
      const d = new Date(dateRaw);
      if (!Number.isNaN(d.getTime())) publishedAt = d;
    }
    const snippet = tail.match(/class="[^"]*article-paragraph[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? null;

    out.push({
      title,
      link,
      publishedAt,
      source: 'VC News Daily',
      snippet: snippet ? decodeEntities(snippet.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : null,
    });
  }
  return out;
}

/** Fetch a page-based source, in the shape fetchFeed returns. */
export async function fetchScraped(
  url: string, how: 'vcnewsdaily',
): Promise<{ items: FeedItem[]; error: string | null; reached?: boolean; blocked?: boolean }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    const body = await res.text().catch(() => '');
    if (isBotChallenge(body)) {
      return { items: [], error: `bot challenge (HTTP ${res.status}); JavaScript required`, reached: true, blocked: true };
    }
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` };
    const items = how === 'vcnewsdaily' ? parseVcNewsDaily(body) : [];
    // `reached`: the page answered, so a zero parse is a selector problem.
    return { items, error: items.length ? null : 'page parsed to zero items', reached: true };
  } catch (e) {
    return { items: [], error: (e as Error).message };
  }
}

export async function fetchFeed(url: string): Promise<{ items: FeedItem[]; error: string | null; reached?: boolean; blocked?: boolean }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    // The body decides, not the status: a challenge arrives as 429, 403 and
    // 200 depending on the vendor, so reading it is the only way to tell a
    // bot guard from a rate limit or a working feed.
    const body = await res.text().catch(() => '');
    const challenge = isBotChallenge(body);
    if (challenge) {
      return { items: [], error: `bot challenge (HTTP ${res.status}); JavaScript required`, reached: true, blocked: true };
    }
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` };
    const xml = body;
    const items = parseFeed(xml);
    /*
     * An empty parse is a source-health event rather than a silent skip — but
     * it is not the same event as a feed that could not be reached. The host
     * answered; the shape it answered with is what produced nothing, and the
     * fix is a selector rather than a URL. Reported as `reached` so a caller
     * can tell them apart without matching on this sentence: two sector feeds
     * sat at `down` for weeks reading as outages when they were parse misses.
     */
    return { items, error: items.length ? null : 'feed parsed to zero items', reached: true };
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
  /**
   * Read the page itself rather than a feed. Some publications that are dense
   * with fundraises serve no RSS at all — vcnewsdaily declares none and 404s on
   * every conventional path — but render every story into the HTML, which is
   * the same content by a different route.
   */
  scrape?: 'vcnewsdaily';
  note?: string;
};

/*
 * Sector movement is generated from the taxonomy rather than listed here: one
 * query per subsector that actually sites things, built from that subsector's
 * own search terms. See SEARCHABLE_SUBSECTORS.
 */
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
  ...SEARCHABLE_SUBSECTORS.map((sub) => ({
    id: `sector_${sub.id}`,
    name: `${sub.short} — sector movement`,
    /*
     * The query is the subsector's own search terms, OR-ed. They live on the
     * taxonomy in lib/subsectors.ts rather than here, so adding a subsector
     * brings its sector query with it and the words a headline uses sit beside
     * the definition of what the subsector is.
     */
    url: googleNewsTopicUrl(sub.searchTerms!.join(' OR ')),
    kind: 'sector' as const,
    /*
     * Tagged with the subsector and its family, so a company only sees movement
     * in its own field: score-companies matches this against the company's own
     * tags. A fab announcement is context for a chip company and noise for a
     * legal-AI one.
     */
    sectors: [sub.id, sub.broad],
    enabled: true,
  })),

  /**
   * Competing investment promotion agencies. One agency per query: stacking
   * five with OR returned nothing but Malaysia, the same degradation the
   * Singapore agency queries showed before they were split.
   *
   * A company these agencies win is a company that chose somewhere else, which
   * is the point of watching them.
   */
  {
    id: 'ipa_mida',
    name: 'MIDA Malaysia',
    url: googleNewsTopicUrl('"MIDA" Malaysia investment'),
    kind: 'competitor_ipa',
    sectors: [],
    enabled: true,
  },
  {
    id: 'ipa_ida_ireland',
    name: 'IDA Ireland',
    url: googleNewsTopicUrl('"IDA Ireland" investment'),
    kind: 'competitor_ipa',
    sectors: [],
    enabled: true,
  },
  {
    id: 'ipa_invest_india',
    name: 'Invest India',
    url: googleNewsTopicUrl('"Invest India" investment'),
    kind: 'competitor_ipa',
    sectors: [],
    enabled: true,
  },
  {
    id: 'ipa_gulf',
    name: 'Gulf states — semiconductor and data centre investment',
    url: googleNewsTopicUrl('Saudi Arabia ("semiconductor" OR "data centre") investment'),
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
  /**
   * Feeds carried for discovery rather than context.
   *
   * The mastheads above say what is happening in a sector; these name the
   * companies it is happening to, which is what step 16 mines. A funding
   * publication reports a Series A that no general outlet covers, and a sector
   * title covers the companies in that sector before anyone else does.
   *
   * Every URL below was fetched and returned same-day items on 2026-08-31.
   * Several obvious candidates are absent because they refuse server requests:
   * DealStreetAsia (503), e27 and Tech Wire Asia (403), Axios Pro Rata and
   * Fortune Term Sheet (404 on every documented path).
   */
  /**
   * General tech press. Thin for discovery — The Register returned 0 fundraises
   * in 50 items where Semiconductor Digest returns several in 30 — but a
   * business-desk story sometimes carries a siting or partnership event the
   * trade titles miss, and polling costs nothing.
   *
   * Which of the aggregator's outlets are worth carrying was decided by asking
   * the model, per outlet, how many of its headlines name a company doing
   * something. That is the criterion — company activity of any kind, not
   * fundraises — and it separates them sharply:
   *
   *   Techmeme                  5 of 15   Anthropic's $35bn Nvidia deal, Clay
   *                                       raising at $7bn, Reframe's $40M
   *                                       Series A, Hyperliquid entering the US
   *   these trade feeds        10 of 25   Sword Health buying Headspace, Diodes
   *                                       completing a semiconductor acquisition
   *   Ars Technica              6 of 20   mostly litigation and platform news
   *   The Verge                 1 of 10   a projector review
   *   Hacker News, 150+ points  1 of 20   a graphics-card vendor page
   *
   * So Techmeme is carried and the consumer titles are not. Techmeme is an
   * editor-curated business wire in feed form, where The Verge, Engadget, CNET,
   * TechRadar and Android Authority cover products and deals — real journalism,
   * but about things rather than companies, and a headline about a discounted
   * monitor names no one to approach.
   *
   * Scraping brutalist.report itself was considered and rejected on the same
   * measurement rather than on difficulty: plain curl returns the whole page,
   * no headless browser needed, but it interleaves Techmeme with Hackaday and
   * CNET deals, so taking the aggregate means paying to read ~340 headlines to
   * reach the ~15 that Techmeme's own feed gives directly.
   */
  /**
   * TechCrunch by category.
   *
   * The densest source measured: 13 of 25 of its headlines name a company doing
   * something, against 10 of 25 for the sector trade press and 5 of 15 for
   * Techmeme. It is also the one that names companies nobody has heard of —
   * Inherent, Clipto, Hoomanely, Liux — where the trade press writes about
   * firms already established in their sector.
   *
   * The category feeds are carried alongside the main one because each returns
   * ~20 items of its own: the main feed is what the editors led with, and a
   * category is everything in that beat. Climate returned 9 of 20 (Pacific
   * Fusion, Apollo Atomics, Anthro Energy) and hardware 8 of 18, which is a
   * better ratio than the general feed.
   */
  {
    id: 'techcrunch_venture',
    name: 'TechCrunch — Venture',
    url: 'https://techcrunch.com/category/venture/feed/',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  /*
   * Every headline is a fundraise, stated in the title with the amount and
   * usually the round: "Gimlet Labs Raises $300M Series B at $3B Valuation".
   * That is the grammar lib/fundraise.ts parses without a model, so this feed
   * reaches discovery at the cheapest point in the cascade — 10 of 10 headlines
   * name a company doing something, against 10 of 25 for the sector trade press.
   *
   * The feed is shallow: ten items, and it can sit a couple of days without
   * moving. A daily pull is what makes that acceptable, and the staleness check
   * in ingest-context says so if the site goes quiet for good.
   */
  /*
   * One story per fundraise, company and amount in the headline, with the lede
   * naming the city — 30 on the front page against Fundraise Insider's 10.
   * Scraped rather than pulled: it declares no feed and 404s on every
   * conventional path, but renders every story into the HTML it serves.
   */
  {
    id: 'vcnewsdaily',
    name: 'VC News Daily',
    url: 'https://vcnewsdaily.com/',
    kind: 'trade',
    sectors: [],
    scrape: 'vcnewsdaily',
    enabled: true,
  },
  {
    id: 'fundraise_insider',
    name: 'Fundraise Insider',
    url: 'https://fundraiseinsider.com/feed',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'techcrunch_fundraising',
    name: 'TechCrunch — Fundraising',
    url: 'https://techcrunch.com/category/fundraising/feed/',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'techcrunch_robotics',
    name: 'TechCrunch — Robotics',
    url: 'https://techcrunch.com/category/robotics/feed/',
    kind: 'trade',
    sectors: ['robotics', 'industrial'],
    enabled: true,
  },
  {
    id: 'techcrunch_hardware',
    name: 'TechCrunch — Hardware',
    url: 'https://techcrunch.com/category/hardware/feed/',
    kind: 'trade',
    sectors: ['semiconductors', 'compute'],
    enabled: true,
  },
  {
    id: 'techcrunch_climate',
    name: 'TechCrunch — Climate',
    url: 'https://techcrunch.com/category/climate/feed/',
    kind: 'trade',
    sectors: ['materials_energy', 'industrial'],
    enabled: true,
  },
  {
    id: 'techcrunch_space',
    name: 'TechCrunch — Space',
    url: 'https://techcrunch.com/category/space/feed/',
    kind: 'trade',
    sectors: ['space', 'aerospace'],
    enabled: true,
  },
  {
    id: 'techcrunch_transportation',
    name: 'TechCrunch — Transportation',
    url: 'https://techcrunch.com/category/transportation/feed/',
    kind: 'trade',
    sectors: ['robotics', 'industrial'],
    enabled: true,
  },
  {
    id: 'techcrunch_enterprise',
    name: 'TechCrunch — Enterprise',
    url: 'https://techcrunch.com/category/enterprise/feed/',
    kind: 'trade',
    sectors: ['ai_software', 'software_platforms'],
    enabled: true,
  },
  {
    id: 'techcrunch_security',
    name: 'TechCrunch — Security',
    url: 'https://techcrunch.com/category/security/feed/',
    kind: 'trade',
    sectors: ['cybersecurity'],
    enabled: true,
  },
  /**
   * Tech business desks.
   *
   * Business Insider's markets feed is the densest of these at 7 of 10 — it
   * carries company press releases, which is why: Lunar Cyber, Bloom Healthcare
   * and AEVEX all arrived from it. CNBC's technology desk runs 5 of 20.
   *
   * Absent, having been tried: The Information (403, paywalled), Reuters (no
   * working feed on any documented path, and a Google News site: query returned
   * nothing), Wired business (2 of 20, and its own feed yields one item),
   * CNBC's general business desk (1 of 20, mostly consumer brands), CNN
   * Business (4 of 20, and those were Toys 'R' Us and Tinder), r/technews (1 of
   * 20). r/TechTrendSignals rate-limits anonymous requests outright.
   */
  {
    id: 'businessinsider_markets',
    name: 'Business Insider — Markets',
    url: 'https://markets.businessinsider.com/rss/news',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'cnbc_tech',
    name: 'CNBC — Technology',
    url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  /**
   * US site selection and economic development.
   *
   * The densest sources measured anywhere: Area Development returned 20 of 20
   * headlines naming a company, because that is what it publishes — one entry
   * per facility announcement, with the company, the town and the activity.
   * "ProVia Plans Tuscarawas County, Ohio, Manufacturing Operations" is a
   * siting decision in a headline, which is the expansion axis's whole subject.
   *
   * They also correct a skew. World news is mostly not American, so the trade
   * and regional feeds were surfacing Japanese, Chinese and European companies
   * faster than US ones; these are US by construction.
   *
   * Site Selection magazine is absent despite the name — it publishes analysis
   * ("The 2026 Global Groundwork Index") rather than announcements, and scored
   * 0 of 10.
   */
  /**
   * More US-weighted sources, added to correct a skew rather than to widen
   * coverage. The Asian and European feeds carry real signal but they carry a
   * great deal of it — International ran to 21 of 40 companies in a week — and
   * world news is mostly not American. These are US by construction.
   *
   * Judged on their headlines rather than a sample of one: Defense Daily names
   * a company in nearly every line ("American Rheinmetall, GD Deliver Initial
   * XM30 Prototypes"), and Solar Power World and EE Journal do the same for
   * their sectors. Two obvious candidates were tried and left out — Global
   * Trade Magazine and Site Selection's Insider both publish policy analysis
   * with no company in the headline.
   */
  {
    id: 'defense_daily',
    name: 'Defense Daily',
    url: 'https://www.defensedaily.com/feed/',
    kind: 'trade',
    sectors: ['defence_systems', 'defence'],
    enabled: true,
  },
  {
    id: 'geekwire',
    name: 'GeekWire',
    url: 'https://www.geekwire.com/feed/',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'solar_power_world',
    name: 'Solar Power World',
    url: 'https://www.solarpowerworldonline.com/feed/',
    kind: 'trade',
    sectors: ['materials_energy'],
    enabled: true,
  },
  {
    id: 'ee_journal',
    name: 'EE Journal',
    url: 'https://www.eejournal.com/feed/',
    kind: 'trade',
    sectors: ['semiconductors', 'compute'],
    enabled: true,
  },
  {
    id: 'datacenter_knowledge',
    name: 'Datacenter Knowledge',
    url: 'https://www.datacenterknowledge.com/rss.xml',
    kind: 'trade',
    sectors: ['ai_infrastructure'],
    enabled: true,
  },
  {
    id: 'aviation_week',
    name: 'Aviation Week',
    url: 'https://aviationweek.com/rss.xml',
    kind: 'trade',
    sectors: ['aerospace', 'space'],
    enabled: true,
  },
  {
    id: 'area_development',
    name: 'Area Development',
    url: 'https://www.areadevelopment.com/rss/newsitems.xml',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'business_facilities',
    name: 'Business Facilities',
    url: 'https://businessfacilities.com/feed/',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'trade_industry_dev',
    name: 'Trade & Industry Development',
    url: 'https://www.tradeandindustrydev.com/rss.xml',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'crunchbase_news',
    name: 'Crunchbase News',
    url: 'https://news.crunchbase.com/feed/',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'techfundingnews',
    name: 'TechFundingNews',
    url: 'https://techfundingnews.com/feed/',
    kind: 'trade',
    sectors: [],
    // Cloudflare challenge since 2026-09-22: 403 with a JavaScript interstitial.
    enabled: false,
    note: 'Cloudflare bot challenge 2026-09-22',
  },
  {
    id: 'biopharma_dive',
    name: 'BioPharma Dive',
    url: 'https://www.biopharmadive.com/feeds/news/',
    kind: 'trade',
    sectors: ['therapeutics', 'health'],
    enabled: true,
  },
  {
    id: 'supplychain_dive',
    name: 'Supply Chain Dive',
    url: 'https://www.supplychaindive.com/feeds/news/',
    kind: 'trade',
    sectors: ['logistics_supply_chain', 'industrial'],
    enabled: true,
  },
  {
    id: 'utility_dive',
    name: 'Utility Dive',
    url: 'https://www.utilitydive.com/feeds/news/',
    kind: 'trade',
    sectors: ['materials_energy'],
    enabled: true,
  },
  {
    id: 'techmeme',
    name: 'Techmeme',
    url: 'https://www.techmeme.com/feed.xml',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'ars_technica',
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'wsj_tech',
    name: 'WSJ — Technology',
    url: 'https://feeds.a.dj.com/rss/RSSWSJD.xml',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'the_register',
    name: 'The Register',
    url: 'https://www.theregister.com/headlines.atom',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'siliconangle',
    name: 'SiliconANGLE',
    url: 'https://siliconangle.com/feed/',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'techcrunch_startups',
    name: 'TechCrunch — Startups',
    url: 'https://techcrunch.com/category/startups/feed/',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'venturebeat',
    name: 'VentureBeat',
    url: 'https://venturebeat.com/feed/',
    kind: 'trade',
    sectors: ['ai'],
    // Behind a Vercel bot challenge since 2026-09-02 — 429 with an HTML
    // "Security Checkpoint" page that needs JavaScript, on every User-Agent
    // tried. Nothing a fetcher can do clears it. Its coverage still arrives:
    // 89 of the 102 VentureBeat items held came through the per-company
    // Google News path rather than this feed.
    enabled: false,
    note: 'Vercel bot challenge 2026-09-02; coverage still arrives via Google News',
  },
  {
    id: 'tech_eu',
    name: 'Tech.eu',
    url: 'https://tech.eu/feed/',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'eu_startups',
    name: 'EU-Startups',
    url: 'https://www.eu-startups.com/feed/',
    kind: 'trade',
    sectors: [],
    enabled: true,
  },
  {
    id: 'spacenews',
    name: 'SpaceNews',
    url: 'https://spacenews.com/feed/',
    kind: 'trade',
    sectors: ['space', 'aerospace'],
    enabled: true,
  },
  {
    id: 'payload_space',
    name: 'Payload Space',
    url: 'https://payloadspace.com/feed/',
    kind: 'trade',
    sectors: ['space', 'aerospace'],
    enabled: true,
  },
  {
    id: 'quantum_insider',
    name: 'The Quantum Insider',
    url: 'https://thequantuminsider.com/feed/',
    kind: 'trade',
    sectors: ['quantum', 'compute'],
    enabled: true,
  },
  {
    id: 'canary_media',
    name: 'Canary Media',
    url: 'https://www.canarymedia.com/feed',
    kind: 'trade',
    sectors: ['materials_energy', 'industrial'],
    enabled: true,
  },
  {
    id: 'fierce_electronics',
    name: 'Fierce Electronics',
    url: 'https://www.fierceelectronics.com/rss/xml',
    kind: 'trade',
    sectors: ['semiconductors', 'compute'],
    enabled: true,
  },
  {
    id: 'medtech_dive',
    name: 'MedTech Dive',
    url: 'https://www.medtechdive.com/feeds/news/',
    kind: 'trade',
    sectors: ['medtech_devices', 'health'],
    enabled: true,
  },
  {
    id: 'stat_news',
    name: 'STAT News',
    url: 'https://www.statnews.com/feed/',
    kind: 'trade',
    sectors: ['therapeutics', 'health'],
    enabled: true,
  },
  {
    id: 'genengnews',
    name: 'Genetic Engineering News',
    url: 'https://www.genengnews.com/feed/',
    kind: 'trade',
    sectors: ['biotech_platforms', 'health'],
    enabled: true,
  },
  {
    id: 'defensescoop',
    name: 'DefenseScoop',
    url: 'https://defensescoop.com/feed/',
    kind: 'trade',
    sectors: ['defence_software', 'defence'],
    enabled: true,
  },
  {
    id: 'manufacturing_dive',
    name: 'Manufacturing Dive',
    url: 'https://www.manufacturingdive.com/feeds/news/',
    kind: 'trade',
    sectors: ['advanced_manufacturing', 'industrial'],
    enabled: true,
  },
  {
    id: 'ieee_spectrum',
    name: 'IEEE Spectrum',
    url: 'https://spectrum.ieee.org/feeds/feed.rss',
    kind: 'trade',
    sectors: [],
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
