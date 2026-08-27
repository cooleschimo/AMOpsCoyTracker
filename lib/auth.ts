/**
 * Token gates. Brief §11 and §14: this is NOT authentication.
 *
 * /admin/* is gated by ADMIN_TOKEN and the dashboard by DASHBOARD_TOKEN. Both
 * are shared secrets in a URL or cookie — anyone holding the link has full
 * access. Real auth is explicitly out of scope for the MVP; the README says so
 * plainly, and so does this comment, because the next person to read it needs
 * to know before they expose anything sensitive.
 */
import { cookies } from 'next/headers';
import { optional } from './env';

export async function hasAdmin(searchParamToken?: string): Promise<boolean> {
  const expected = optional('ADMIN_TOKEN');
  if (!expected) return false;
  if (searchParamToken && timingSafeEqual(searchParamToken, expected)) return true;
  const jar = await cookies();
  const c = jar.get('admin_token')?.value;
  return !!c && timingSafeEqual(c, expected);
}

/**
 * Dashboard gate. A SHARED token, not a person — §7a removed recipient identity
 * entirely, so whoever holds the link can read and react, and reactions key on
 * an anonymous per-browser voter_key rather than an account.
 */
export async function hasDashboard(searchParamToken?: string): Promise<boolean> {
  const expected = optional('DASHBOARD_TOKEN');
  if (!expected) return false;
  if (searchParamToken && timingSafeEqual(searchParamToken, expected)) return true;
  const jar = await cookies();
  const c = jar.get('dashboard_token')?.value;
  if (c && timingSafeEqual(c, expected)) return true;
  // An admin token opens the dashboard too: admin is the strictly wider role.
  return hasAdmin(searchParamToken);
}

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
