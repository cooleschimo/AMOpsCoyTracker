'use server';
/**
 * Account writes: the two things a person changes about themselves.
 *
 * Separate from app/actions.ts, which records judgments about companies. These
 * act on the reader rather than on the data, and every one of them re-reads the
 * session server-side rather than trusting an id from the form — a user id in a
 * submitted field is a request to edit whoever that id names.
 */
import { revalidatePath } from 'next/cache';
import { currentUser, changeName, changePassword } from '../../lib/session';

export type FormState = { error: string } | { ok: string } | null;

export async function changeNameAction(
  _prev: FormState, formData: FormData,
): Promise<FormState> {
  const me = await currentUser();
  if (!me) return { error: 'Sign in first.' };

  const res = await changeName(me.id, String(formData.get('name') ?? ''));
  if (!res.ok) return { error: res.error };

  // The name appears beside everything this person monitors.
  revalidatePath('/account');
  revalidatePath('/monitoring');
  revalidatePath('/');
  return { ok: 'Name updated.' };
}

export async function changePasswordAction(
  _prev: FormState, formData: FormData,
): Promise<FormState> {
  const me = await currentUser();
  if (!me) return { error: 'Sign in first.' };

  const current = String(formData.get('current') ?? '');
  const next = String(formData.get('next') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (next !== confirm) return { error: 'The two new passwords are different.' };

  const res = await changePassword(me.id, current, next);
  if (!res.ok) return { error: res.error };

  return { ok: 'Password changed. Any other browser signed in as you has been signed out.' };
}
