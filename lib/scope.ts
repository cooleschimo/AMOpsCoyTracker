import { and, ne, sql } from 'drizzle-orm';

/**
 * Scope definitions. Brief §2.
 *
 * AI is a cross-cutting TAG, not a category: an AI chip company is both
 * 'deeptech' and 'ai'. This is why companies.sectors is an array.
 *
 * Adding a sector must be a config change plus new keyword sets — nothing
 * structural.
 */

export const SECTORS = ['deeptech', 'biotech', 'defence_tech', 'ai'] as const;
export type Sector = (typeof SECTORS)[number];

export const HQ_REGIONS = [
  'bay_area',
  'socal',
  'seattle',
  'san_diego',
  'other_west',
  'other_us',
] as const;
export type HqRegion = (typeof HQ_REGIONS)[number];

/**
 * Round stages. Brief §2 wrote the extension form as `series_X_ext`; the seed
 * data uses per-series values (series_b_ext, series_c_ext), which carry more
 * information. Widened 2026-08-21 to match the data — see BUILD_BRIEF §3a.
 */
export const ROUND_STAGES = [
  'seed', 'launch',
  'series_a', 'series_b', 'series_c', 'series_d',
  'series_e', 'series_f', 'series_g', 'series_h',
  'series_a_ext', 'series_b_ext', 'series_c_ext', 'series_d_ext',
  'series_e_ext', 'series_f_ext', 'series_g_ext', 'series_h_ext',
  // A listing is a financing event with no lettered round. lib/placement.ts
  // already counts it as late-stage; it belongs in the vocabulary too.
  'ipo',
  'strategic', 'multiple', 'unknown',
] as const;
export type RoundStage = (typeof ROUND_STAGES)[number];

/**
 * Exclusion reasons for the discovery guard table. Brief §4 listed five;
 * non_west_coast_hq added 2026-08-21 to match seed data (True Anomaly).
 */
export const EXCLUSION_REASONS = [
  'acquired', 'went_public', 'not_independent',
  'independence_uncertain', 'non_us_hq', 'non_west_coast_hq',
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

/** sg_apac token roles. A '?' suffix means reported-but-unverified. */
export const SG_APAC_ROLES = ['investor', 'investor_lead', 'partner', 'office'] as const;
export type SgApacRole = (typeof SG_APAC_ROLES)[number];

/**
 * The postal codes, so a two-letter hq_state can be told from a country.
 *
 * A shape test cannot do it: 'UK' is two capitals and passed as a state, which
 * filed five London companies — Rolls-Royce among them — under "rest of US".
 * Non-US rows otherwise carry a spelled-out country ('Singapore', 'Germany'),
 * so membership is the check that separates them.
 */
const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  // The District and the inhabited territories: US-domestic for this purpose.
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP',
]);

/** Whether an hq_state holds a US state code rather than a country name. */
export const isUsState = (v: unknown): boolean =>
  typeof v === 'string' && US_STATE_CODES.has(v.trim().toUpperCase());

export const isSector = (v: string): v is Sector => (SECTORS as readonly string[]).includes(v);
export const isHqRegion = (v: string): v is HqRegion => (HQ_REGIONS as readonly string[]).includes(v);
export const isRoundStage = (v: string): v is RoundStage => (ROUND_STAGES as readonly string[]).includes(v);
export const isExclusionReason = (v: string): v is ExclusionReason =>
  (EXCLUSION_REASONS as readonly string[]).includes(v);
export const isSgApacRole = (v: string): v is SgApacRole =>
  (SG_APAC_ROLES as readonly string[]).includes(v);

/**
 * The companies the pipeline actually watches.
 *
 * Every enrichment and ingest stage works on this same set, because a company
 * that reaches the digest needs its website, people, hiring and location filled
 * in whatever route found it. The stages used to name their own origins — seed
 * plus assessed Form D — which quietly excluded everything news discovery found
 * and left those companies scored on evidence nobody had gathered.
 *
 * Portfolio companies are the deliberate exception. Portfolio scraping fills
 * the graph with thousands of names so §5.2's reverse index can answer which
 * funds touch a sector; they are connections rather than targets, and fetching
 * news or job boards for all of them would cost far more than it returns. One
 * becomes a target the ordinary way, by being discovered again through a route
 * that watches it.
 *
 * A company the assessment marked out of scope drops out, which is what stops
 * the set growing without limit. 'unknown' is not a judgment and stays in.
 */
/**
 * Drizzle form. Takes the `companies` table so lib/scope.ts stays free of a
 * schema import — scope is vocabulary, and importing the schema here would make
 * every consumer of a sector constant pull in the database layer.
 */
export const trackedCompanies = (c: {
  discoveredVia: unknown; scopeStatus: unknown;
}) => and(
  ne(sql`coalesce(${c.discoveredVia}, '')`, 'portfolio'),
  ne(sql`coalesce(${c.scopeStatus}, 'unknown')`, 'out_of_scope'),
);

/** Raw-SQL form, for the query builders that assemble strings. */
export const TRACKED_COMPANIES_SQL = `
  coalesce(c.discovered_via, '') <> 'portfolio'
  and coalesce(c.scope_status, 'unknown') <> 'out_of_scope'`;
