/**
 * Vocabulary the dashboard components render against.
 *
 * These mirror the enums the pipeline already owns — lib/rubric.ts, lib/accounts.ts,
 * lib/dispositions.ts, lib/company-rubric.ts — restated here as plain unions so a
 * presentational component can import one module rather than five, and so the
 * component tree has no dependency on anything that touches the database.
 */
export type { Band } from './company-rubric';
export type { Familiarity } from './familiarity';
export type { Disposition, Reason as DismissReason } from './dispositions';
export type { SignalType } from './rubric';
export type { Source, EvidencePoint, Assessment, DashboardCompany } from './dashboard-data';

/** The four sectors in scope. Brief §2. */
export type Sector = 'deeptech' | 'biotech' | 'defence_tech' | 'ai';

/** Warm-path kinds. Brief §8, lib/paths.ts. */
export const PATH_KINDS = ['person_role', 'fund_portfolio', 'company_edge', 'event'] as const;
export type PathKind = (typeof PATH_KINDS)[number];

/**
 * Where a path stands once a human has looked at it.
 *
 * `unreviewed` is the honest default and the one every path starts in. The
 * middle two say something a boolean cannot: 'needs_verifying' is a path worth
 * chasing that nobody has confirmed, and 'not_sure' records that somebody
 * looked and could not tell — which is different from nobody having looked.
 */
export const PATH_REVIEW_STATUSES = [
  'unreviewed', 'usable', 'needs_verifying', 'not_usable', 'not_sure',
] as const;
export type PathReviewStatus = (typeof PATH_REVIEW_STATUSES)[number];

export const PATH_REVIEW_LABELS: Record<PathReviewStatus, string> = {
  unreviewed: 'Not reviewed',
  usable: 'Usable',
  needs_verifying: 'Needs verifying',
  not_usable: 'Not usable',
  not_sure: 'Not sure',
};

export const PATH_REVIEW_HELP: Record<PathReviewStatus, string> = {
  unreviewed: 'Nobody has looked at this. It is an association, not an introduction.',
  usable: 'Somebody can actually make this introduction. Ranks the path up.',
  needs_verifying: 'Worth chasing, but nobody has confirmed access yet.',
  not_usable: 'The connection does not give EDB a route. Hides the path.',
  not_sure: 'Looked at and could not tell — which is not the same as unlooked-at.',
};

/** How feasible a path looks before review. */
export type Feasibility = 'confirmed' | 'plausible' | 'weak';

/** Value-proposition status tiers. lib/valueprops.ts. */
export type OfferTier = 'available_now' | 'underway' | 'exploratory';
