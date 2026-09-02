/**
 * /item/[id] — the item review page the digest's [Review] link opens.
 * Brief §10, §11.
 *
 * WHY REACTIONS LIVE HERE AND NOT IN THE EMAIL (§10): government mail security
 * rewrites and PRE-FETCHES urls, which would fabricate a vote the moment the
 * digest is delivered. A link that only opens a page is safe to prefetch; a
 * link that records a vote is not.
 *
 * The duplicate-outreach warning (§11) is the other reason this page exists:
 * before an RD acts, they should see whether someone already owns this company.
 */
import { getSql } from '../../../lib/db';
import { hasDashboard } from '../../../lib/auth';
import { SectionHeading } from '@/components/primitives';
import { recordDisposition } from './actions';
import { REASONS, REASON_LABELS } from '../../../lib/dispositions';

export const dynamic = 'force-dynamic';

/* Shared class strings. The page is a reading column rather than the dashboard's
   card grid, so it keeps its own narrow measure. */
const MAIN = 'mx-auto max-w-[760px] px-5 pb-16 pt-7';
const CARD = 'mb-2.5 rounded-md border border-border bg-card px-4 py-3.5';
const META = 'my-1 text-xs text-muted-foreground';
const BODY = 'mb-2 text-sm';
const LINK = 'text-primary link-underline hover:text-foreground';
/* Caution notice — a fact recorded by a person, or a prior call being replaced. */
const CAUTION = 'mb-3.5 rounded-md border border-caution/30 bg-caution-soft px-3 py-2.5 text-2xs text-caution';
/* Duplicate-outreach warning: the one thing on the page that must stop an RD. */
const WARN = 'mb-3.5 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-2xs text-destructive';
const BTN = 'mr-2 cursor-pointer rounded-md border border-primary bg-primary px-4 py-2.5 text-sm text-primary-foreground hover:bg-primary/90';
const BTN_ALT = 'mr-2 cursor-pointer rounded-md border border-border bg-card px-4 py-2.5 text-sm text-foreground hover:bg-muted';

export default async function ItemPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> },
) {
  const { id } = await params;
  const sp = await searchParams;
  if (!(await hasDashboard(sp.token))) {
    return <main className={MAIN}><h1 className="mb-1.5 font-display text-2xl font-semibold tracking-tight">Not authorised</h1>
      <p className={BODY}>Append <code>?token=…</code> with your DASHBOARD_TOKEN.</p></main>;
  }

  const itemId = Number(id);
  if (!Number.isFinite(itemId)) return <main className={MAIN}><h1 className="mb-1.5 font-display text-2xl font-semibold tracking-tight">Not found</h1></main>;

  const sql = getSql();
  const [it]: any = await sql`
    select i.*, c.name as company_name, c.id as cid, c.familiarity, c.sectors,
           s.score, s.momentum, s.signal_type, s.why, s.expansion_language, s.rubric_version, s.model
    from items i
    left join companies c on c.id = i.company_id
    left join scores s on s.item_id = i.id
    where i.id = ${itemId}
    order by s.scored_at desc limit 1`;
  if (!it) return <main className={MAIN}><h1 className="mb-1.5 font-display text-2xl font-semibold tracking-tight">Not found</h1></main>;

  const [cluster, existingOpp, priorDisposition, assessment, related, jobs, funding]: any = await Promise.all([
    sql`select id, title, source from items where cluster_id = ${itemId} and id <> ${itemId} limit 12`,
    it.cid ? sql`select id, owner, status, next_action, created_at from opportunities
                 where company_id = ${it.cid} and status not in ('closed','dropped')
                 order by created_at limit 1` : Promise.resolve([]),
    sql`select disposition, reasons, note from dispositions where item_id = ${itemId} limit 1`,
    it.cid ? sql`select target_priority, singapore_fit, potential_contribution, confidence, rationale
                 from company_assessments where company_id = ${it.cid}
                 order by assessed_at desc limit 1` : Promise.resolve([]),
    // OTHER activity at this company — the point of clicking through from
    // Trending is to see whether one headline is part of a pattern.
    // Latest score per item: a plain join returns the same article once per
    // rubric version, so one headline appeared several times in this list.
    it.cid ? sql`select i2.id, i2.title, i2.source, i2.published_at, i2.source_type,
                        s2.score, s2.momentum, s2.signal_type
                 from items i2
                 join lateral (
                   select score, momentum, signal_type from scores sc
                   where sc.item_id = i2.id
                   order by sc.scored_at desc nulls last, sc.id desc limit 1
                 ) s2 on true
                 where i2.company_id = ${it.cid} and i2.id <> ${itemId} and i2.status = 'kept'
                 order by s2.momentum desc nulls last, i2.published_at desc nulls last
                 limit 10` : Promise.resolve([]),
    it.cid ? sql`select total_jobs, non_us_jobs, apac_jobs, snapshot_at
                 from job_snapshots where company_id = ${it.cid}
                 order by snapshot_at desc limit 2` : Promise.resolve([]),
    it.cid ? sql`select form_type, filed_at, amount, security_type
                 from sec_filings where company_id = ${it.cid}
                 order by filed_at desc limit 3` : Promise.resolve([]),
  ]);

  const a = assessment[0];
  const prior = priorDisposition[0];

  return (
    <main className={MAIN}>
      <p className={META}>
        {it.company_name ? <a href={`/company/${it.cid}`} className={LINK}>{it.company_name}</a> : 'Unmatched company'}
        {' · '}{it.source}
        {it.published_at ? ` · ${new Date(it.published_at).toISOString().slice(0, 10)}` : ''}
      </p>
      <h1 className="mb-1.5 font-display text-2xl font-semibold leading-tight tracking-tight">{it.title}</h1>
      <p className={BODY}><a href={it.url} className={LINK}>Open the source</a></p>

      {/* Duplicate-outreach warning (§11): who already owns this, and since when. */}
      {existingOpp.length ? (
        <p className={WARN}>
          <b>This company already has an open opportunity</b>
          {existingOpp[0].owner ? ` owned by ${existingOpp[0].owner}` : ' with no owner recorded'}
          {` since ${new Date(existingOpp[0].created_at).toISOString().slice(0, 10)}`}
          {existingOpp[0].next_action ? ` · next action: ${existingOpp[0].next_action}` : ''}.
          Check before making contact.
        </p>
      ) : null}

      {it.familiarity && it.familiarity !== 'unknown' ? (
        <p className={CAUTION}>Account status: <b>{it.familiarity}</b> — recorded by a person, not derived by the tool.</p>
      ) : null}

      {/* ---- Why it surfaced ---- */}
      <div className="mb-2.5 mt-6"><SectionHeading title="Why it surfaced" /></div>
      <div className={CARD}>
        <p className={BODY}><b>Why now:</b> {it.why ?? 'not scored'}</p>
        <p className={BODY}>
          <b>Signal:</b> {it.signal_type ?? '—'} · score {it.score ?? '—'}
          {it.expansion_language ? ' · uses expansion language' : ' · no expansion language in the text'}
        </p>
        {a ? (
          <p className={BODY}>
            <b>Company:</b> {a.target_priority} priority · Singapore fit {a.singapore_fit} ·
            {' '}contribution {a.potential_contribution} ({a.confidence} confidence)
          </p>
        ) : <p className={BODY}><b>Company:</b> not assessed</p>}
        <p className={META}>{it.rubric_version} · {it.model}</p>
      </div>
      {it.snippet ? <p className={BODY}>{it.snippet}</p> : null}

      {cluster.length ? (
        <>
          <div className="mb-2.5 mt-6"><SectionHeading title={`Also reported by (${cluster.length})`} /></div>
          {cluster.map((c: any) => (
            <p key={c.id} className={META}>{c.source} — {c.title}</p>
          ))}
        </>
      ) : null}

      {/* ---- Momentum: why this ranked in Trending ---- */}
      {it.momentum !== null && it.momentum !== undefined ? (
        <>
          <div className="mb-2.5 mt-6"><SectionHeading title="Momentum" /></div>
          <div className={CARD}>
            <p className={BODY}>
              <b className="num">{it.momentum}/3</b> — how fast this company is moving, judged separately from
              whether a location decision is in play.
            </p>
            <p className={META}>
              Carried by {cluster.length + 1} outlet{cluster.length ? 's' : ''}
              {jobs.length ? ` · ${jobs[0].total_jobs} open roles, ${jobs[0].apac_jobs} in APAC` : ''}
              {jobs.length > 1 ? ` (was ${jobs[1].total_jobs} last snapshot)` : ''}
              {funding.length ? ` · latest filing ${funding[0].form_type} ${funding[0].filed_at}` : ''}
            </p>
          </div>
        </>
      ) : null}

      {/* ---- The rest of what is happening at this company ---- */}
      {related.length ? (
        <>
          <div className="mb-2.5 mt-6">
            <SectionHeading title={`Other activity at ${it.company_name} (${related.length})`} />
          </div>
          {related.map((r: any) => (
            <div key={r.id} className={CARD}>
              <p className={BODY}>
                <a href={`/item/${r.id}?token=${sp.token ?? ''}`} className={LINK}>{r.title}</a>
              </p>
              <p className={META}>
                {r.signal_type} · score {r.score}
                {r.momentum !== null ? ` · momentum ${r.momentum}/3` : ''}
                {r.source_type === 'ats' ? ' · job board' : ` · ${r.source}`}
                {r.published_at ? ` · ${new Date(r.published_at).toISOString().slice(0, 10)}` : ''}
              </p>
            </div>
          ))}
          <p className={META}>
            <a href={`/company/${it.cid}?token=${sp.token ?? ''}`} className={LINK}>
              Full connection view for {it.company_name} →
            </a>
          </p>
        </>
      ) : null}

      {/* ---- Disposition ---- */}
      <div className="mb-2.5 mt-6"><SectionHeading title="Your call" /></div>
      {prior ? (
        <p className={CAUTION}>
          Recorded from this browser: <b>{prior.disposition.replace(/_/g, ' ')}</b>
          {prior.reasons?.length ? ` (${prior.reasons.map((r: string) => (REASON_LABELS as Record<string, string>)[r] ?? r).join(', ')})` : ''}.
          Submitting again replaces it.
        </p>
      ) : null}

      <form action={recordDisposition}>
        <input type="hidden" name="itemId" value={itemId} />
        {it.cid ? <input type="hidden" name="companyId" value={it.cid} /> : null}

        <div className={CARD}>
          <p className={BODY}><b>Reasons</b> — optional for Draft an email and Monitor, please give one for Dismiss.</p>
          {REASONS.map((r) => (
            <label key={r} className="mb-1.5 mr-3.5 inline-block text-2xs">
              <input type="checkbox" name={`reason_${r}`} /> {REASON_LABELS[r]}
            </label>
          ))}
          <p className="mt-2.5">
            <textarea name="note" rows={2} placeholder="Anything worth recording (optional)"
              className="w-full rounded-md border border-input bg-card p-2 font-sans text-2xs" />
          </p>
        </div>

        <button type="submit" name="disposition" value="draft_email" className={BTN}>Draft an email</button>
        <button type="submit" name="disposition" value="monitor" className={BTN_ALT}>Monitor</button>
        <button type="submit" name="disposition" value="dismiss" className={BTN_ALT}>Dismiss</button>
      </form>

      <p className={`${META} mt-4`}>
        Reactions are anonymous. Nothing here records who you are — a per-browser key
        deduplicates repeat clicks and that is all.
      </p>
      <p className={META}>
        Draft an email opens an opportunity with no owner or due date required. Monitor watches
        for what the company does next.
      </p>
    </main>
  );
}
