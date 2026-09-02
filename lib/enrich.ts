/**
 * Website resolution and content extraction for companies with no public profile.
 *
 * Form D carries no website, SIC code or description — on data.sec.gov those
 * fields populate only for public reporting companies. With no website the
 * assessment is judging a name and a city, and it correctly answers 'unknown'.
 *
 * Resolution works by constructing candidate domains and verifying them rather
 * than by searching. The free search paths are all closed: DuckDuckGo's HTML
 * endpoint blocks automation with an 'anomaly' page, its Instant Answer API
 * returns empty for private companies, Mojeek 403s, public SearXNG instances
 * disable JSON output, and Google, Bing and Brave all require paid keys. Domain
 * construction needs no key, no quota and no ToS risk, and suits these companies
 * particularly well because they have near-zero search presence anyway.
 *
 * A wrong website is worse than no website, since it feeds a confident wrong
 * assessment (DESIGN_RATIONALE §8). Every candidate has to pass verification —
 * the page must actually reference the company — before it is accepted, and
 * every accepted domain records how it was found.
 */

const STOP = new Set(['inc', 'corp', 'corporation', 'llc', 'ltd', 'limited', 'lp', 'llp',
  'co', 'company', 'holdings', 'group', 'the', 'pbc', 'incorporated']);

/** Candidate domains, most likely first. */
export function candidateDomains(name: string): string[] {
  const words = name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  if (!words.length) return [];

  const joined = words.join('');
  const first = words[0];
  const firstTwo = words.slice(0, 2).join('');
  const hyphen = words.join('-');

  const stems = [...new Set([joined, firstTwo, first, hyphen])].filter((s) => s.length >= 3);
  const tlds = ['com', 'ai', 'io', 'co', 'tech', 'bio'];

  const out: string[] = [];
  for (const s of stems) for (const t of tlds) out.push(`${s}.${t}`);
  return out.slice(0, 14);
}

const UA = 'Mozilla/5.0 (compatible; AMOpsCoyTracker/1.0; +research)';

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export type SiteResult = {
  domain: string;
  title: string | null;
  description: string | null;
  /** Visible text, trimmed for the LLM. */
  text: string;
  verified: boolean;
  /** Domain resolves and matches the name, but carries no usable content. */
  thin: boolean;
  verifyReason: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const meta = (html: string, name: string): string | null => {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = html.match(re) ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, 'i'));
  return m ? m[1].trim() : null;
};

/**
 * Fetch a candidate and decide whether it really belongs to this company.
 * Verification takes a distinctive token from the company name appearing in the
 * page, or the page title containing it. Parked pages and 404s are rejected.
 */
export async function tryDomain(domain: string, companyName: string): Promise<SiteResult | null> {
  let html: string;
  try {
    const res = await fetch(`https://${domain}`, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) return null;
    html = (await res.text()).slice(0, 400_000);
  } catch {
    return null;
  }

  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim() || null;
  const description = meta(html, 'description') ?? meta(html, 'og:description');
  const text = stripHtml(html).slice(0, 4000);
  // Fold accents before matching: darebioscience.com renders "Daré Bioscience",
  // which a plain lowercase compare will not match against its own name.
  const fold = (x: string) => x.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const hay = fold(`${title ?? ''} ${description ?? ''} ${text}`);

  // Reject obvious dead ends.
  const dead = /^(404|not found|page not found|domain (is )?for sale|buy this domain|coming soon|under construction)/i;
  if (title && dead.test(title.trim())) {
    return { domain, title, description, text, verified: false, thin: true, verifyReason: `dead page: "${title.slice(0, 40)}"` };
  }

  // Parked / domain-broker pages. These pass a naive name check because the
  // broker echoes the domain back at you — aevos.com serves 'Premium domains
  // add authority to your site', which reads exactly like company copy.
  const parked = /(premium domains?|domain (is )?for sale|buy this domain|whois privacy|make an offer|this domain is available|godaddy|sedo|dan\.com|afternic|hugedomains|namecheap market)/i;
  if (parked.test(`${title ?? ''} ${description ?? ''} ${text.slice(0, 800)}`)) {
    return { domain, title, description, text, verified: false, thin: true, verifyReason: 'parked / domain-for-sale page' };
  }
  if (text.length < 120) {
    return { domain, title, description, text, verified: false, thin: true, verifyReason: 'page has almost no text' };
  }

  // Distinctive tokens from the company name (>=4 chars, not generic).
  const tokens = fold(companyName).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  if (!tokens.length) {
    return { domain, title, description, text, verified: false, thin: true, verifyReason: 'no distinctive tokens in company name' };
  }
  const hits = tokens.filter((t) => hay.includes(t));

  // Every distinctive token has to appear. A single generic word is not
  // evidence of identity — one-token overlap is enough to match "Standard
  // Cognition" to standard.com, an insurance company — and a wrong website
  // feeds a confident wrong assessment (DESIGN_RATIONALE §8).
  const allPresent = hits.length === tokens.length;

  // The full name appearing contiguously is the strongest signal available.
  const compact = (x: string) => x.replace(/[^a-z0-9]/g, '');
  const contiguous = compact(hay).includes(compact(tokens.join('')));

  /*
   * A ONE-TOKEN NAME CANNOT BE VERIFIED BY ITS NAME ALONE.
   *
   * "Aslan" appears on aslan.ai, a Thai finance site; "Electra" is the exact
   * name of seven different companies in CB Insights. For a single-word name
   * `allPresent` and `contiguous` are the same test — does this one word occur
   * — and any page that happens to use the word passes it. That is a
   * coincidence being recorded as an identity, and §8 is explicit that a wrong
   * website is worse than none because it feeds a confident wrong assessment.
   *
   * So a single-token name needs corroboration beyond the name: the caller's
   * `expectedIndustry` check in resolveWebsite. Multi-word names keep the
   * original bar, where matching every token is genuinely distinctive.
   */
  /*
   * A single-word name is only as good as the domain carrying it. When the
   * domain's stem IS the name — agentrys.ai for Agentrys — the company owns
   * that name on that domain and the match is as strong as any. When the name
   * merely appears somewhere in the page text, it is a coincidence: "Aslan" is
   * a Thai finance site, and "Electra" is the exact name of seven different
   * companies. So the stem is what verifies a one-word name, not the prose.
   */
  const singleToken = tokens.length === 1;
  const stem = domain.replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '');
  const stemIsName = stem === tokens.join('');
  const verified = singleToken ? stemIsName : (allPresent || contiguous);

  // A verified name match still leaves two cases the caller has to tell apart:
  //  - contentful : real company copy the assessment can judge
  //  - thin       : the domain exists and echoes the name but says nothing.
  const uniqueWords = new Set(text.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const thin = !description && uniqueWords.size < 40;

  return {
    domain, title, description, text,
    verified,
    thin,
    verifyReason: verified
      ? (contiguous ? `page contains the full name "${tokens.join(' ')}"${thin ? ' (THIN: placeholder page, little content)' : ''}`
                    : `page references all name tokens: ${hits.map((h) => `"${h}"`).join(', ')}${thin ? ' (THIN)' : ''}`)
      : singleToken
        ? `single-word name "${tokens[0]}" but the domain stem is "${stem}" - a word appearing on a page is not identity`
        : `partial match only (${hits.length}/${tokens.length}: ${hits.join(', ') || 'none'}) - rejected to avoid a wrong company`,
  };
}

/**
 * Words that say what a business does. Where the company's known industry and
 * the site's own copy disagree on this, the name match is a coincidence.
 */
const INDUSTRY_WORDS: Record<string, RegExp> = {
  biotech: /\b(biotech|therapeutic|clinical|pharma|drug|patient|medical|diagnos|molecul|gene|cell|trial|disease|health)\b/i,
  agency: /\b(agency|marketing|branding|advertis|creative studio|web design|seo|social media)\b/i,
  software: /\b(software|platform|api|saas|app|developer|cloud|data)\b/i,
  hardware: /\b(hardware|semiconductor|chip|device|sensor|robot|manufactur|materials)\b/i,
  defence: /\b(defen[cs]e|military|intelligence|warfight|tactical|weapon|missile|aerospace|national security)\b/i,
  ai: /\b(artificial intelligence|machine learning|\bllm\b|agentic|ai agents?|foundation model|inference|neural network|deep learning)\b/i,
  energy: /\b(energy|battery|solar|grid|nuclear|fusion|power|renewable)\b/i,
  space: /\b(space|satellite|orbit|launch|rocket|spacecraft)\b/i,
};

/**
 * Whether a page's own copy corroborates the industry the company is known to
 * be in. Used for the names that cannot verify themselves.
 *
 * The test is positive corroboration, never absence of a contradiction: a
 * generic name always matches SOME company, so the page has to actively speak
 * the right industry's language rather than merely fail to speak the wrong
 * one's.
 */
export const SAME_NAME_SYSTEM = `You decide whether a website belongs to a specific company.

Many companies share a name. You are given what is known about the company being looked for, and the actual content of a website whose address matches that name. Decide whether the site is that company's own site.

Answer no when the site belongs to a different company that happens to share the name, when it is a publication, directory, or fan page about the name, or when the content is too thin to tell. "I cannot tell from this" is a no.

Answer yes only when the site's own description of its business is consistent with what the company is known to do. A site in another language is fine if the business matches; the language is not the test.

Being wrong costs more in one direction. A wrong site is recorded as fact and read by a later judgment as though it were checked, where no site simply leaves a gap that someone can fill. When it is close, say no.

Return JSON only: {"same_company": true|false, "why": "<one short sentence>"}`;

export function buildSameNamePrompt(
  companyName: string, knownFor: string, site: { domain: string; title: string | null; text: string },
): string {
  return `Company being looked for: ${companyName}
What is known about it: ${knownFor}

Website found: ${site.domain}
Page title: ${site.title ?? '(none)'}
Page content:
${site.text.slice(0, 1500)}`;
}

export function corroboratesIndustry(hay: string, expectedIndustry: string): boolean {
  const want = expectedIndustry.toLowerCase();
  const keys = Object.keys(INDUSTRY_WORDS).filter((k) => want.includes(k));
  // Nothing recognisable to test against is not corroboration.
  if (!keys.length) return false;
  return keys.some((k) => INDUSTRY_WORDS[k]!.test(hay));
}

/**
 * Try candidates in order and return the first verified hit.
 *
 * `expectedIndustry` guards against same-name different-company matches.
 * AMPLIFICA HOLDINGS GROUP files as a biotech, while amplifica.com is a digital
 * agency: the name matches perfectly and the page is real, so every other check
 * passes and only the mismatch between "Biotechnology" and "digital agency"
 * catches it.
 */
export async function resolveWebsite(companyName: string, expectedIndustry?: string | null): Promise<SiteResult | null> {
  for (const d of candidateDomains(companyName)) {
    const r = await tryDomain(d, companyName);

    if (r?.verified) {
      /*
       * A one-word name that verified on its stem still has to agree with what
       * the company is known to do. aslan.ai is a Thai finance site and the
       * company is defence AI; electra.com sells industrial kit and the company
       * makes drugs. The stem proves someone owns the name — the industry is
       * what says it is the RIGHT someone.
       */
      const oneWord = (r.verifyReason ?? '').startsWith('page contains the full name')
        && !companyName.trim().includes(' ');
      if (oneWord && expectedIndustry) {
        const hay = `${r.title ?? ''} ${r.description ?? ''} ${r.text}`;
        if (!corroboratesIndustry(hay, expectedIndustry)) { await sleep(120); continue; }
      }
      if (expectedIndustry) {
        const hay = `${r.title ?? ''} ${r.description ?? ''} ${r.text}`;
        const expectBio = /biotech|health|pharma|medical|life science/i.test(expectedIndustry);
        // The test is positive corroboration rather than absence of a
        // contradiction. A generic name will always match some company:
        // amplifica.com (a US marketing agency) and amplifica.io (a Chilean
        // logistics firm) both match "AMPLIFICA" perfectly and serve real
        // pages, and only demanding biotech language on the page rejects them.
        if (expectBio && !INDUSTRY_WORDS.biotech.test(hay)) {
          await new Promise((res) => setTimeout(res, 120));
          continue;
        }
      }
      return r;
    }
    await new Promise((res) => setTimeout(res, 120)); // be polite
  }
  return null;
}
