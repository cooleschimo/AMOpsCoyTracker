/**
 * Website resolution and content extraction for companies with no public profile.
 *
 * WHY THIS EXISTS: Form D carries no website, SIC code or description (verified
 * against data.sec.gov — those fields populate only for public reporting
 * companies). Without a website the assessment is judging a name and a city,
 * and it correctly answers 'unknown'.
 *
 * WHY NOT A SEARCH API: tested 2026-08-21 — DuckDuckGo's HTML endpoint blocks
 * automation ('anomaly' page), its Instant Answer API returns empty for private
 * companies, Mojeek 403s, and public SearXNG instances disable JSON output.
 * Google/Bing/Brave all require paid keys. Domain construction plus verification
 * needs no key, no quota and no ToS risk, and is MORE reliable for this specific
 * task because these companies have near-zero search presence anyway.
 *
 * FALSE-POSITIVE STANCE (DESIGN_RATIONALE §8): a wrong website is worse than no
 * website, because it feeds a confident wrong assessment. Every candidate must
 * pass verification (the page must actually reference the company) before it is
 * accepted, and every accepted domain records how it was found.
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
 * Verification: a distinctive token from the company name must appear in the
 * page, OR the page title must contain it. Parked pages and 404s are rejected.
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
  const hay = `${title ?? ''} ${description ?? ''} ${text}`.toLowerCase();

  // Reject obvious dead ends.
  const dead = /^(404|not found|page not found|domain (is )?for sale|buy this domain|coming soon|under construction)/i;
  if (title && dead.test(title.trim())) {
    return { domain, title, description, text, verified: false, thin: true, verifyReason: `dead page: "${title.slice(0, 40)}"` };
  }

  // Parked / domain-broker pages. These pass a naive name check because the
  // broker echoes the domain back at you. Caught in testing: aevos.com sold
  // 'Premium domains add authority to your site' as if it were company copy.
  const parked = /(premium domains?|domain (is )?for sale|buy this domain|whois privacy|make an offer|this domain is available|godaddy|sedo|dan\.com|afternic|hugedomains|namecheap market)/i;
  if (parked.test(`${title ?? ''} ${description ?? ''} ${text.slice(0, 800)}`)) {
    return { domain, title, description, text, verified: false, thin: true, verifyReason: 'parked / domain-for-sale page' };
  }
  if (text.length < 120) {
    return { domain, title, description, text, verified: false, thin: true, verifyReason: 'page has almost no text' };
  }

  // Distinctive tokens from the company name (>=4 chars, not generic).
  const tokens = companyName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  if (!tokens.length) {
    return { domain, title, description, text, verified: false, thin: true, verifyReason: 'no distinctive tokens in company name' };
  }
  const hits = tokens.filter((t) => hay.includes(t));

  // ALL distinctive tokens must appear. One-token overlap is how
  // "Standard Cognition" matched standard.com (an insurance company) in
  // testing — a single generic word is not evidence of identity, and a wrong
  // website feeds a confident wrong assessment (DESIGN_RATIONALE §8).
  const allPresent = hits.length === tokens.length;

  // The full name appearing contiguously is the strongest signal available.
  const compact = (x: string) => x.replace(/[^a-z0-9]/g, '');
  const contiguous = compact(hay).includes(compact(tokens.join('')));

  const verified = allPresent || contiguous;

  // A verified name match is NOT proof of a useful page. Two distinct cases the
  // caller must be able to tell apart, both found in testing:
  //  - contentful : real company copy the assessment can judge
  //  - thin       : the domain exists and echoes the name, but says nothing
  //                 (universalgrapheneproducts.com: title = the domain, no
  //                 description, body just repeats the name). Verified, useless.
  const uniqueWords = new Set(text.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const thin = !description && uniqueWords.size < 40;

  return {
    domain, title, description, text,
    verified,
    thin,
    verifyReason: verified
      ? (contiguous ? `page contains the full name "${tokens.join(' ')}"${thin ? ' (THIN: placeholder page, little content)' : ''}`
                    : `page references all name tokens: ${hits.map((h) => `"${h}"`).join(', ')}${thin ? ' (THIN)' : ''}`)
      : `partial match only (${hits.length}/${tokens.length}: ${hits.join(', ') || 'none'}) - rejected to avoid a wrong company`,
  };
}

/** Try candidates in order; return the first VERIFIED hit. */
export async function resolveWebsite(companyName: string): Promise<SiteResult | null> {
  for (const d of candidateDomains(companyName)) {
    const r = await tryDomain(d, companyName);
    if (r?.verified) return r;
    await new Promise((res) => setTimeout(res, 120)); // be polite
  }
  return null;
}
