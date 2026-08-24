/**
 * Domain blocklist and junk patterns for the filter cascade. Brief §7 stages 2-3.
 *
 * This is a config file — brief §12a names it as safe for a non-TypeScript
 * maintainer to edit freely. Add a domain here when it repeatedly produces
 * noise; nothing else needs to change.
 *
 * Blocked items get status 'dropped' and a dropped_reason and stay in the
 * table, since the dropped set is the training data (§15).
 */

/**
 * Domains that reliably produce content-farm or aggregator noise for these
 * queries. Kept deliberately short: over-blocking hides real coverage, and the
 * per-stage drop counts are how you notice.
 */
export const BLOCKED_DOMAINS: string[] = [
  // Stock-tip and retail-investor content farms — high volume on any company
  // name that trades, and never an FDI signal.
  'fool.com', 'motleyfool.com', 'zacks.com', 'investorplace.com',
  'benzinga.com', 'stocktwits.com', 'simplywall.st', 'marketbeat.com',
  'insidermonkey.com', 'gurufocus.com', 'tipranks.com', 'barchart.com',
  // Aggregators that republish without adding reporting.
  'finance.yahoo.com', 'msn.com', 'news.yahoo.com',
  // Press-release mirrors that duplicate the wire feeds we already ingest.
  'einpresswire.com', 'openpr.com', 'prlog.org', 'issuewire.com',
  'digitaljournal.com', 'menafn.com',
  // Job aggregators — we take postings from the ATS boards directly, and these
  // republish them with worse metadata.
  'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'simplyhired.com',
  'jobs.lever.co.cdn.ampproject.org',
];

/**
 * Listicle and non-event headline patterns. Brief §7 stage 3 gives the first
 * three; the rest are the same class of thing.
 *
 * These match a headline shape rather than a topic. "10 best AI startups" is
 * noise regardless of which companies it names — there is no decision window in
 * a ranking piece.
 */
export const JUNK_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /^\d+\s+(best|top|hottest|biggest|leading|promising)/i, reason: 'listicle' },
  { re: /\bstartups? to watch\b/i, reason: 'listicle' },
  { re: /\bstocks? to (buy|watch|sell)\b/i, reason: 'stock_tip' },
  { re: /\b(top|best)\s+\d+\b/i, reason: 'listicle' },
  { re: /\bshould you (buy|sell|invest)\b/i, reason: 'stock_tip' },
  { re: /\b(price (target|prediction)|share price|stock (forecast|price))\b/i, reason: 'stock_tip' },
  { re: /\b(here's why|here is why)\b.*\b(soar|plunge|jump|tumble|rally)/i, reason: 'stock_tip' },
  { re: /\bmarket (size|share|report|research|forecast)\b.*\b(20\d\d)\b/i, reason: 'market_report' },
  { re: /\bglobal .* market\b.*\b(cagr|forecast|analysis)\b/i, reason: 'market_report' },
  { re: /\bwhat (is|are)\b.*\?$/i, reason: 'explainer' },
  { re: /\b(quiz|crossword|horoscope|obituary)\b/i, reason: 'not_news' },
];

/**
 * Publisher names, matched against items.source.
 *
 * Google News RSS links are redirect wrappers on news.google.com, so the
 * publisher's domain never appears in the URL and domain blocking is a silent
 * no-op for news items: a run over 10,383 items dropped none at the domain
 * stage while MarketBeat, GuruFocus, TipRanks, Stocktwits and Seeking Alpha all
 * survived. The publisher name is available, though —
 * lib/news-ingest.ts:splitGoogleTitle parses it out of the
 * "Headline - Publication" suffix into items.source — so the blocklist matches
 * on the name as well. Keep both lists in sync when adding a source.
 */
export const BLOCKED_SOURCE_NAMES: RegExp[] = [
  /^motley fool$/i, /\bzacks\b/i, /\binvestorplace\b/i, /\bbenzinga\b/i,
  /\bstocktwits\b/i, /\bsimply wall st\b/i, /\bmarketbeat\b/i,
  /\binsider monkey\b/i, /\bgurufocus\b/i, /\btipranks\b/i, /\bbarchart\b/i,
  /\bseeking alpha\b/i, /\bmoomoo\b/i, /\bmarketscreener\b/i,
  /\bstock titan\b/i, /\binvesting\.com\b/i, /\bthe globe and mail\b/i,
  /\bmarket ?watch\b/i, /\bstreet insider\b/i, /\bstockstory\b/i,
  // Aggregators that republish without adding reporting.
  /^yahoo( finance| news)?$/i, /^msn$/i, /\bfinance\.yahoo\b/i, /\bbiggo\b/i,
  // Press-release mirrors duplicating the wire feeds we already ingest.
  /\beinpresswire\b/i, /\bopenpr\b/i, /\bissuewire\b/i, /\bdigital journal\b/i,
  /\bmenafn\b/i, /\bprlog\b/i,
];

export function blockedSourceName(source: string): string | null {
  const s = (source || '').trim();
  if (!s) return null;
  for (const re of BLOCKED_SOURCE_NAMES) if (re.test(s)) return s;
  return null;
}

export function blockedDomain(canonicalUrl: string): string | null {
  try {
    const host = new URL(canonicalUrl).hostname.toLowerCase().replace(/^www\./, '');
    for (const d of BLOCKED_DOMAINS) {
      if (host === d || host.endsWith(`.${d}`)) return d;
    }
    return null;
  } catch {
    return null;
  }
}

export function junkPattern(title: string): string | null {
  for (const { re, reason } of JUNK_PATTERNS) {
    if (re.test(title)) return reason;
  }
  return null;
}
