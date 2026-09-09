/**
 * Approving and sending the weekly digest. Brief §10, §13.
 *
 * The render has always worked; this is the half that decides when it leaves
 * the building. A digest moves through three states and never skips one:
 *
 *   draft  →  approved  →  sent
 *
 * `render-digest.ts --save` writes the draft. A person approves it. Only an
 * approved digest can be sent, and only once — `sent_at` is the record, and a
 * second send is refused rather than quietly duplicated in someone's inbox.
 *
 * TEST MODE IS THE DEFAULT AND STAYS THE DEFAULT. `DIGEST_TEST_MODE` is read as
 * true unless it literally says `false`, so every path here confines mail to
 * `DIGEST_TEST_RECIPIENT` until a person deliberately changes an environment
 * variable. The mode used is stored on the row rather than inferred later: a
 * digest sent in test mode and one sent to the list are different events, and a
 * fortnight afterwards nothing else can tell them apart.
 *
 * §13 requires the Outlook render be checked against a real address before this
 * is trusted, which is what test mode exists to make possible.
 */
import { Resend } from 'resend';
import { eq } from 'drizzle-orm';
import { getDb, getSql, withRetry } from './db';
import { digests } from './schema';
import { env, optional, isTestMode } from './env';

export type DigestStatus = 'draft' | 'approved' | 'sent';

export type DigestRow = {
  id: number;
  weekOf: string;
  itemIds: number[];
  status: DigestStatus;
  approvedAt: Date | null;
  sentAt: Date | null;
  testMode: boolean;
};

/**
 * Who the digest goes to when test mode is off.
 *
 * A comma-separated `DIGEST_RECIPIENTS`. Absent, there is no live list, and
 * `resolveRecipients` refuses rather than falling back to the test address —
 * silently sending a live digest to one developer would read as success.
 */
export function liveRecipients(): string[] {
  return optional('DIGEST_RECIPIENTS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The address a digest is sent from. Resend requires a verified domain; the
 * default is deliberately obvious so an unconfigured send fails at the API
 * rather than arriving from a plausible-looking address nobody owns.
 */
export function fromAddress(): string {
  return optional('DIGEST_FROM', 'digest@example.invalid');
}

export type Recipients =
  | { ok: true; to: string[]; testMode: boolean; why: string }
  | { ok: false; error: string };

/**
 * Who this send actually reaches.
 *
 * Both modes are refused rather than guessed at: test mode with no test
 * recipient, and live mode with no list. The failure a person can act on is
 * "nowhere to send it", where a fallback would produce a digest that looks sent
 * and reached the wrong people.
 */
export function resolveRecipients(): Recipients {
  const testMode = isTestMode();
  if (testMode) {
    const one = optional('DIGEST_TEST_RECIPIENT');
    if (!one) {
      return { ok: false, error: 'DIGEST_TEST_MODE is on and DIGEST_TEST_RECIPIENT is not set' };
    }
    return {
      ok: true, to: [one], testMode: true,
      why: `test mode: everything goes to ${one}`,
    };
  }
  const list = liveRecipients();
  if (!list.length) {
    return { ok: false, error: 'DIGEST_TEST_MODE is off and DIGEST_RECIPIENTS is empty' };
  }
  return {
    ok: true, to: list, testMode: false,
    why: `live: ${list.length} recipient${list.length === 1 ? '' : 's'}`,
  };
}

function toRow(r: any): DigestRow {
  return {
    id: Number(r.id),
    // A date column arrives as a Date, whose toString is a local timestamp.
    weekOf: new Date(r.week_of).toISOString().slice(0, 10),
    itemIds: (r.item_ids ?? []) as number[],
    status: String(r.status) as DigestStatus,
    approvedAt: r.approved_at ? new Date(r.approved_at) : null,
    sentAt: r.sent_at ? new Date(r.sent_at) : null,
    testMode: Boolean(r.test_mode),
  };
}

export async function getDigest(weekOf: string): Promise<DigestRow | null> {
  const rows: any = await getSql()`
    select id, week_of, item_ids, status, approved_at, sent_at, test_mode
    from digests where week_of = ${weekOf} limit 1`;
  return rows.length ? toRow(rows[0]) : null;
}

export async function listDigests(limit = 12): Promise<DigestRow[]> {
  const rows: any = await getSql()`
    select id, week_of, item_ids, status, approved_at, sent_at, test_mode
    from digests order by week_of desc limit ${limit}`;
  return rows.map(toRow);
}

/**
 * Approve a draft.
 *
 * Approving an already-approved digest is a no-op rather than an error — two
 * people clicking the same button should not produce a failure — but a sent one
 * is refused, since approval after the fact means nothing.
 */
export async function approveDigest(
  weekOf: string, by: string,
): Promise<{ ok: boolean; error?: string; row?: DigestRow }> {
  const row = await getDigest(weekOf);
  if (!row) return { ok: false, error: `no digest saved for ${weekOf}` };
  if (row.status === 'sent') return { ok: false, error: `${weekOf} was already sent` };
  if (row.status === 'approved') return { ok: true, row };

  const db = getDb();
  await withRetry(() => db.update(digests)
    .set({ status: 'approved', approvedAt: new Date() })
    .where(eq(digests.weekOf, weekOf)));
  return { ok: true, row: (await getDigest(weekOf))! };
}

/** Return an approved digest to draft, so a bad week can be re-rendered. */
export async function unapproveDigest(
  weekOf: string,
): Promise<{ ok: boolean; error?: string }> {
  const row = await getDigest(weekOf);
  if (!row) return { ok: false, error: `no digest saved for ${weekOf}` };
  if (row.status === 'sent') return { ok: false, error: `${weekOf} was already sent` };
  const db = getDb();
  await withRetry(() => db.update(digests)
    .set({ status: 'draft', approvedAt: null })
    .where(eq(digests.weekOf, weekOf)));
  return { ok: true };
}

export type SendResult = {
  ok: boolean;
  error?: string;
  to?: string[];
  testMode?: boolean;
  providerId?: string;
};

/**
 * Send an approved digest.
 *
 * The order matters. Everything that can be checked without side effects is
 * checked first — the row exists, it is approved, it has not been sent,
 * recipients resolve — because past the Resend call the mail is gone and a
 * failure to record it is the worse of the two errors. `sent_at` is written
 * immediately after the provider accepts it.
 *
 * A send that the provider rejects leaves the row `approved`, so it can be
 * retried once the cause is fixed.
 */
export async function sendDigest(opts: {
  weekOf: string;
  subject: string;
  html: string;
  text: string;
  /** Resolve and check everything, then stop before the provider call. */
  dryRun?: boolean;
}): Promise<SendResult> {
  const row = await getDigest(opts.weekOf);
  if (!row) return { ok: false, error: `no digest saved for ${opts.weekOf}` };
  if (row.status === 'draft') {
    return { ok: false, error: `${opts.weekOf} is a draft — approve it first` };
  }
  if (row.status === 'sent' || row.sentAt) {
    return { ok: false, error: `${opts.weekOf} was already sent at ${row.sentAt?.toISOString()}` };
  }

  const who = resolveRecipients();
  if (!who.ok) return { ok: false, error: who.error };

  if (opts.dryRun) {
    return { ok: true, to: who.to, testMode: who.testMode };
  }

  let providerId: string | undefined;
  try {
    const resend = new Resend(env.resendApiKey());
    const res = await resend.emails.send({
      from: fromAddress(),
      to: who.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    if (res.error) return { ok: false, error: `${res.error.name}: ${res.error.message}` };
    providerId = res.data?.id;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const db = getDb();
  await withRetry(() => db.update(digests)
    .set({ status: 'sent', sentAt: new Date(), testMode: who.testMode })
    .where(eq(digests.weekOf, opts.weekOf)));

  return { ok: true, to: who.to, testMode: who.testMode, providerId };
}

/** "FDI signals — week of 31 August 2026". The week is what a reader scans for. */
/**
 * The subject line.
 *
 * "Last week" rather than a date, because that is how the reader thinks about
 * what they are opening on a Monday morning — the date is in the mail itself,
 * and a subject that leads with one reads as an archive rather than as this
 * week's post. The span is kept alongside it so a mail found in March still
 * says which week it covered.
 */
export function digestSubject(weekOf: string, testMode: boolean): string {
  const d = new Date(`${weekOf}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return `${testMode ? '[TEST] ' : ''}FDI signals — ${weekOf}`;
  const end = new Date(d.getTime() + 6 * 86400_000);
  const fmt = (x: Date, o: Intl.DateTimeFormatOptions) =>
    x.toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
  const sameMonth = d.getUTCMonth() === end.getUTCMonth();
  const from = sameMonth ? fmt(d, { day: 'numeric' }) : fmt(d, { day: 'numeric', month: 'short' });
  const span = `${from}–${fmt(end, { day: 'numeric', month: 'short' })}`;
  return `${testMode ? '[TEST] ' : ''}FDI signals — last week (${span})`;
}
