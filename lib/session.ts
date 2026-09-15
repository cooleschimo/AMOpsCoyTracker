/**
 * Accounts and sessions.
 *
 * This supersedes the position in DESIGN_RATIONALE §7a, which removed recipient
 * identity on the reasoning that at four readers nobody needed to know who
 * reacted. §7a named the cost it accepted — "the dashboard cannot show a person
 * their own past reactions across devices" — and called the decision reversible.
 * A team that wants to see who is looking at what is exactly the case it
 * anticipated, so identity comes back here rather than being worked around.
 *
 * `lib/auth.ts` keeps the shared-token gates. They are a different thing and
 * still useful: a token says whether a browser may see the dashboard at all, a
 * session says which person is reading it. A guest holds the first and not the
 * second.
 *
 * Passwords are scrypt with a per-row salt, stored `salt:hash`. No dependency:
 * node:crypto has scrypt, and a password library would be more surface than the
 * thing it replaces.
 */
import { cookies } from 'next/headers';
import { randomBytes, scrypt, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getSql } from './db';

const scryptAsync = promisify(scrypt) as (
  password: string, salt: string, keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'session';

/** Long enough that a week's reading does not ask for a password twice. */
const SESSION_DAYS = 30;
/** An invite that is never used should not stay usable forever. */
const INVITE_DAYS = 14;

export type Role = 'member' | 'admin';

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: Role;
};

/**
 * Who is reading, or null for a guest.
 *
 * Null is the ordinary case rather than an error: someone holding the shared
 * dashboard link and no account is a guest, and the pages decide what a guest
 * may see. Callers must treat null as "not permitted" for anything that acts.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return userForToken(token);
}

/** The same lookup, for callers that hold the token rather than the cookie. */
export async function userForToken(token: string): Promise<SessionUser | null> {
  const sql = getSql();
  const rows: any = await sql`
    select u.id, u.email, u.name, u.role
      from sessions s join users u on u.id = s.user_id
     where s.token = ${token} and s.expires_at > now()
     limit 1`;
  const u = rows[0];
  if (!u) return null;
  return {
    id: Number(u.id),
    email: String(u.email),
    name: String(u.name),
    role: u.role === 'admin' ? 'admin' : 'member',
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const key = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  // Lengths must match before timingSafeEqual, which throws on a mismatch.
  if (expected.length !== key.length) return false;
  return nodeTimingSafeEqual(expected, key);
}

/** Start a session and set the cookie. Returns the token for tests. */
export async function createSession(userId: number): Promise<string> {
  const sql = getSql();
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await sql`
    insert into sessions (token, user_id, expires_at)
    values (${token}, ${userId}, ${expires.toISOString()})`;
  await sql`update users set last_seen_at = now() where id = ${userId}`;

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
    secure: process.env.NODE_ENV === 'production',
  });
  return token;
}

/**
 * End the session server-side as well as in the browser.
 *
 * Clearing only the cookie would leave a working token in the table, which is
 * the difference between logging out and hiding the key.
 */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const sql = getSql();
    await sql`delete from sessions where token = ${token}`;
  }
  jar.delete(SESSION_COOKIE);
}

export type Invite = { email: string; name: string | null; role: Role };

/** Create an invite and return its token. The caller builds the URL. */
export async function createInvite(
  email: string, name: string | null, role: Role = 'member',
): Promise<string> {
  const sql = getSql();
  const token = randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + INVITE_DAYS * 86400_000);
  await sql`
    insert into invites (token, email, name, role, expires_at)
    values (${token}, ${email.trim().toLowerCase()}, ${name}, ${role}, ${expires.toISOString()})`;
  return token;
}

/** The invite behind a token, or null if it is unknown, used or expired. */
export async function inviteForToken(token: string): Promise<Invite | null> {
  const sql = getSql();
  const rows: any = await sql`
    select email, name, role from invites
     where token = ${token} and used_at is null and expires_at > now()
     limit 1`;
  const i = rows[0];
  if (!i) return null;
  return {
    email: String(i.email),
    name: (i.name as string | null) ?? null,
    role: i.role === 'admin' ? 'admin' : 'member',
  };
}

export type SignUpResult =
  | { ok: true; userId: number }
  | { ok: false; error: string };

/**
 * Create the account an invite was issued for.
 *
 * The email comes from the invite rather than the form, so forwarding a link
 * cannot create an account under a different address. The invite is stamped
 * used in the same statement that reads it, so two submissions of the same link
 * cannot both produce an account.
 */
export async function signUpWithInvite(
  token: string, name: string, password: string,
): Promise<SignUpResult> {
  if (password.length < 10) {
    return { ok: false, error: 'Password must be at least 10 characters.' };
  }
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Name is required.' };

  const sql = getSql();
  // Claim the invite first. If this returns nothing the link was already used,
  // expired, or never existed, and no account is created.
  const claimed: any = await sql`
    update invites set used_at = now()
     where token = ${token} and used_at is null and expires_at > now()
     returning email, role`;
  const invite = claimed[0];
  if (!invite) return { ok: false, error: 'This invite is no longer valid.' };

  const email = String(invite.email).trim().toLowerCase();
  const existing: any = await sql`select id from users where lower(email) = ${email} limit 1`;
  if (existing.length) return { ok: false, error: 'An account already exists for this address.' };

  const passwordHash = await hashPassword(password);
  const rows: any = await sql`
    insert into users (email, name, password_hash, role)
    values (${email}, ${trimmed}, ${passwordHash}, ${invite.role})
    returning id`;
  return { ok: true, userId: Number(rows[0].id) };
}

export type SignInResult = { ok: true; userId: number } | { ok: false; error: string };

/**
 * Check an email and password.
 *
 * One message for both a missing account and a wrong password, so the form
 * cannot be used to find out which addresses have accounts.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const sql = getSql();
  const rows: any = await sql`
    select id, password_hash from users where lower(email) = ${email.trim().toLowerCase()} limit 1`;
  const u = rows[0];
  if (!u) {
    // Spend comparable time on a miss so the response time does not answer the
    // question the message refuses to.
    await hashPassword(password);
    return { ok: false, error: 'Email or password is not right.' };
  }
  const good = await verifyPassword(password, String(u.password_hash));
  if (!good) return { ok: false, error: 'Email or password is not right.' };
  return { ok: true, userId: Number(u.id) };
}

/** An hour. A reset link is used within minutes or it is not the owner using it. */
const RESET_HOURS = 1;

/**
 * End every session for a user except, optionally, the one being kept.
 *
 * Called whenever a password changes. The point is not tidiness: if the reason
 * for the change is that somebody else knows the old password, leaving their
 * session alive means the change accomplished nothing.
 */
export async function revokeSessions(userId: number, keepToken?: string): Promise<void> {
  const sql = getSql();
  if (keepToken) {
    await sql`delete from sessions where user_id = ${userId} and token <> ${keepToken}`;
  } else {
    await sql`delete from sessions where user_id = ${userId}`;
  }
}

export type ChangeResult = { ok: true } | { ok: false; error: string };

/**
 * Change a password from inside a session.
 *
 * The current password is required even though the session already proves who
 * is asking: a borrowed or forgotten-unlocked laptop would otherwise be a
 * permanent account takeover rather than a temporary one.
 */
export async function changePassword(
  userId: number, current: string, next: string,
): Promise<ChangeResult> {
  if (next.length < 10) return { ok: false, error: 'New password must be at least 10 characters.' };

  const sql = getSql();
  const rows: any = await sql`select password_hash from users where id = ${userId} limit 1`;
  const u = rows[0];
  if (!u) return { ok: false, error: 'Account not found.' };
  if (!(await verifyPassword(current, String(u.password_hash)))) {
    return { ok: false, error: 'Current password is not right.' };
  }

  const hash = await hashPassword(next);
  await sql`update users set password_hash = ${hash} where id = ${userId}`;

  // Keep this browser signed in, drop the rest.
  const jar = await cookies();
  await revokeSessions(userId, jar.get(SESSION_COOKIE)?.value);
  return { ok: true };
}

/** Change the name shown beside what you monitor. */
export async function changeName(userId: number, name: string): Promise<ChangeResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Name cannot be empty.' };
  const sql = getSql();
  await sql`update users set name = ${trimmed} where id = ${userId}`;
  return { ok: true };
}

/**
 * Begin a reset. Returns the token, or null when no account matches.
 *
 * The caller must not tell the form which it was: saying "no such account"
 * turns a public form into a way to find out who has an account.
 */
export async function beginPasswordReset(email: string): Promise<
  { token: string; user: { id: number; email: string; name: string } } | null
> {
  const sql = getSql();
  const rows: any = await sql`
    select id, email, name from users where lower(email) = ${email.trim().toLowerCase()} limit 1`;
  const u = rows[0];
  if (!u) return null;

  // One live link at a time: an older one still working after a new request is
  // a token the owner has stopped tracking.
  await sql`update password_resets set used_at = now()
             where user_id = ${u.id} and used_at is null`;

  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + RESET_HOURS * 3600_000);
  await sql`
    insert into password_resets (token, user_id, expires_at)
    values (${token}, ${u.id}, ${expires.toISOString()})`;
  return { token, user: { id: Number(u.id), email: String(u.email), name: String(u.name) } };
}

/** Is this reset token still good? Returns the account's name for the form. */
export async function resetForToken(token: string): Promise<{ name: string } | null> {
  const sql = getSql();
  const rows: any = await sql`
    select u.name from password_resets r join users u on u.id = r.user_id
     where r.token = ${token} and r.used_at is null and r.expires_at > now()
     limit 1`;
  return rows[0] ? { name: String(rows[0].name) } : null;
}

/**
 * Finish a reset.
 *
 * The token is spent in the same statement that reads it, so a link submitted
 * twice cannot set the password twice. Every session is revoked, including any
 * the attacker may hold — this path exists precisely because the owner may have
 * lost control of the old password.
 */
export async function completePasswordReset(
  token: string, password: string,
): Promise<ChangeResult> {
  if (password.length < 10) {
    return { ok: false, error: 'Password must be at least 10 characters.' };
  }
  const sql = getSql();
  const claimed: any = await sql`
    update password_resets set used_at = now()
     where token = ${token} and used_at is null and expires_at > now()
     returning user_id`;
  const row = claimed[0];
  if (!row) return { ok: false, error: 'This link has expired. Ask for another.' };

  const userId = Number(row.user_id);
  const hash = await hashPassword(password);
  await sql`update users set password_hash = ${hash} where id = ${userId}`;
  await revokeSessions(userId);
  return { ok: true };
}
