/**
 * Disposition vocabulary. Brief §11, DESIGN_RATIONALE §12.
 *
 * These live outside the server-action file because a `'use server'` module may
 * only export async functions, so exporting a constant from one is a build error.
 *
 * `draft_email` names what the action produces rather than an abstraction: it
 * opens an opportunity and triggers the §9 draft. Nothing is ever sent — the
 * draft lands in the dashboard for a human to edit.
 *
 * `monitor` adds the company to monitoring. Its later activity surfaces in the
 * monitoring section instead of competing for a discovery slot (§11a).
 *
 * The reasons are a fixed list because each routes to a different fix (§12) and
 * the stats page counts them:
 *   irrelevant_company -> entity resolution, or the company rubric
 *   too_early          -> timing weights in the rubric
 *   no_sg_angle        -> the item rubric
 * Anything that does not route to a fix belongs in `note`, which is why the
 * list is short.
 *
 * 'already_tracked' was a fourth, and is not a reason to dismiss: it describes
 * the COMPANY rather than the item, and a company EDB is already working with
 * doing something new is more interesting than one it is not. Marking the
 * company known is the action; `who_we_know` is where its news then surfaces,
 * which is the section that exists for exactly this.
 */
export const DISPOSITIONS = ['draft_email', 'monitor', 'dismiss'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  draft_email: 'Draft an email',
  monitor: 'Monitor',
  dismiss: 'Dismiss',
};

export const REASONS = [
  'irrelevant_company', 'too_early', 'no_sg_angle',
] as const;
export type Reason = (typeof REASONS)[number];

export const REASON_LABELS: Record<Reason, string> = {
  irrelevant_company: 'Irrelevant company',
  too_early: 'Too early',
  no_sg_angle: 'No Singapore angle',
};
