/**
 * Choosing what to ask CB Insights for a company, and what to accept back.
 *
 * The connector resolves a NAME STRING against its own entity list. It does not
 * know which company we mean, so a bare name returns whichever entity best
 * matches those characters — confidently, with a complete and plausible profile
 * attached. Names that cost us a match, each returning a real company that was
 * not ours:
 *
 *   Nio      -> an oncology clinic in Campo Grande, Brazil
 *   XTEND    -> a credit-union services firm in Grand Rapids, Michigan
 *   Sierra   -> an IT managed-services firm in McLean, Virginia
 *   Genspark -> an IT-staffing company in Alpharetta, Georgia
 *   Roche    -> a fashion label
 *   Everspin -> a Korean mobile-security firm
 *
 * This is the same failure lib/enrich.ts guards for websites: a one-word name
 * only proves somebody owns the word. The answer is the same too — ask with
 * something that has one owner, and verify the answer against a second
 * attribute before believing it.
 *
 * Order matters, cheapest and most specific first:
 *   1. cbi_org_id, once known. Addresses the entity and cannot be ambiguous.
 *   2. the website. A domain has one owner; "aslanprotects.com" resolves where
 *      "Aslan" does not. But it has to be OUR company's domain: plusai.com is a
 *      Seattle slide-deck tool and plus.ai is the autonomous-trucking company,
 *      so a domain that merely spells the name resolves confidently to the
 *      wrong business. Verification below still applies to a domain match.
 *   3. the name, then read `alternates`. Roche, Rolls-Royce, Micron and BYD all
 *      failed to resolve by name while sitting in their own alternates list, so
 *      an error is a shortlist rather than an absence.
 */
import type { RoundStage } from './scope';

/** What we hold about a company before asking, and what a query is built from. */
export type ResolveInput = {
  name: string;
  website?: string | null;
  /** The headline that discovered it — companies.scope_reason. */
  scopeReason?: string | null;
  sectors?: string[] | null;
  cbiOrgId?: number | null;
};

/**
 * The queries to try, in order, until one resolves and verifies.
 *
 * A caller stops at the first accepted answer; the list is what to try next
 * when it does not, not a set to run in full.
 */
export function resolveQueries(c: ResolveInput): string[] {
  const out: string[] = [];
  const site = bareDomain(c.website);
  if (site) out.push(site);

  const bare = c.name
    .replace(/,?\s+(inc|incorporated|llc|ltd|limited|corp|corporation|co|plc|ag|sa|nv|oy|gmbh)\.?$/i, '')
    .trim();
  out.push(bare);

  /*
   * The sector-qualified name, for a name that is a common word. Two or three
   * words, for the reason lib/websearch.ts gives: every extra term is another
   * thing the ranker has to satisfy, and the snake_case ids repeat their family
   * ('defence_software ai_software' says "software" twice).
   */
  const context = Array.from(new Set(
    (c.sectors ?? []).join(' ').toLowerCase().replace(/[_-]+/g, ' ').split(/\s+/).filter(Boolean),
  )).slice(0, 2).join(' ');
  if (context) out.push(`${bare} ${context}`);

  return Array.from(new Set(out.filter(Boolean)));
}

/** 'https://www.foo.com/bar' -> 'foo.com'. Null when there is nothing usable. */
export function bareDomain(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

/**
 * A funding figure from a discovery headline, which is the strongest key we
 * hold for a young company.
 *
 * scope_reason carries the article that found it — "raised $20.8M", "raises
 * EUR 4.3 million" — and a round of that size on that company in that month is
 * close to unique — it is what confirms a match where the name is a common word
 * and no website is on file.
 *
 * Returns USD millions, treating EUR and GBP as close enough to compare a round
 * size against a candidate's funding history; this decides whether two records
 * describe the same event, not what gets stored.
 */
export function raiseFromHeadline(scopeReason?: string | null): number | null {
  if (!scopeReason) return null;
  const m = scopeReason.match(
    /(?:[$€£]|\b(?:usd|eur|gbp)\s*)\s*([\d.]+)\s*(m|b|k|million|billion|thousand)?\b/i,
  );
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? '').toLowerCase();
  if (unit.startsWith('b')) return n * 1000;
  if (unit.startsWith('k') || unit.startsWith('thousand')) return n / 1000;
  return n;
}

/**
 * Whether a returned profile is the company we asked about.
 *
 * One attribute beyond the name has to agree. The name itself proves nothing —
 * it is what was ambiguous in the first place.
 *
 * `reason` is recorded on the row, so a later reader can see what the match
 * rested on rather than taking it on trust.
 */
export function verifyMatch(
  c: ResolveInput,
  profile: { url?: string | null; foundedYear?: number | null; address?: { city?: string | null; country?: string | null } | null; description?: string | null },
  fundingsMusd: number[] = [],
): { ok: boolean; reason: string } {
  const want = bareDomain(c.website);
  const got = bareDomain(profile.url);
  if (want && got && want === got) return { ok: true, reason: `website ${got}` };

  /*
   * The headline's round, matched against the candidate's own history. Within
   * 15%, because a headline rounds ("$20.8M" against $20,799,999) and converts
   * a currency ("EUR 4.3 million" against a $5M round).
   */
  const raise = raiseFromHeadline(c.scopeReason);
  if (raise !== null) {
    const hit = fundingsMusd.find((f) => f > 0 && Math.abs(f - raise) / Math.max(f, raise) <= 0.15);
    if (hit !== undefined) return { ok: true, reason: `round $${hit}M matches the headline's $${raise}M` };
  }

  /*
   * Geography last, and only as corroboration. It is the weakest of the three —
   * plenty of unrelated companies share a city — so it stands alone only when
   * the headline named the country, which is how the Swiss waste-to-energy
   * company was eventually confirmed.
   */
  const country = profile.address?.country?.toLowerCase();
  if (country && c.scopeReason) {
    const said = c.scopeReason.toLowerCase();
    const demonyms: Record<string, string[]> = {
      switzerland: ['swiss'], india: ['indian'], vietnam: ['vietnamese'],
      china: ['chinese'], japan: ['japanese'], israel: ['israeli'],
      france: ['french'], germany: ['german'], singapore: ['singaporean'],
    };
    const hits = [country, ...(demonyms[country] ?? [])].filter((w) => said.includes(w));
    if (hits.length) return { ok: true, reason: `HQ country matches "${hits[0]}" in the headline` };
  }

  return { ok: false, reason: 'nothing beyond the name agreed' };
}

/**
 * Whether to record funding for this company at all.
 *
 * A listed company's pre-IPO venture history is not its funding story, and a
 * lettered round on Boeing reads as nonsense. Their market cap is the right
 * figure and CB Insights does not carry it, so those fields stay empty and are
 * filled from a filing instead (scripts/backfill-public.ts).
 */
export function isListed(profile: { companyStatus?: string | null }): boolean {
  return String(profile.companyStatus ?? '').toLowerCase() === 'ipo';
}

/** CBI round labels that carry no ROUND_STAGES equivalent, so they store as null. */
export const UNMAPPED_ROUNDS = [
  'growth equity', 'shareholder liquidity', 'secondary market',
  'other investors', 'incubator/accelerator', 'convertible note',
] as const;

/** 'Series B - II' -> 'series_b'; an unmapped or pending label -> null. */
export function toRoundStage(round?: string | null): RoundStage | null {
  if (!round) return null;
  const s = round.toLowerCase().trim();
  if (UNMAPPED_ROUNDS.some((u) => s.startsWith(u))) return null;
  if (/^(pre-?seed|seed)/.test(s)) return 'seed';
  const m = s.match(/^series\s+([a-l])\b/);
  if (m) return `series_${m[1]}` as RoundStage;
  if (s.startsWith('ipo')) return 'ipo';
  return null;
}
