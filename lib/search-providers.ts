/**
 * Pluggable web-search providers.
 *
 * WHY AN ABSTRACTION: free tiers vanish. Brave killed its 2,000/month free tier
 * in February 2026; Bing's Web Search API was retired entirely in August 2025;
 * Google's Custom Search JSON API closed to new customers in January 2026 and
 * shuts down January 2027. Tavily was acquired by Nebius in February 2026.
 * Swapping providers must be a config change, not a rewrite.
 *
 * SELECTION (researched 2026-08-24). Provider chosen by SEARCH_PROVIDER env,
 * defaulting to the keyless option so nothing blocks on a signup:
 *
 *   purili   no key, no card, 403M-page own index. Lower quality (4/9 hit rate
 *            in testing) and NO date filtering. Fine for website lookup.
 *   youcom   $100 one-time signup credit ~ 20k queries, no card. Best for the
 *            one-off backfill.
 *   linkup   $20/month RECURRING credit ~ 4k queries, no card. Best for the
 *            weekly news job; has fromDate/toDate.
 *   tavily   1,000/month, genuinely no card, best recency params, and
 *            include_raw_content returns full page text at no extra credits.
 *
 *   serper   Google SERP access. Highest recall by a wide margin (a 2026
 *            benchmark put Google at ~79% vs Brave ~35% on the same corpus),
 *            2,500 free queries one-time, then $1/1k — the cheapest paid tier
 *            here. Supports tbs=qdr:* recency.
 *
 * ON SERP RESELLERS, decided with the product owner 2026-08-24: Google sued
 * SerpApi (DMCA, Dec 2025; amended complaint 10 Aug 2026) and Reddit v.
 * Perplexity/SerpApi survived dismissal in July 2026. That is a dispute between
 * Google and the RESELLER, not with the reseller's customers — the realistic
 * downside here is that the service disappears, which is an availability risk
 * handled by this abstraction. This is a personal project on personal
 * infrastructure, not an EDB system; DESIGN_RATIONALE §14's constraint is that
 * EDB-INTERNAL DATA stays off personal infrastructure, which is unaffected.
 *
 * LinkedIn remains excluded in any form, and that is NOT the same judgement:
 * hiQ lost on breach of the user agreement, a direct claim against the scraper
 * itself rather than against an intermediary.
 *
 * DELIBERATELY EXCLUDED:
 *   - Self-hosted SearXNG: tested reports from July 2026 show it blocked within
 *     minutes from a residential IP (Google 0 results, Brave suspended,
 *     Startpage CAPTCHA). It degrades to a DuckDuckGo proxy, and making it work
 *     needs a residential proxy pool costing more than any API here.
 *   - Bing Web Search API: retired 11 Aug 2025, endpoints return 410.
 *   - Google Custom Search JSON: closed to new customers since Jan 2026.
 */
import { optional } from './env';

export type SearchHit = {
  title: string;
  url: string;
  displayUrl: string;
  description: string;
  host: string;
  /** Full page text, when the provider returns it (Tavily, You.com). */
  raw?: string | null;
  publishedAt?: string | null;
};

export type SearchOpts = {
  /** Restrict to recently published pages. Ignored by providers without it. */
  recencyDays?: number;
  maxResults?: number;
};

export type ProviderName = 'purili' | 'youcom' | 'linkup' | 'tavily' | 'serper';

/**
 * Hosts dropped from EVERY provider's results before they reach the pipeline.
 *
 * LinkedIn is excluded in any form by DESIGN_RATIONALE §14 — hiQ established
 * that public-data scraping is not a CFAA crime but hiQ LOST on breach of the
 * user agreement and shut down. That exclusion has to hold no matter which
 * provider surfaces the URL, and Serper and Linkup both returned a LinkedIn
 * page as the top hit for a company query in testing, so filtering at the
 * provider boundary is the only place it can be enforced once.
 */
const BLOCKED_HOSTS = /(^|\.)(linkedin\.com|lnkd\.in)$/i;

const hostOf = (u: string): string => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/**
 * HARD REQUEST CEILING. Brave and Exa both have documented runaway-billing
 * exposure, and a loop bug against a paid provider is expensive. This is a
 * process-lifetime cap, deliberately not configurable per call.
 */
const MAX_REQUESTS = Number(optional('SEARCH_MAX_REQUESTS', '3000'));
let requestCount = 0;
export const searchRequestsUsed = () => requestCount;

function budgetOk(): boolean {
  if (requestCount >= MAX_REQUESTS) {
    if (requestCount === MAX_REQUESTS) {
      console.error(`[search] HARD CEILING of ${MAX_REQUESTS} requests reached; refusing further calls`);
      requestCount++;
    }
    return false;
  }
  requestCount++;
  return true;
}

let lastCall = 0;
async function polite(gapMs: number) {
  const wait = gapMs - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

// ── Providers ───────────────────────────────────────────────────────────────

async function purili(q: string, o: SearchOpts): Promise<SearchHit[]> {
  await polite(700);
  const res = await fetch(`https://puri.li/api/search?q=${encodeURIComponent(q)}&page=1`, {
    headers: { 'User-Agent': 'AMOpsCoyTracker/1.0 (research)', Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`purili HTTP ${res.status}`);
  const j = await res.json();
  return (j?.results ?? []).slice(0, o.maxResults ?? 10).map((r: Record<string, string>) => ({
    title: r.title ?? '', url: r.url ?? '', displayUrl: r.displayUrl ?? '',
    description: r.description ?? '', host: hostOf(r.url ?? ''), raw: null, publishedAt: null,
  })).filter((h: SearchHit) => h.url);
}

async function tavily(q: string, o: SearchOpts): Promise<SearchHit[]> {
  const key = optional('TAVILY_API_KEY');
  if (!key) throw new Error('TAVILY_API_KEY not set');
  await polite(400);
  const body: Record<string, unknown> = {
    query: q,
    max_results: o.maxResults ?? 10,
    include_raw_content: true,     // free on Tavily; full page text
  };
  if (o.recencyDays) body.days = o.recencyDays;
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`tavily HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  return (j?.results ?? []).map((r: Record<string, string>) => ({
    title: r.title ?? '', url: r.url ?? '', displayUrl: hostOf(r.url ?? ''),
    description: r.content ?? '', host: hostOf(r.url ?? ''),
    raw: r.raw_content ?? null, publishedAt: r.published_date ?? null,
  })).filter((h: SearchHit) => h.url);
}

async function linkup(q: string, o: SearchOpts): Promise<SearchHit[]> {
  const key = optional('LINKUP_API_KEY');
  if (!key) throw new Error('LINKUP_API_KEY not set');
  await polite(400);
  const body: Record<string, unknown> = { q, depth: 'standard', outputType: 'searchResults' };
  if (o.recencyDays) {
    const from = new Date(Date.now() - o.recencyDays * 86400000);
    body.fromDate = from.toISOString().slice(0, 10);
  }
  const res = await fetch('https://api.linkup.so/v1/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`linkup HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  return (j?.results ?? []).slice(0, o.maxResults ?? 10).map((r: Record<string, string>) => ({
    title: r.name ?? r.title ?? '', url: r.url ?? '', displayUrl: hostOf(r.url ?? ''),
    description: r.content ?? r.snippet ?? '', host: hostOf(r.url ?? ''),
    raw: r.content ?? null, publishedAt: r.date ?? null,
  })).filter((h: SearchHit) => h.url);
}

async function youcom(q: string, o: SearchOpts): Promise<SearchHit[]> {
  const key = optional('YOUCOM_API_KEY');
  if (!key) throw new Error('YOUCOM_API_KEY not set');
  await polite(400);
  const params = new URLSearchParams({ query: q, num_web_results: String(o.maxResults ?? 10) });
  if (o.recencyDays) {
    const from = new Date(Date.now() - o.recencyDays * 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    params.set('freshness', `${from}to${to}`);
  }
  const res = await fetch(`https://api.ydc-index.io/v1/search?${params}`, {
    headers: { 'X-API-Key': key },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`youcom HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  const hits = j?.results?.web ?? j?.hits ?? [];
  return hits.map((r: Record<string, unknown>) => ({
    title: String(r.title ?? ''), url: String(r.url ?? ''), displayUrl: hostOf(String(r.url ?? '')),
    description: String(r.description ?? (Array.isArray(r.snippets) ? (r.snippets as string[]).join(' ') : '')),
    host: hostOf(String(r.url ?? '')),
    raw: null, publishedAt: (r.page_age as string) ?? null,
  })).filter((h: SearchHit) => h.url);
}

/**
 * Serper: Google SERP results as JSON. Highest recall of anything here.
 * `tbs=qdr:*` gives Google's own recency filter, which is stricter than most
 * index-based providers manage.
 */
async function serper(q: string, o: SearchOpts): Promise<SearchHit[]> {
  const key = optional('SERPER_API_KEY');
  if (!key) throw new Error('SERPER_API_KEY not set');
  await polite(300);
  const body: Record<string, unknown> = { q, num: o.maxResults ?? 10 };
  if (o.recencyDays) {
    body.tbs = o.recencyDays <= 1 ? 'qdr:d'
      : o.recencyDays <= 7 ? 'qdr:w'
      : o.recencyDays <= 31 ? 'qdr:m' : 'qdr:y';
  }
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`serper HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  return (j?.organic ?? []).map((r: Record<string, string>) => ({
    title: r.title ?? '', url: r.link ?? '', displayUrl: hostOf(r.link ?? ''),
    description: r.snippet ?? '', host: hostOf(r.link ?? ''),
    raw: null, publishedAt: r.date ?? null,
  })).filter((h: SearchHit) => h.url);
}

const PROVIDERS: Record<ProviderName, (q: string, o: SearchOpts) => Promise<SearchHit[]>> = {
  purili, tavily, linkup, youcom, serper,
};

/** Which provider is configured, and whether its key is present. */
export function activeProvider(): { name: ProviderName; ready: boolean; note: string } {
  const want = (optional('SEARCH_PROVIDER', 'purili') as ProviderName);
  const name = PROVIDERS[want] ? want : 'purili';
  const keyFor: Record<ProviderName, string> = {
    purili: '', tavily: 'TAVILY_API_KEY', linkup: 'LINKUP_API_KEY',
    youcom: 'YOUCOM_API_KEY', serper: 'SERPER_API_KEY',
  };
  const needed = keyFor[name];
  const ready = !needed || !!optional(needed);
  return {
    name, ready,
    note: ready ? `${name} ready` : `${name} selected but ${needed} is not set — falling back to purili`,
  };
}

/** Providers that have exhausted their quota this run — skipped thereafter. */
const exhausted = new Set<ProviderName>();

/** Quota/auth failures are permanent for the run; network errors are not. */
function isQuotaError(msg: string): boolean {
  return /HTTP (401|402|403|429)/.test(msg) || /quota|credit|limit|exceeded|insufficient/i.test(msg);
}

/**
 * The order providers are tried. SEARCH_PROVIDER goes first; the rest follow as
 * fallbacks, so exhausting one quota moves to the next automatically instead of
 * stopping the run.
 *
 * This is the honest way to stack free tiers: four DIFFERENT services, each used
 * within its own terms. Registering multiple accounts on ONE service to multiply
 * its free tier is what those terms prohibit, and it risks losing every key at
 * once — a worse failure than a quota, and one that would land mid-run.
 */
function providerChain(): ProviderName[] {
  const { name, ready } = activeProvider();
  const preferred: ProviderName[] = ready ? [name] : [];
  const rest: ProviderName[] = (['serper', 'youcom', 'linkup', 'tavily', 'purili'] as ProviderName[])
    .filter((p) => !preferred.includes(p));
  return [...preferred, ...rest].filter((p) => {
    if (exhausted.has(p)) return false;
    if (p === 'purili') return true;                       // never needs a key
    const keyName = { serper: 'SERPER_API_KEY', youcom: 'YOUCOM_API_KEY',
                      linkup: 'LINKUP_API_KEY', tavily: 'TAVILY_API_KEY' }[p as 'serper'];
    return !!optional(keyName);
  });
}

/**
 * Search the web. NEVER throws: returns [] on any failure, so a provider
 * outage degrades enrichment rather than breaking a pipeline run.
 *
 * Falls through the provider chain on quota exhaustion, so adding keys simply
 * extends how far the run gets.
 */
export async function search(query: string, opts: SearchOpts = {}): Promise<SearchHit[]> {
  for (const p of providerChain()) {
    if (!budgetOk()) return [];
    try {
      const raw = await PROVIDERS[p](query, opts);
      // Enforce the LinkedIn exclusion at the boundary, for every provider.
      const hits = raw.filter((h) => !BLOCKED_HOSTS.test(h.host));
      if (hits.length) return hits;
      // An empty result is a legitimate answer, not a failure — do not burn
      // another provider's quota re-asking the same question.
      return hits;
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (isQuotaError(msg)) {
        console.warn(`[search] ${p} exhausted or unauthorised (${msg.slice(0, 60)}); falling through`);
        exhausted.add(p);
      } else {
        console.warn(`[search] ${p} failed: ${msg.slice(0, 80)}`);
      }
    }
  }
  return [];
}

/** Which providers have quota left. Surfaced on /admin/sources. */
export function providerStatus(): Array<{ provider: ProviderName; usable: boolean; note: string }> {
  const chain = providerChain();
  return (['serper', 'youcom', 'linkup', 'tavily', 'purili'] as ProviderName[]).map((p) => ({
    provider: p,
    usable: chain.includes(p),
    note: exhausted.has(p) ? 'quota exhausted this run'
      : chain.includes(p) ? 'available'
      : p === 'purili' ? 'available' : 'no API key set',
  }));
}
