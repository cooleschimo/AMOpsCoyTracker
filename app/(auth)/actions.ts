'use server';
/**
 * Sign up, sign in, sign out.
 *
 * Separate from app/actions.ts because these run before there is a session,
 * where everything there assumes one. Each returns a message rather than
 * throwing: a failed sign-in is an ordinary outcome and the form has to be able
 * to say so.
 */
import { redirect } from 'next/navigation';
import {
  beginPasswordReset, completePasswordReset, createGuestSession, createSession,
  endSession, signIn as check, signUpWithInvite,
} from '../../lib/session';
import { sendPasswordReset } from '../../lib/account-mail';

/**
 * Either outcome a form can report.
 *
 * `ok` exists for the reset request, which succeeds without navigating: it
 * deliberately says the same thing whether or not an account matched, so there
 * is nowhere to redirect to and the message is the whole result.
 */
export type FormState = { error: string } | { ok: string } | null;

export async function signUpAction(
  _prev: FormState, formData: FormData,
): Promise<FormState> {
  const token = String(formData.get('token') ?? '');
  const name = String(formData.get('name') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password !== confirm) return { error: 'The two passwords are different.' };

  const res = await signUpWithInvite(token, name, password);
  if (!res.ok) return { error: res.error };

  await createSession(res.userId);
  // Outside the try/catch shape of the rest: redirect throws by design in the
  // App Router, and catching it here would swallow the navigation.
  redirect('/');
}

export async function signInAction(
  _prev: FormState, formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Email and password are both needed.' };

  const res = await check(email, password);
  if (!res.ok) return { error: res.error };

  await createSession(res.userId);
  redirect('/');
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect('/login');
}

/**
 * Ask for a reset link.
 *
 * The same answer either way. Telling the reader that no account matches would
 * make this form a way to find out who has one, and the person who mistyped
 * their address is better served by a second attempt than everyone else is
 * harmed by a membership oracle.
 *
 * A send failure is logged rather than shown, for the same reason — but it IS
 * logged, because a reset flow that quietly fails looks exactly like one nobody
 * uses.
 */
export async function forgotAction(
  _prev: FormState, formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Enter the address you signed up with.' };

  const started = await beginPasswordReset(email);
  if (started) {
    const sent = await sendPasswordReset(
      started.user.email, started.user.name, started.token,
    );
    if (!sent.ok) console.error(`[reset] send failed for ${started.user.email}: ${sent.error}`);
  }
  return { ok: 'If that address has an account, a link is on its way.' };
}

export async function resetAction(
  _prev: FormState, formData: FormData,
): Promise<FormState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password !== confirm) return { error: 'The two passwords are different.' };

  const res = await completePasswordReset(token, password);
  if (!res.ok) return { error: res.error };

  // Deliberately not signed in here. Every session was just revoked, including
  // any an attacker held, and signing the browser straight back in would make
  // the reset indistinguishable from the thing it defends against.
  redirect('/login?reset=1');
}

/**
 * Look around without an account.
 *
 * A real action rather than a link, because admission is now a row in the
 * database rather than a secret in a URL. The guest reads the week and nothing
 * else: monitoring, dismissals, the per-card actions and Singapore's
 * proposition all check `currentUser()`, which stays null here.
 */
export async function continueAsGuestAction(): Promise<void> {
  await createGuestSession();
  redirect('/');
}
