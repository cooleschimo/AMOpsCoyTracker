/**
 * Account status vocabulary. Brief §4.
 *
 * TRI-STATE BY DESIGN, and in fact five-state: whether EDB holds a relationship
 * is internal knowledge the tool cannot verify, so 'unknown' is the honest
 * default and must never be collapsed into "no relationship". A boolean here
 * would assert something nobody checked.
 *
 * Lives outside the server-action file because a 'use server' module may only
 * export async functions.
 */
export const ACCOUNT_STATUSES = [
  'unknown',
  'existing_account',
  'in_conversation',
  'not_an_account',
  'not_pursuing',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  unknown: 'Unknown',
  existing_account: 'Existing account',
  in_conversation: 'In conversation',
  not_an_account: 'Not an account',
  not_pursuing: 'Not pursuing',
};

export const ACCOUNT_STATUS_HELP: Record<AccountStatus, string> = {
  unknown: 'No record either way. The default — absence of a record is not evidence of no relationship.',
  existing_account: 'EDB already holds this account.',
  in_conversation: 'Active discussions right now. Surfacing this as a new discovery would be wrong.',
  not_an_account: 'Checked, and EDB does not hold this account. A fact about the relationship, not a decision about pursuing it — an unpursued company and an unheld one are different things.',
  not_pursuing: 'A deliberate decision not to pursue. Keeps the company out of featured slots without deleting it.',
};

/**
 * Statuses that mean "we already know about this company", used to label an
 * item rather than to hide it. Nothing is ever dropped on account status alone:
 * a real trigger at an existing account is still worth seeing, it just should
 * not read as a discovery.
 */
export const ENGAGED: AccountStatus[] = ['existing_account', 'in_conversation'];

export const isAccountStatus = (v: unknown): v is AccountStatus =>
  typeof v === 'string' && (ACCOUNT_STATUSES as readonly string[]).includes(v);
