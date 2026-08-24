/**
 * Web search via Purili (https://puri.li/developer).
 *
 * It wins on access and on coverage of the long tail. There is no API key, no
 * credit card and no signup, where Brave's free tier now requires a card,
 * Tavily/Serper/Exa all require keys, and SerpAPI and DataForSEO are paid. Its
 * 403M-page index resolved the obscure private companies where domain
 * construction failed — rapidflare.ai, emberlifesciences.com, bidbus.com.
 * Google/Bing scraping and headless-browser SERP access stay excluded on ToS
 * grounds, consistent with the LinkedIn exclusion in DESIGN_RATIONALE §14.
 *
 * Measured limits:
 *  - The `site:` operator returns nothing, so this cannot verify a specific
 *    domain. Verification stays with lib/enrich.ts, which fetches the page.
 *  - `total` reports the same number (640) across unrelated queries, so it is
 *    not a result count.
 *  - It is an unversioned experimental preview by a single developer, so it is a
 *    convenience that improves coverage rather than something the pipeline's
 *    correctness rests on. Every call is wrapped so a failure degrades
 *    enrichment instead of breaking a run, and health is tracked so a quiet
 *    death shows up on /admin/sources.
 *
 * Finding a company website goes cheapest first:
 *   1. the fund's portfolio page, which usually links out  (free, no request)
 *   2. domain construction + verification (lib/enrich.ts)  (free, ~1 request)
 *   3. this                                                (1 request)
 */

const BASE = 'https://puri.li';
const UA = 'AMOpsCoyTracker/1.0 (research; contact via repo)';

export type SearchHit = { title: string; url: string; displayUrl: string; description: string; host: string };

let lastCall = 0;
const MIN_GAP_MS = 700;   // the docs ask for light use

async function polite() {
  const wait = MIN_GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/** Never throws. Returns [] on any failure. */
export async function webSearch(query: string, tries = 2): Promise<SearchHit[]> {
  for (let i = 0; i < tries; i++) {
    await polite();
    try {
      const url = `${BASE}/api/search?q=${encodeURIComponent(query)}&page=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (i + 1))); continue; }
        return [];
      }
      const j = await res.json();
      const rows = Array.isArray(j?.results) ? j.results : [];
      return rows.map((r: Record<string, string>) => {
        let host = '';
        try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
        return {
          title: r.title ?? '', url: r.url ?? '',
          displayUrl: r.displayUrl ?? '', description: r.description ?? '', host,
        };
      }).filter((h: SearchHit) => h.url);
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return [];
}

/** Hosts that are never a company's own site. */
const NON_COMPANY = /(wikipedia|linkedin|crunchbase|pitchbook|bloomberg|reuters|twitter|x\.com|facebook|instagram|youtube|medium|github|glassdoor|indeed|zoominfo|dnb\.com|owler|tracxn|golden\.com|f6s|angel\.co|wellfound|apollo\.io|rocketreach|signalhire|leadiq|pymnts|businessabc|soft112|vcnewsdaily)/i;

/**
 * Find a company's own website.
 *
 * Conservative by design (DESIGN_RATIONALE §8: prefer no website to a wrong
 * one). A hit only counts when the host itself resembles the company name, since
 * a page merely mentioning the company is not its website.
 */
export async function findCompanyWebsite(companyName: string): Promise<{ host: string; why: string } | null> {
  // Query with the bare name. Keyword search over a small index rewards fewer,
  // rarer terms: "Rapidflare, Inc. official site" returns internationalwatchman
  // .com and sierragamers.com, while plain "Rapidflare" returns rapidflare.ai
  // first.
  const bare = companyName
    .replace(/,?\s+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|pbc|plc|lp|llp)\.?$/i, '')
    .trim();
  const hits = await webSearch(bare);
  if (!hits.length) return null;

  const tokens = companyName.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !['inc', 'llc', 'ltd', 'corp', 'the', 'company', 'holdings', 'group', 'technologies', 'labs'].includes(w));
  if (!tokens.length) return null;

  const compact = tokens.join('');
  for (const h of hits) {
    if (!h.host || NON_COMPANY.test(h.host)) continue;
    const hostCompact = h.host.replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '');
    // The host must contain the compacted name, or the first two tokens.
    if (hostCompact.includes(compact)) return { host: h.host, why: `host matches full name (${h.host})` };
    if (tokens.length >= 2) {
      const two = tokens.slice(0, 2).join('');
      if (hostCompact.includes(two)) return { host: h.host, why: `host matches "${tokens.slice(0, 2).join(' ')}" (${h.host})` };
    }
    if (tokens.length === 1 && hostCompact === tokens[0]) return { host: h.host, why: `host equals name (${h.host})` };
  }
  return null;
}


// ── General-purpose company research ────────────────────────────────────────

export type CompanyResearch = {
  query: string;
  /** The company's own site, if a host matched the name. */
  website: { host: string; why: string } | null;
  /** Pages that mention the company: news, investor pages, directories. */
  mentions: SearchHit[];
  /** Hosts that look like investors (a fund's portfolio or "why we invested"). */
  investorHosts: SearchHit[];
  /** Concatenated descriptions, for feeding an LLM as context. */
  context: string;
  /** True when the results look unrelated — a generic name the index cannot resolve. */
  looksAmbiguous: boolean;
};

const INVESTOR_HINT = /(ventures?|capital|partners|fund|vc|invest)/i;
const NEWS_HINT = /(news|techcrunch|venturebeat|axios|forbes|businesswire|prnewswire|globenewswire|pymnts|crunchbase|fiercebiotech|endpts|statnews|defensenews|breakingdefense)/i;

/**
 * Broad research on a company: not just its website, but everything the index
 * knows that mentions it.
 *
 * The most valuable results are often somewhere other than the company's own
 * site. Searching "Rapidflare" surfaces upekkha.io and struckcapital.com ("Why
 * We Invested") — two investors absent from lib/funds.ts — plus a PYMNTS article
 * for Bidbus. Those feed the graph directly.
 *
 * Ambiguity is reported rather than hidden. A small index cannot disambiguate
 * common-word names: "Spectrum Effect" returns Caltech physics theses and After
 * Effects tutorials. When nothing references the company, looksAmbiguous is true
 * and the context is not about this company.
 */
export async function researchCompany(companyName: string): Promise<CompanyResearch> {
  const bare = companyName
    .replace(/,?\s+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|pbc|plc|lp|llp)\.?$/i, '')
    .trim();
  const hits = await webSearch(bare);

  const tokens = bare.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
  const compact = tokens.join('');

  // A hit is "on topic" when the page text or host actually names the company.
  const onTopic = hits.filter((h) => {
    const hay = `${h.title} ${h.description}`.toLowerCase();
    const hostCompact = h.host.replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '');
    return hay.includes(bare.toLowerCase()) || hostCompact.includes(compact);
  });

  const website = (() => {
    for (const h of hits) {
      if (!h.host || NON_COMPANY.test(h.host)) continue;
      const hostCompact = h.host.replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '');
      if (hostCompact.includes(compact)) return { host: h.host, why: `host matches full name (${h.host})` };
      if (tokens.length >= 2 && hostCompact.includes(tokens.slice(0, 2).join(''))) {
        return { host: h.host, why: `host matches "${tokens.slice(0, 2).join(' ')}" (${h.host})` };
      }
    }
    return null;
  })();

  const mentions = onTopic.filter((h) => h.host !== website?.host);
  const investorHosts = mentions.filter((h) =>
    INVESTOR_HINT.test(h.host) || /invest/i.test(h.title) || /portfolio/i.test(h.url));

  // A literal phrase match is not proof the page is about this company:
  // "Spectrum Effect" matches After Effects tutorials and stock-photo pages,
  // because the words appear verbatim. Corroboration is required — either a host
  // that resembles the name, or business language near the mention.
  const BUSINESS_HINT = /\b(compan(y|ies)|startup|founded|headquarter|raise[ds]?|funding|round|seed|series [a-h]|investor|customers?|platform|technolog|inc\.|corp\.|llc)\b/i;
  const corroborated = onTopic.filter((h) => {
    const hostCompact = h.host.replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '');
    return hostCompact.includes(compact) || BUSINESS_HINT.test(`${h.title} ${h.description}`);
  });

  return {
    query: bare,
    website,
    mentions,
    investorHosts,
    context: corroborated.map((h) => `${h.title} — ${h.description}`).join('\n').slice(0, 2000),
    // Ambiguous when nothing corroborates that these pages concern a company of
    // this name. An ambiguous context does not go to the assessment.
    looksAmbiguous: corroborated.length === 0,
  };
}
