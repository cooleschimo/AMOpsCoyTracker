/**
 * Vocabulary the dashboard components render against.
 *
 * These mirror the enums the pipeline already owns — lib/rubric.ts, lib/accounts.ts,
 * lib/dispositions.ts, lib/company-rubric.ts — restated here as plain unions so a
 * presentational component can import one module rather than five, and so the
 * component tree has no dependency on anything that touches the database.
 */
export type { Band } from './company-rubric';
export type { AccountStatus } from './accounts';
export type { Disposition, Reason as DismissReason } from './dispositions';
export type { SignalType } from './rubric';
export type { Source, EvidencePoint, Assessment, DashboardCompany } from './dashboard-data';

/** The four sectors in scope. Brief §2. */
export type Sector = 'deeptech' | 'biotech' | 'defence_tech' | 'ai';

/** Warm-path kinds. Brief §8, lib/paths.ts. */
export type PathKind = 'person_role' | 'fund_portfolio' | 'company_edge' | 'event';

/** Where a path stands once a human has looked at it. */
export type PathReviewStatus = 'unreviewed' | 'usable' | 'needs_verifying' | 'not_usable' | 'not_sure';

/** How feasible a path looks before review. */
export type Feasibility = 'confirmed' | 'plausible' | 'weak';

/** Value-proposition status tiers. lib/valueprops.ts. */
export type OfferTier = 'available_now' | 'underway' | 'exploratory';
