/**
 * VC portfolio page scraping. Brief §5.2.
 *
 * TWO PAYOFFS:
 *  - Discovery: new names on a portfolio page are new investments, often before
 *    announcement.
 *  - The REVERSE INDEX: inverting investor -> company answers the question that
 *    matters — which funds touch this company, and where else do those funds
 *    appear in our world.
 *
 * Portfolio pages are unstructured marketing HTML with no common schema, so
 * this extracts candidate company names heuristically and is deliberately
 * conservative: a wrong company on a fund's page creates a false investment
 * edge, which produces a false warm path. Rejected names are counted, not
 * silently dropped.
 */

const UA = 'Mozilla/5.0 (compatible; AMOpsCoyTracker/1.0; +research)';

/** Nav, legal and social chrome that appears on every marketing site. */
const CHROME = new Set([
  'home','about','about us','team','our team','portfolio','companies','our companies',
  'news','insights','blog','contact','contact us','careers','jobs','people','press',
  'privacy','privacy policy','terms','terms of use','cookie policy','legal','disclosures',
  'login','log in','sign in','sign up','subscribe','newsletter','search','menu','close',
  'twitter','linkedin','facebook','instagram','youtube','medium','github','x',
  'read more','learn more','view all','see all','load more','next','previous','back',
  'all','filter','filters','sort','reset','apply','submit','email','follow us',
  'investments','approach','thesis','strategy','values','mission','vision','process',
  'founders','founder','partners','partnership','platform','resources','events',
  'stories','perspectives','media','reports','research','podcast','videos',
  'exits','ipo','acquired','current','former','active','sitemap','accessibility',
  // Seen in live pages 2026-08-21:
  'visit','loading...','loading','company','bio','exited','milestones','industries',
  'global navigation','site navigation','skip to content','overview','more','details',
  'website','learn','explore','discover','view','open','select','toggle','expand',
  // Sector/vertical labels that sit next to company names in card layouts
  'ai','artificial intelligence','robotics','logistics','infrastructure','automation',
  'energy transition','next-gen compute','engineered biology','biotech','biology',
  'computer science','electronics','manufacturing','security','defense','defence',
  'health','healthcare','fintech','software','hardware','space','climate','enterprise',
  'consumer','data','semiconductors','materials','agriculture','transportation',
  // Nav chrome seen on real fund sites 2026-08-21
  'ideas','principles','roadmap','lp portal','investor disclosure','investors',
  'back to top','link','[emailprotected]','disclosures','our approach','our focus',
  'why us','join us','apply','pitch us','submit a pitch','portfolio companies',
  'offices','office','locations','location','our offices',
]);

const BAD_PATTERNS = [
  /^\d+$/, /^[^a-z0-9]+$/i, /^(19|20)\d{2}$/,
  /\b(cookie|consent|gdpr|copyright|all rights reserved)\b/i,
  /^(series|seed|stage|sector|industry|category|region)\b/i,
  /@|https?:\/\//,
];

export function looksLikeCompanyName(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 2 || s.length > 48) return false;
  if (CHROME.has(s.toLowerCase())) return false;
  if (BAD_PATTERNS.some((re) => re.test(s))) return false;
  // Reject sentences: company names are short noun phrases.
  if (s.split(/\s+/).length > 5) return false;
  if (/[.!?]$/.test(s) && s.split(/\s+/).length > 2) return false;
  // Slug lists ("josh-wolfe,brandon-reeves") and comma blobs are not company names.
  if (/[a-z]-[a-z]+,/i.test(s) || s.includes(',')) return false;
  // "Lux investment: 2017", "EXIT - Nasdaq: ABCL" - metadata, not names.
  if (/:/.test(s)) return false;
  // Two capitalised full names side by side ("Qasar Younis Peter Ludwig") is a
  // people list from a card, not a company.
  if (/^([A-Z][a-z]+\s){3,}[A-Z][a-z]+$/.test(s)) return false;
  // Must contain a letter.
  return /[a-z]/i.test(s);
}

export type ScrapeResult = {
  url: string;
  ok: boolean;
  httpStatus: number | null;
  names: string[];
  /**
   * name -> company domain, where the page linked out to it.
   *
   * Portfolio pages almost always link each company to its own site, and that
   * domain is the STRONGEST entity-resolution signal (brief §6) as well as the
   * input the company team-page scraper needs. Discarding it was leaving 2,585
   * companies with no website and therefore unreachable for people scraping.
   */
  domains: Record<string, string>;
  rejected: number;
  bytes: number;
  strategy: string;
  error: string | null;
};

/** Hosts that are never a portfolio company's own site. */
const NON_COMPANY_HOSTS = /(twitter|x\.com|linkedin|facebook|youtube|instagram|medium|github|crunchbase|google|gstatic|webflow|squarespace|wixsite|cdn|cloudfront|typeform|mailchimp|hubspot|vimeo|substack|apple|spotify|bsky)/i;

/**
 * Pair company names with the outbound domain in the same anchor.
 * Only anchors whose visible text or image alt looks like a company name count,
 * so nav links to a fund's own socials are ignored.
 */
export function extractDomains(html: string, pageUrl: string): Record<string, string> {
  const out: Record<string, string> = {};
  let selfHost = '';
  try { selfHost = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { /* ignore */ }

  // CARD PASS. Portfolio grids often put the name and the outbound link in
  // SIBLING elements rather than one anchor, so an anchor-only pass finds
  // nothing. 8VC renders each card as:
  //   <div fs-cmsfilter-field="name">Addepar</div> ... <a href="https://addepar.com/">
  // Split the page into card-sized chunks and pair the first company-looking
  // name with the first external link in the same chunk.
  const chunks = html.split(/<div[^>]*class=["'][^"']*(?:card|cms-item|w-dyn-item|grid-item|portfolio-item)[^"']*["']/i);
  for (const chunk of chunks) {
    const nameMatch =
      chunk.match(/fs-cmsfilter-field=["']name["'][^>]*>([^<]{2,48})</i)?.[1] ??
      chunk.match(/<(?:h[2-5]|div|span)[^>]*>([^<]{2,48})<\/(?:h[2-5]|div|span)>/i)?.[1] ??
      chunk.match(/alt=["']([^"']{2,48})["']/i)?.[1];
    if (!nameMatch) continue;
    const name = nameMatch.replace(/&amp;/g, '&').trim();
    if (!looksLikeCompanyName(name)) continue;

    for (const lm of chunk.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
      let host: string;
      try { host = new URL(lm[1]).hostname.replace(/^www\./, ''); } catch { continue; }
      if (!host || host === selfHost || host.endsWith(`.${selfHost}`)) continue;
      if (NON_COMPANY_HOSTS.test(host)) continue;
      out[name] = host;
      break;
    }
  }

  for (const m of html.matchAll(/<a\s[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    let host: string;
    try { host = new URL(m[1]).hostname.replace(/^www\./, ''); } catch { continue; }
    if (!host || host === selfHost || host.endsWith(`.${selfHost}`)) continue;
    if (NON_COMPANY_HOSTS.test(host)) continue;

    const inner = m[2];
    const candidates = [
      inner.match(/alt=["']([^"']{2,48})["']/i)?.[1],
      inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    ].filter((x): x is string => !!x);

    for (const c of candidates) {
      const cleaned = c.replace(/&amp;/g, '&').trim();
      if (looksLikeCompanyName(cleaned)) { out[cleaned] = host; break; }
    }
  }
  return out;
}

/**
 * Extract candidate names. Tries structured containers first, then falls back
 * to link text — the strategy used is reported so a bad parse is visible in
 * source health rather than looking like a fund with no portfolio.
 */
export function extractNames(html: string): { names: string[]; rejected: number; strategy: string } {
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

  const attempts: Array<{ strategy: string; raw: string[] }> = [];

  // 1. Elements whose class/id mentions portfolio/company/card.
  const classy = [...clean.matchAll(
    /<(?:div|li|article|a|h[2-5])[^>]*(?:class|id)=["'][^"']*(?:portfolio|company|companies|card|logo|grid-item)[^"']*["'][^>]*>([\s\S]{0,400}?)<\/(?:div|li|article|a|h[2-5])>/gi,
  )].map((m) => m[1]);
  if (classy.length) {
    attempts.push({
      strategy: 'class-matched containers',
      raw: classy.map((c) => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()),
    });
  }

  // 2. Image alt text — portfolio pages are usually logo grids. Alt text is
  // often an asset name ("anduril-logo", "applied-intuition-cover-image"), so
  // strip the asset suffix and de-slugify before judging it.
  const alts = [...clean.matchAll(/<img[^>]+alt=["']([^"']{2,60})["']/gi)]
    .map((m) => m[1])
    .map((a) => a
      .replace(/[-_ ]?(cover[-_ ]?image|logo|logotype|icon|thumbnail|thumb|image|img|wordmark|mark|white|black|colour|color|dark|light|small|large|\d+x\d+)$/i, '')
      .replace(/\.(png|jpe?g|svg|webp|gif)$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);
  if (alts.length) attempts.push({ strategy: 'logo alt text', raw: alts });

  // 3. Link text.
  const links = [...clean.matchAll(/<a\s[^>]*>([\s\S]{0,120}?)<\/a>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  if (links.length) attempts.push({ strategy: 'link text', raw: links });

  // 4. Headings.
  const heads = [...clean.matchAll(/<h[2-5][^>]*>([\s\S]{0,120}?)<\/h[2-5]>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  if (heads.length) attempts.push({ strategy: 'headings', raw: heads });

  const scored = attempts.map((a) => {
    const seen = new Set<string>();
    const kept: string[] = [];
    let rejected = 0;
    for (const r of a.raw) {
      const s = r.replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim();
      if (!s) continue;
      if (looksLikeCompanyName(s)) {
        const k = s.toLowerCase();
        if (!seen.has(k)) { seen.add(k); kept.push(s); }
      } else rejected++;
    }
    const total = kept.length + rejected;
    const precision = total ? kept.length / total : 0;
    return { names: kept, rejected, strategy: a.strategy, precision };
  });

  // Prefer yield, but penalise a strategy that rejects most of what it finds:
  // that means it is reading nav and sector chrome rather than a company list.
  // Lux's class-matched containers scored 80 kept / 93 rejected (precision 0.46)
  // while its logo alt text was clean - without this, the noisier one won.
  const ranked = scored
    .filter((s) => s.names.length > 0)
    .sort((a, b) => (b.names.length * Math.max(b.precision, 0.15)) - (a.names.length * Math.max(a.precision, 0.15)));

  const best = ranked[0] ?? { names: [], rejected: 0, strategy: 'none', precision: 0 };

  // A LOW-YIELD, LOW-PRECISION result is navigation chrome, not a portfolio.
  // Prime Movers Lab returned 6 names at precision 0.25 - all of them nav
  // ("Ideas", "Principles", "LP Portal"). A high-yield low-precision result is
  // different: Basis Set scored 0.32 but its 61 names were all real companies,
  // because card layouts interleave metadata. Gate on the combination.
  if (best.names.length < 15 && best.precision < 0.55) {
    return { names: [], rejected: best.rejected + best.names.length, strategy: `${best.strategy} REJECTED: low yield (${best.names.length}) at low precision (${best.precision.toFixed(2)}) - reads as navigation chrome` };
  }

  // Drop residual URL-ish and obvious non-name entries from the winner.
  const cleaned = best.names.filter((n) => !/^www\.|^https?:/i.test(n) && !/^\[.*\]$/.test(n));
  return { names: cleaned, rejected: best.rejected + (best.names.length - cleaned.length), strategy: `${best.strategy} (precision ${best.precision.toFixed(2)})` };
}

export async function scrapePortfolio(url: string): Promise<ScrapeResult> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow', signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      return { url, ok: false, httpStatus: res.status, names: [], domains: {}, rejected: 0, bytes: 0, strategy: 'none', error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const { names, rejected, strategy } = extractNames(html);
    const domains = extractDomains(html, url);
    return {
      url, ok: true, httpStatus: res.status, names, domains, rejected,
      bytes: html.length, strategy,
      // An empty parse is a SOURCE-HEALTH EVENT, not a silent skip (funds.ts).
      error: names.length === 0 ? 'parsed zero names — page shape may have changed or is JS-rendered' : null,
    };
  } catch (e) {
    return { url, ok: false, httpStatus: null, names: [], domains: {}, rejected: 0, bytes: 0, strategy: 'none', error: (e as Error).message };
  }
}
