/**
 * How well EDB knows a company. Brief §4.
 *
 * This replaced an account-status field. Whether EDB holds an account is
 * commercially sensitive and lives in systems this tool has no business
 * mirroring; how well a company is *known* is a judgment a regional director
 * can make from memory, and it is the part that actually bears on ranking — a
 * company already engaged with is not a discovery.
 *
 * Four values, not a boolean. 'no_status' is the honest default: nobody has
 * said, which is different from someone having checked and found no
 * relationship. Collapsing the two would assert something no one asserted.
 *
 * Lives outside the server-action file because a 'use server' module may only
 * export async functions.
 */
export const FAMILIARITIES = ['no_status', 'known', 'in_conversation', 'not_known'] as const;
export type Familiarity = (typeof FAMILIARITIES)[number];

export const FAMILIARITY_LABELS: Record<Familiarity, string> = {
  no_status: 'No status',
  known: 'Known',
  in_conversation: 'In conversation',
  not_known: 'Not known',
};

export const FAMILIARITY_HELP: Record<Familiarity, string> = {
  no_status: 'Nobody has said either way. The default, and not the same as having checked.',
  known: 'Engaged with a few times and known reasonably well.',
  in_conversation: 'Talking to them right now.',
  not_known: 'Checked — no real relationship here.',
};

/**
 * The values that mean EDB already knows the company, so a trigger there is not
 * a discovery. Nothing is hidden on this alone: a real trigger at a known
 * company still surfaces, it just belongs under account activity rather than
 * among companies EDB has yet to find.
 */
export const ENGAGED: Familiarity[] = ['known', 'in_conversation'];

export const isFamiliarity = (v: unknown): v is Familiarity =>
  typeof v === 'string' && (FAMILIARITIES as readonly string[]).includes(v);
