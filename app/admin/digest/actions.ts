'use server';
/**
 * Approve and send the weekly digest from the browser. Brief §11.
 *
 * Approval is a decision and sending is its consequence, so they are two
 * buttons rather than one. Nothing here can send a draft: `sendDigest` checks
 * the state itself, and this page only decides which week it is asked about.
 *
 * Test mode is not settable from the UI. It is an environment variable, read
 * fresh on every send, precisely so reaching real recipients takes a deliberate
 * deployment change rather than a click by someone reading a dashboard.
 */
import { revalidatePath } from 'next/cache';
import { approveDigest, unapproveDigest, sendDigest, digestSubject } from '../../../lib/digest-send';
import { getWeeklyDigest } from '../../../lib/dashboard-data';
import { renderDigestEmail, renderDigestText } from '../../../lib/digest-email';
import { env, isTestMode } from '../../../lib/env';

const week = (f: FormData) => String(f.get('weekOf') ?? '').trim();

export async function approve(formData: FormData) {
  const weekOf = week(formData);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) return;
  await approveDigest(weekOf, 'admin_ui');
  revalidatePath('/admin/digest');
}

export async function unapprove(formData: FormData) {
  const weekOf = week(formData);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) return;
  await unapproveDigest(weekOf);
  revalidatePath('/admin/digest');
}

/**
 * The body is rendered here rather than stored at approval, so what goes out is
 * what the dashboard currently shows. The `digests` row records which items
 * were placed, which is what makes a sent digest reconstructable afterwards.
 */
export async function send(formData: FormData) {
  const weekOf = week(formData);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) return;

  const digest = await getWeeklyDigest(undefined, weekOf);
  const base = env.appBaseUrl();
  await sendDigest({
    weekOf,
    subject: digestSubject(weekOf, isTestMode()),
    html: renderDigestEmail(digest, base),
    text: renderDigestText(digest, base),
  });
  revalidatePath('/admin/digest');
}
