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
  'strategic', 'multiple', 'unknown',
] as const;
export type RoundStage = (typeof ROUND_STAGES)[number];

/** Seed flags. Brief §2. memory_filled and verify_* gate what the UI may assert. */
export const SEED_FLAGS = [
  'verify_hq', 'verify_round', 'verify_independence', 'verify_other',
  'memory_filled', 'round_dated', 'manual_digest', 'late_stage',
  'prime', 'sg_warm_path',
] as const;
export type SeedFlag = (typeof SEED_FLAGS)[number];

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

export const isSector = (v: string): v is Sector => (SECTORS as readonly string[]).includes(v);
export const isHqRegion = (v: string): v is HqRegion => (HQ_REGIONS as readonly string[]).includes(v);
export const isRoundStage = (v: string): v is RoundStage => (ROUND_STAGES as readonly string[]).includes(v);
export const isSeedFlag = (v: string): v is SeedFlag => (SEED_FLAGS as readonly string[]).includes(v);
export const isExclusionReason = (v: string): v is ExclusionReason =>
  (EXCLUSION_REASONS as readonly string[]).includes(v);
export const isSgApacRole = (v: string): v is SgApacRole =>
  (SG_APAC_ROLES as readonly string[]).includes(v);
