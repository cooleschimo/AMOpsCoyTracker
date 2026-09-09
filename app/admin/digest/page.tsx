/**
 * /admin/digest — approve the week's digest, then send it. Brief §10, §11, §13.
 *
 * The render has always worked; this is where somebody decides it should leave
 * the building. Two steps rather than one, because approval is a judgment about
 * the contents and sending is what makes it irreversible.
 *
 * The mode banner is the most important thing on the page. Whether mail is
 * confined to one test address or going to the real list is the difference
 * between a rehearsal and an event an RD reads, and it is decided by an
 * environment variable that nobody can see from here — so the page states it
 * outright, at the top, in the colour of what it means.
 */
import { getSql } from '../../../lib/db';
import { hasAdmin } from '../../../lib/auth';
import {
  listDigests, resolveRecipients, fromAddress, digestSubject,
} from '../../../lib/digest-send';
import { isTestMode } from '../../../lib/env';
import { approve, unapprove, send } from './actions';

export const dynamic = 'force-dynamic';

const MAIN = 'mx-auto max-w-[940px] px-5 pb-16 pt-7';
const H1 = 'font-display text-2xl font-semibold tracking-tight';
const SUB = 'mb-5 text-sm text-muted-foreground';
const H2 = 'mb-2.5 mt-6 text-xs font-bold uppercase tracking-[0.08em] text-primary';
const META = 'text-xs text-muted-foreground';
const CARD = 'mb-2 rounded-md border border-border bg-card px-3.5 py-3';
const BTN = 'cursor-pointer rounded-sm border border-primary bg-primary px-3.5 py-1.5 text-xs text-primary-foreground hover:bg-primary/90';
const BTN_QUIET = 'cursor-pointer rounded-sm border border-input bg-card px-3.5 py-1.5 text-xs hover:bg-secondary';
const LINK = 'text-primary link-underline hover:text-foreground';

const STATUS_HELP: Record<string, string> = {
  draft: 'Rendered and saved. Nothing has been approved or sent.',
  approved: 'Checked by a person and cleared to send. Not sent yet.',
  sent: 'Gone. A digest is sent once; re-sending is refused.',
};

export default async function DigestPage(
  { searchParams }: { searchParams: Promise<{ token?: string }> },
) {
  const sp = await searchParams;
  if (!(await hasAdmin(sp.token))) {
    return <main className={MAIN}><h1 className={H1}>Not authorised</h1>
      <p className={SUB}>Append <code>?token=…</code> with your ADMIN_TOKEN.</p></main>;
  }

  const rows = await listDigests();
  const who = resolveRecipients();
  const testMode = isTestMode();
  const token = sp.token ?? '';

  // How many companies each saved week actually placed, so a digest with
  // nothing in it is visible before it is approved rather than after.
  const sql = getSql();
  const counts: any = await sql`
    select week_of, cardinality(item_ids) as n from digests order by week_of desc limit 12`;
  const placed = new Map<string, number>(
    counts.map((c: any) => [new Date(c.week_of).toISOString().slice(0, 10), Number(c.n)]),
  );

  return (
    <main className={MAIN}>
      <h1 className={H1}>Weekly digest</h1>
      <p className={SUB}>
        Approve what the pipeline rendered, then send it. Approval and sending are separate
        steps: one is a judgment about the contents, the other cannot be taken back.
      </p>

      {/* The mode banner. Everything else on this page is reversible. */}
      <div
        className={`mb-5 rounded-md border px-3.5 py-3 ${
          testMode
            ? 'border-border bg-secondary'
            : 'border-primary bg-accent'
        }`}
      >
        <p className="text-sm font-semibold">
          {testMode ? 'Test mode — mail cannot reach the list' : 'LIVE — mail goes to the real recipients'}
        </p>
        <p className={`${META} mt-1`}>
          {who.ok ? who.why : `Nowhere to send: ${who.error}`}
          {' · from '}{fromAddress()}
        </p>
        <p className={`${META} mt-1`}>
          {testMode
            ? 'Set DIGEST_TEST_MODE=false in the environment to send to DIGEST_RECIPIENTS. It is not settable from here.'
            : 'DIGEST_TEST_MODE is off. Every send on this page reaches real inboxes.'}
        </p>
      </div>

      <h2 className={H2}>Saved weeks</h2>

      {rows.length === 0 ? (
        <p className={SUB}>
          Nothing saved yet. Run <code>npx tsx scripts/render-digest.ts --save</code> to
          render a week and record it as a draft.
        </p>
      ) : rows.map((r) => (
        <div key={r.weekOf} className={CARD}>
          <p className="mb-1 text-sm font-semibold">
            Week of {r.weekOf}
            <span className={META}>
              {' · '}{placed.get(r.weekOf) ?? r.itemIds.length} items placed
            </span>
          </p>
          <p className={META}>
            <b>{r.status}</b> — {STATUS_HELP[r.status] ?? ''}
          </p>
          {r.approvedAt ? (
            <p className={META}>Approved {r.approvedAt.toISOString().slice(0, 16).replace('T', ' ')}</p>
          ) : null}
          {r.sentAt ? (
            <p className={META}>
              Sent {r.sentAt.toISOString().slice(0, 16).replace('T', ' ')}
              {r.testMode ? ' — to the test recipient only' : ' — to the live list'}
            </p>
          ) : null}
          <p className={`${META} mt-1`}>
            Subject: {digestSubject(r.weekOf, testMode)}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {r.status === 'draft' ? (
              <form action={approve}>
                <input type="hidden" name="weekOf" value={r.weekOf} />
                <button type="submit" className={BTN}>Approve</button>
              </form>
            ) : null}

            {r.status === 'approved' ? (
              <>
                <form action={send}>
                  <input type="hidden" name="weekOf" value={r.weekOf} />
                  <button type="submit" className={BTN}>
                    {testMode ? 'Send to test recipient' : 'Send to the list'}
                  </button>
                </form>
                <form action={unapprove}>
                  <input type="hidden" name="weekOf" value={r.weekOf} />
                  <button type="submit" className={BTN_QUIET}>Back to draft</button>
                </form>
              </>
            ) : null}

            <a href={`/dashboard?token=${token}&week=${r.weekOf}`} className={LINK}>
              read this week on the dashboard
            </a>
          </div>
        </div>
      ))}

      <h2 className={H2}>From the command line</h2>
      <p className={META}>
        <code>npx tsx scripts/send-digest.ts --status</code> — what is saved and where it would go<br />
        <code>npx tsx scripts/send-digest.ts --preview</code> — write the mail body to <code>out/</code><br />
        <code>npx tsx scripts/send-digest.ts --send --dry</code> — resolve recipients and stop
      </p>
    </main>
  );
}
