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
import { recordDisposition } from './actions';
import { REASONS, REASON_LABELS } from '../../../lib/dispositions';

export const dynamic = 'force-dynamic';

const S = {
  main: { maxWidth: 760, margin: '0 auto', padding: '28px 20px 60px', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', color: '#111' } as const,
  h1: { fontSize: 22, margin: '0 0 6px', fontWeight: 650, lineHeight: 1.3 } as const,
  h2: { fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: '#1a4d8f', margin: '26px 0 10px', fontWeight: 700 } as const,
  p: { fontSize: 14, lineHeight: 1.55, margin: '0 0 8px' } as const,
  meta: { color: '#777', fontSize: 12, margin: '4px 0' } as const,
  card: { border: '1px solid #e3e3e3', borderRadius: 6, padding: '14px 16px', marginBottom: 10, background: '#fff' } as const,
  warn: { background: '#fff4f4', border: '1px solid #f0c9c9', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#7a2f2f', margin: '0 0 14px' } as const,
  caveat: { background: '#fffaf0', border: '1px solid #f0e2c0', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#6b5626', margin: '0 0 14px' } as const,
  btn: { fontSize: 14, padding: '9px 16px', borderRadius: 6, border: '1px solid #1a4d8f', background: '#1a4d8f', color: '#fff', cursor: 'pointer', marginRight: 8 } as const,
  btnAlt: { fontSize: 14, padding: '9px 16px', borderRadius: 6, border: '1px solid #bbb', background: '#fff', color: '#333', cursor: 'pointer', marginRight: 8 } as const,
  label: { display: 'inline-block', fontSize: 13, marginRight: 14, marginBottom: 6 } as const,
  a: { color: '#1a4d8f' } as const,
};

export default async function ItemPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> },
) {
  const { id } = await params;
  const sp = await searchParams;
  if (!(await hasDashboard(sp.token))) {
    return <main style={S.main}><h1 style={S.h1}>Not authorised</h1>
      <p style={S.p}>Append <code>?token=…</code> with your DASHBOARD_TOKEN.</p></main>;
  }

  const itemId = Number(id);
  if (!Number.isFinite(itemId)) return <main style={S.main}><h1 style={S.h1}>Not found</h1></main>;

  const sql = getSql();
  const [it]: any = await sql`
    select i.*, c.name as company_name, c.id as cid, c.account_status, c.sectors,
           s.score, s.momentum, s.signal_type, s.why, s.expansion_language, s.rubric_version, s.model
    from items i
    left join companies c on c.id = i.company_id
    left join scores s on s.item_id = i.id
    where i.id = ${itemId}
    order by s.scored_at desc limit 1`;
  if (!it) return <main style={S.main}><h1 style={S.h1}>Not found</h1></main>;

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
    it.cid ? sql`select i2.id, i2.title, i2.source, i2.published_at, i2.source_type,
                        s2.score, s2.momentum, s2.signal_type
                 from items i2 join scores s2 on s2.item_id = i2.id
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
    <main style={S.main}>
      <p style={S.meta}>
        {it.company_name ? <a href={`/company/${it.cid}`} style={S.a}>{it.company_name}</a> : 'Unmatched company'}
        {' · '}{it.source}
        {it.published_at ? ` · ${new Date(it.published_at).toISOString().slice(0, 10)}` : ''}
      </p>
      <h1 style={S.h1}>{it.title}</h1>
      <p style={S.p}><a href={it.url} style={S.a}>Open the source</a></p>

      {/* Duplicate-outreach warning (§11): who already owns this, and since when. */}
      {existingOpp.length ? (
        <p style={S.warn}>
          <b>This company already has an open opportunity</b>
          {existingOpp[0].owner ? ` owned by ${existingOpp[0].owner}` : ' with no owner recorded'}
          {` since ${new Date(existingOpp[0].created_at).toISOString().slice(0, 10)}`}
          {existingOpp[0].next_action ? ` · next action: ${existingOpp[0].next_action}` : ''}.
          Check before making contact.
        </p>
      ) : null}

      {it.account_status && it.account_status !== 'unknown' ? (
        <p style={S.caveat}>Account status: <b>{it.account_status}</b> — recorded by a person, not derived by the tool.</p>
      ) : null}

      {/* ---- Why it surfaced ---- */}
      <h2 style={S.h2}>Why it surfaced</h2>
      <div style={S.card}>
        <p style={S.p}><b>Why now:</b> {it.why ?? 'not scored'}</p>
        <p style={S.p}>
          <b>Signal:</b> {it.signal_type ?? '—'} · score {it.score ?? '—'}
          {it.expansion_language ? ' · uses expansion language' : ' · no expansion language in the text'}
        </p>
        {a ? (
          <p style={S.p}>
            <b>Company:</b> {a.target_priority} priority · Singapore fit {a.singapore_fit} ·
            {' '}contribution {a.potential_contribution} ({a.confidence} confidence)
          </p>
        ) : <p style={S.p}><b>Company:</b> not assessed</p>}
        <p style={S.meta}>{it.rubric_version} · {it.model}</p>
      </div>
      {it.snippet ? <p style={S.p}>{it.snippet}</p> : null}

      {cluster.length ? (
        <>
          <h2 style={S.h2}>Also reported by ({cluster.length})</h2>
          {cluster.map((c: any) => (
            <p key={c.id} style={S.meta}>{c.source} — {c.title}</p>
          ))}
        </>
      ) : null}

      {/* ---- Momentum: why this ranked in Trending ---- */}
      {it.momentum !== null && it.momentum !== undefined ? (
        <>
          <h2 style={S.h2}>Momentum</h2>
          <div style={S.card}>
            <p style={S.p}>
              <b>{it.momentum}/3</b> — how fast this company is moving, judged separately from
              whether a location decision is in play.
            </p>
            <p style={S.meta}>
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
          <h2 style={S.h2}>Other activity at {it.company_name} ({related.length})</h2>
          {related.map((r: any) => (
            <div key={r.id} style={S.card}>
              <p style={S.p}>
                <a href={`/item/${r.id}?token=${sp.token ?? ''}`} style={S.a}>{r.title}</a>
              </p>
              <p style={S.meta}>
                {r.signal_type} · score {r.score}
                {r.momentum !== null ? ` · momentum ${r.momentum}/3` : ''}
                {r.source_type === 'ats' ? ' · job board' : ` · ${r.source}`}
                {r.published_at ? ` · ${new Date(r.published_at).toISOString().slice(0, 10)}` : ''}
              </p>
            </div>
          ))}
          <p style={S.meta}>
            <a href={`/company/${it.cid}?token=${sp.token ?? ''}`} style={S.a}>
              Full connection view for {it.company_name} →
            </a>
          </p>
        </>
      ) : null}

      {/* ---- Disposition ---- */}
      <h2 style={S.h2}>Your call</h2>
      {prior ? (
        <p style={S.caveat}>
          Recorded from this browser: <b>{prior.disposition.replace(/_/g, ' ')}</b>
          {prior.reasons?.length ? ` (${prior.reasons.map((r: string) => (REASON_LABELS as Record<string, string>)[r] ?? r).join(', ')})` : ''}.
          Submitting again replaces it.
        </p>
      ) : null}

      <form action={recordDisposition}>
        <input type="hidden" name="itemId" value={itemId} />
        {it.cid ? <input type="hidden" name="companyId" value={it.cid} /> : null}

        <div style={S.card}>
          <p style={S.p}><b>Reasons</b> — optional for Take forward and Monitor, please give one for Dismiss.</p>
          {REASONS.map((r) => (
            <label key={r} style={S.label}>
              <input type="checkbox" name={`reason_${r}`} /> {REASON_LABELS[r]}
            </label>
          ))}
          <p style={{ margin: '10px 0 0' }}>
            <textarea name="note" rows={2} placeholder="Anything worth recording (optional)"
              style={{ width: '100%', fontSize: 13, padding: 8, borderRadius: 6, border: '1px solid #ccc', fontFamily: 'inherit' }} />
          </p>
        </div>

        <button type="submit" name="disposition" value="draft_email" style={S.btn}>Draft an email</button>
        <button type="submit" name="disposition" value="monitor" style={S.btnAlt}>Monitor</button>
        <button type="submit" name="disposition" value="dismiss" style={S.btnAlt}>Dismiss</button>
      </form>

      <p style={S.meta}>
        Reactions are anonymous. Nothing here records who you are — a per-browser key
        deduplicates repeat clicks and that is all.
      </p>
      <p style={S.meta}>
        Take forward opens an opportunity with no owner or due date required. Monitor means
        &ldquo;keep this warm, resurface on the next trigger&rdquo;.
      </p>
    </main>
  );
}
