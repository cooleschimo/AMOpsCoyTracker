/**
 * Who may reach the admin pages.
 *
 * The shared DASHBOARD_TOKEN and ADMIN_TOKEN gates are gone: every reader has
 * an account, so "may this browser look" collapsed into "who is this", and
 * `lib/session.ts` answers that. What remains is the narrower question of who
 * is an admin, plus the bearer check the two machine-facing API routes use.
 */
import { optional } from './env';
import { currentUser } from './session';

/**
 * An admin is a role on an account.
 *
 * The signature still takes an optional token so the admin pages did not all
 * need editing; it is ignored. A URL secret is no longer a way in.
 */
export async function hasAdmin(_searchParamToken?: string): Promise<boolean> {
  const me = await currentUser();
  return me?.role === 'admin';
}

/**
 * Bearer check for the machine-facing routes under /api/admin and /api/dev.
 *
 * These are called by scripts and GitHub Actions, which have no session and no
 * browser, so they keep a shared secret. It is a different thing from a person
 * signing in, and the token is never accepted from a page.
 */
export function checkAdminHeader(header: string | null): boolean {
  const expected = optional('ADMIN_TOKEN');
  if (!expected || !header) return false;
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : header;
  return timingSafeEqual(bearer, expected);
}

/** Constant-time compare so the token cannot be guessed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
