/**
 * /company/[id] — the connection view. Brief §8, step 7's UI half.
 *
 * §8 calls this "the feature that differentiates the tool": news is a commodity,
 * warm paths are not.
 *
 * THE HONESTY RULES THIS PAGE ENFORCES (§8, §9, RATIONALE §9):
 *  - A path is a POSSIBLE path until a human reviews it. Nothing here says
 *    "warm introduction" about an unreviewed association.
 *  - Every edge shows its source and date. §15: "graph edges without source_url
 *    are worthless — an RD needs to check before acting."
 *  - Valuation and funding figures carry their source and a staleness caveat.
 *  - A Singapore registration is NOT operational presence: match status, entity
 *    status and incorporation date travel together.
 *  - Form D "amount sold" is never shown as total raised; the security type
 *    travels with it.
 */
import { getSql } from '../../../lib/db';
import { hasDashboard } from '../../../lib/auth';
import { findWarmPaths } from '../../../lib/paths';

export const dynamic = 'force-dynamic';

const S = {
  main: { maxWidth: 860, margin: '0 auto', padding: '28px 20px 60px', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', color: '#111' } as const,
  h1: { fontSize: 26, margin: '0 0 4px', fontWeight: 650 } as const,
  sub: { color: '#666', fontSize: 14, margin: '0 0 22px' } as const,
  h2: { fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: '#1a4d8f', margin: '28px 0 10px', fontWeight: 700 } as const,
  card: { border: '1px solid #e3e3e3', borderRadius: 6, padding: '12px 14px', marginBottom: 8, background: '#fff' } as const,
  meta: { color: '#777', fontSize: 12, marginTop: 4 } as const,
  p: { fontSize: 14, lineHeight: 1.55, margin: '0 0 8px' } as const,
  caveat: { background: '#fffaf0', border: '1px solid #f0e2c0', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#6b5626', margin: '0 0 14px' } as const,
  tag: { display: 'inline-block', fontSize: 11, padding: '2px 7px', borderRadius: 10, background: '#eef2f7', color: '#33507a', marginRight: 6 } as const,
  a: { color: '#1a4d8f' } as const,
};

const band = (v: string | null) => v ?? 'unassessed';

/** A date column comes back as a Date; only the day matters here. */
const day = (v: unknown) => {
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};

export default async function CompanyPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> },
) {
  const { id } = await params;
  const sp = await searchParams;
  if (!(await hasDashboard(sp.token))) {
    return <main style={S.main}><h1 style={S.h1}>Not authorised</h1>
      <p style={S.p}>Append <code>?token=…</code> with your DASHBOARD_TOKEN.</p></main>;
  }

  const companyId = Number(id);
  if (!Number.isFinite(companyId)) {
    return <main style={S.main}><h1 style={S.h1}>Not found</h1></main>;
  }

  const sql = getSql();
  const [co]: any = await sql`select * from companies where id = ${companyId}`;
  if (!co) return <main style={S.main}><h1 style={S.h1}>Not found</h1></main>;

  const [people, investors, filings, sgLinks, assessment, recentItems, jobs] = await Promise.all([
    sql`select p.id, p.name, r.role, r.role_raw, r.source, r.source_url, r.first_seen, r.last_seen
        from roles r join people p on p.id = r.person_id
        where r.company_id = ${companyId} order by r.last_seen desc nulls last, p.name`,
    sql`select o.id, o.name, i.round, i.is_lead, i.announced_date, i.source, i.source_url
        from investments i join organizations o on o.id = i.org_id
        where i.company_id = ${companyId} order by i.is_lead desc nulls last, o.name`,
    sql`select form_type, filed_at, amount, security_type, url
        from sec_filings where company_id = ${companyId} order by filed_at desc`,
    sql`select link_type, match_status, detail, source_url, found_at
        from sg_links where subject_type = 'company' and subject_id = ${companyId} order by found_at desc`,
    sql`select * from company_assessments where company_id = ${companyId}
        order by assessed_at desc limit 1`,
    sql`select i.id, i.title, i.source, i.published_at, s.score, s.signal_type, s.why
        from items i join scores s on s.item_id = i.id
        where i.company_id = ${companyId} and i.status = 'kept'
        order by s.score desc, i.published_at desc nulls last limit 8`,
    sql`select total_jobs, non_us_jobs, apac_jobs, snapshot_at
        from job_snapshots where company_id = ${companyId} order by snapshot_at desc limit 2`,
  ]);

  const paths = await findWarmPaths(companyId);
  const a: any = assessment[0];

  return (
    <main style={S.main}>
      <h1 style={S.h1}>{co.name}</h1>
      <p style={S.sub}>
        {(co.sectors ?? []).map((s: string) => <span key={s} style={S.tag}>{s}</span>)}
        {co.hq_city ? `${co.hq_city}, ` : ''}{co.hq_state ?? co.hq_region ?? ''}
        {co.website ? <> · <a href={co.website} style={S.a}>{co.website.replace(/^https?:\/\//, '')}</a></> : null}
      </p>

      {/* ---- Assessment (§7a) ---- */}
      {a ? (
        <>
          <h2 style={S.h2}>Assessment</h2>
          <div style={S.card}>
            <p style={S.p}>
              Target priority <b>{band(a.target_priority)}</b> · Singapore fit <b>{band(a.singapore_fit)}</b> ·
              {' '}Potential contribution <b>{band(a.potential_contribution)}</b>
            </p>
            {a.rationale ? <p style={S.p}>{a.rationale}</p> : null}
            <p style={S.meta}>
              {band(a.confidence)} confidence · {a.rubric_version} · {a.model} ·
              {' '}assessed {new Date(a.assessed_at).toISOString().slice(0, 10)}
            </p>
          </div>
          <p style={S.caveat}>
            This is a model judgment on public information, refreshed monthly. It will be wrong
            for companies whose relevance depends on internal context the tool cannot see —
            correct it rather than trusting it.
          </p>
        </>
      ) : null}

      {/* ---- Warm paths — the differentiating feature ---- */}
      <h2 style={S.h2}>Possible paths ({paths.length})</h2>
      {paths.length === 0 ? (
        <p style={S.p}>No path found in the graph. That means no public edge was scraped, not that none exists.</p>
      ) : (
        <>
          <p style={S.caveat}>
            These are <b>associations from public data, not confirmed introductions</b>. Graph
            structure shows that two entities are connected; only a person knows whether EDB
            actually has access. Check the evidence before acting, and record what you find.
          </p>
          {paths.slice(0, 12).map((p, i) => (
            <div key={i} style={S.card}>
              <p style={S.p}>{p.description}</p>
              <p style={S.meta}>
                {p.kind.replace(/_/g, ' ')} · {p.reviewStatus === 'confirmed' ? 'confirmed by a person' : 'unreviewed'}
                {p.degree !== null ? ` · via a node with ${p.degree} connections${p.coverage === 'incidental' ? ' (little of this entity has been scraped, so treat the figure as a floor)' : ''}` : ''}
              </p>
              <p style={S.meta}>
                {p.evidence}
                {p.sourceUrl ? <> · <a href={p.sourceUrl} style={S.a}>source</a></> : ' · no source url — do not act on this'}
              </p>
            </div>
          ))}
        </>
      )}

      {/* ---- Singapore ---- */}
      <h2 style={S.h2}>Singapore</h2>
      {sgLinks.length === 0 ? (
        <p style={S.p}>No Singapore link found.</p>
      ) : sgLinks.map((l: any, i: number) => (
        <div key={i} style={S.card}>
          <p style={S.p}>
            {l.link_type.replace(/_/g, ' ')} — <b>{l.match_status ?? 'unknown'} match</b>
          </p>
          <p style={S.meta}>{l.detail}</p>
          {l.match_status !== 'confirmed' ? (
            <p style={S.meta}>
              A registration is not operational presence, and a probable match may be a
              different company with a similar name. Verify against ACRA before relying on it.
            </p>
          ) : null}
          {l.source_url ? <p style={S.meta}><a href={l.source_url} style={S.a}>source</a></p> : null}
        </div>
      ))}

      {/* ---- People ---- */}
      <h2 style={S.h2}>People ({people.length})</h2>
      {people.length === 0 ? <p style={S.p}>None recorded.</p> : people.map((p: any) => (
        <div key={`${p.id}-${p.role}`} style={S.card}>
          <p style={S.p}>
            <b><a href={`/person/${p.id}?token=${sp.token ?? ''}`} style={S.a}>{p.name}</a></b>
            {' — '}{p.role_raw ?? p.role}
          </p>
          <p style={S.meta}>
            {p.source}
            {p.first_seen ? ` · first seen ${day(p.first_seen)}` : ''}
            {p.last_seen ? ` · last seen ${day(p.last_seen)}` : ''}
            {p.source_url ? <> · <a href={p.source_url} style={S.a}>source</a></> : ''}
          </p>
        </div>
      ))}

      {/* ---- Investors ---- */}
      <h2 style={S.h2}>Investors ({investors.length})</h2>
      {investors.length === 0 ? <p style={S.p}>None recorded.</p> : investors.map((v: any, i: number) => (
        <div key={i} style={S.card}>
          <p style={S.p}>
            <b><a href={`/org/${v.id}?token=${sp.token ?? ''}`} style={S.a}>{v.name}</a></b>
            {v.is_lead ? ' (lead)' : ''}{v.round ? ` · ${v.round}` : ''}
          </p>
          <p style={S.meta}>
            {v.source}{v.announced_date ? ` · ${v.announced_date}` : ''}
            {v.source_url ? <> · <a href={v.source_url} style={S.a}>source</a></> : ''}
          </p>
        </div>
      ))}

      {/* ---- Filings. NEVER presented as total raised (§5.1). ---- */}
      {filings.length ? (
        <>
          <h2 style={S.h2}>SEC filings</h2>
          <p style={S.caveat}>
            Amounts are <b>as filed on a single Form D</b>, not cumulative venture funding. A
            Form D can cover debt, pooled funds or multi-issuer structures, and issuers
            sometimes file partially or not at all.
          </p>
          {filings.map((f: any, i: number) => (
            <div key={i} style={S.card}>
              <p style={S.p}>
                {f.form_type} · {f.filed_at}
                {f.amount ? ` · $${Number(f.amount).toLocaleString()} sold` : ''}
                {f.security_type ? ` · ${f.security_type}` : ''}
              </p>
              {f.url ? <p style={S.meta}><a href={f.url} style={S.a}>filing</a></p> : null}
            </div>
          ))}
        </>
      ) : null}

      {/* ---- Hiring ---- */}
      {jobs.length ? (
        <>
          <h2 style={S.h2}>Hiring</h2>
          <div style={S.card}>
            <p style={S.p}>
              {jobs[0].total_jobs} open roles · {jobs[0].non_us_jobs} outside the US · {jobs[0].apac_jobs} in APAC
            </p>
            <p style={S.meta}>
              snapshot {new Date(jobs[0].snapshot_at).toISOString().slice(0, 10)}
              {jobs[1] ? ` · previous week ${jobs[1].total_jobs} total, ${jobs[1].apac_jobs} APAC` : ' · no prior week yet, so week-over-week growth cannot be computed'}
            </p>
          </div>
        </>
      ) : null}

      {/* ---- Recent signals ---- */}
      {recentItems.length ? (
        <>
          <h2 style={S.h2}>Recent signals</h2>
          {recentItems.map((it: any) => (
            <div key={it.id} style={S.card}>
              <p style={S.p}>
                <a href={`/item/${it.id}`} style={S.a}>{it.title}</a>
              </p>
              <p style={S.meta}>
                score {it.score} · {it.signal_type} · {it.source}
                {it.published_at ? ` · ${new Date(it.published_at).toISOString().slice(0, 10)}` : ''}
              </p>
              <p style={S.meta}>{it.why}</p>
            </div>
          ))}
        </>
      ) : null}
    </main>
  );
}
