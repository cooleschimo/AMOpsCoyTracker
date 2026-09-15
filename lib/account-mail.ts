/**
 * Mail sent to a person about their own account.
 *
 * Kept apart from lib/digest-send.ts, which sends the weekly digest: that path
 * records sends against a `digests` row and resolves a recipient list from
 * config, neither of which applies to a message addressed to one person who
 * just asked for it.
 *
 * Plain text as well as HTML. A reset link that arrives as an unclickable blob
 * in a text-only client is a locked-out user.
 */
import { Resend } from 'resend';
import { env, optional } from './env';
import { fromAddress } from './digest-send';

export type MailResult = { ok: true } | { ok: false; error: string };

function baseUrl(): string {
  return (optional('APP_BASE_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * Send a reset link.
 *
 * A failure is returned rather than swallowed. The form above this deliberately
 * tells the reader nothing about whether an account exists, but the operator
 * needs to know when mail is not going out — a reset flow that silently fails
 * is indistinguishable from one nobody uses.
 */
export async function sendPasswordReset(
  to: string, name: string, token: string,
): Promise<MailResult> {
  const url = `${baseUrl()}/reset/${token}`;
  const subject = 'Reset your AM News password';

  const text = [
    `Hello ${name},`,
    '',
    'Someone asked to reset the password on your AM News account.',
    'Open this link within the hour to choose a new one:',
    '',
    url,
    '',
    'If that was not you, nothing has changed and you can ignore this.',
  ].join('\n');

  const html = `
    <div style="font:15px/1.6 ui-sans-serif,system-ui,sans-serif;color:#1a1a18;max-width:32rem">
      <p>Hello ${escapeHtml(name)},</p>
      <p>Someone asked to reset the password on your AM News account.
         Open this link within the hour to choose a new one:</p>
      <p><a href="${url}" style="color:#1a1a18">${url}</a></p>
      <p style="color:#6b6b64">If that was not you, nothing has changed and you can
         ignore this message.</p>
    </div>`;

  try {
    const resend = new Resend(env.resendApiKey());
    const res = await resend.emails.send({
      from: fromAddress(), to: [to], subject, html, text,
    });
    if (res.error) return { ok: false, error: `${res.error.name}: ${res.error.message}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** The name is the account holder's own, but it still renders into HTML. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
