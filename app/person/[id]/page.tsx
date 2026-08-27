/**
 * /person/[id] — what the graph knows about one person.
 *
 * People are the strongest warm paths (§8): a person on two boards is
 * actionable where a shared investor usually is not. This page shows the edges
 * that make that claim, each with its source, so an RD checks rather than
 * trusts.
 *
 * Anything derived from a search snippet is marked probable and carries the
 * page it came from. Profile links are stored as returned by a search index;
 * the page behind one is never fetched.
 */
import { getSql } from '../../../lib/db';
import { hasDashboard } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

/** A date column comes back as a Date; only the day matters here. */
const day = (v: unknown) => {
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};

const S = {
  main: { maxWidth: 760, margin: '0 auto', padding: '28px 20px 60px', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', color: '#111' } as const,
  h1: { fontSize: 24, margin: '0 0 4px', fontWeight: 650 } as const,
  sub: { color: '#666', fontSize: 14, margin: '0 0 20px' } as const,
  h2: { fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: '#1a4d8f', margin: '26px 0 10px', fontWeight: 700 } as const,
  card: { border: '1px solid #e3e3e3', borderRadius: 6, padding: '12px 14px', marginBottom: 8, background: '#fff' } as const,
  p: { fontSize: 14, lineHeight: 1.55, margin: '0 0 6px' } as const,
  meta: { color: '#777', fontSize: 12, margin: '2px 0' } as const,
  caveat: { background: '#fffaf0', border: '1px solid #f0e2c0', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#6b5626', margin: '0 0 14px' } as const,
  a: { color: '#1a4d8f' } as const,
};

export default async function PersonPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> },
) {
  const { id } = await params;
  const sp = await searchParams;
  if (!(await hasDashboard(sp.token))) {
    return <main style={S.main}><h1 style={S.h1}>Not authorised</h1>
      <p style={S.p}>Append <code>?token=…</code> with your DASHBOARD_TOKEN.</p></main>;
  }

  const personId = Number(id);
  if (!Number.isFinite(personId)) return <main style={S.main}><h1 style={S.h1}>Not found</h1></main>;

  const sql = getSql();
  const [p]: any = await sql`select * from people where id = ${personId}`;
  if (!p) return <main style={S.main}><h1 style={S.h1}>Not found</h1></main>;

  const [roles, affiliations, sgCompanies]: any = await Promise.all([
    sql`select r.role, r.role_raw, r.source, r.source_url, r.first_seen, r.last_seen,
               c.id as company_id, c.name as company, c.sectors, c.account_status
        from roles r join companies c on c.id = r.company_id
        where r.person_id = ${personId}
        order by r.last_seen desc nulls last`,
    sql`select a.role, a.source, a.source_url, o.id as org_id, o.name as org, o.org_type
        from affiliations a join organizations o on o.id = a.org_id
        where a.person_id = ${personId}`,
    // A person connected to a company with a Singapore entity is the warm path
    // §8 ranks highest.
    sql`select distinct c.id, c.name, g.match_status
        from roles r join companies c on c.id = r.company_id
        join sg_links g on g.subject_type = 'company' and g.subject_id = c.id
        where r.person_id = ${personId}`,
  ]);

  const t = sp.token ?? '';

  return (
    <main style={S.main}>
      <h1 style={S.h1}>{p.name}</h1>
      <p style={S.sub}>
        {p.title ?? 'No title recorded'}
        {p.profile_url ? <> · <a href={p.profile_url} style={S.a}>profile</a></> : null}
      </p>

      {p.bio ? (
        <>
          <div style={S.card}>
            <p style={S.p}>{p.bio}</p>
            <p style={S.meta}>
              {p.bio_status === 'probable' ? 'From a search result, not verified' : 'Recorded'}
              {p.bio_source ? ` · ${p.bio_source}` : ''}
              {p.bio_source_url ? <> · <a href={p.bio_source_url} style={S.a}>source</a></> : null}
              {p.bio_fetched_at ? ` · ${new Date(p.bio_fetched_at).toISOString().slice(0, 10)}` : ''}
            </p>
          </div>
        </>
      ) : null}

      {p.contact_email || p.contact_phone ? (
        <>
          <h2 style={S.h2}>Contact</h2>
          <div style={S.card}>
            {p.contact_email ? <p style={S.p}>{p.contact_email}</p> : null}
            {p.contact_phone ? <p style={S.p}>{p.contact_phone}</p> : null}
            <p style={S.meta}>
              From a public source
              {p.contact_source_url ? <> · <a href={p.contact_source_url} style={S.a}>where it came from</a></> : null}
              {p.contact_found_at ? ` · found ${new Date(p.contact_found_at).toISOString().slice(0, 10)}` : ''}
            </p>
            <p style={S.meta}>Contacts age quickly. Check it still works before using it.</p>
          </div>
        </>
      ) : null}

      <h2 style={S.h2}>Roles ({roles.length})</h2>
      {roles.length === 0 ? <p style={S.p}>None recorded.</p> : roles.map((r: any, i: number) => (
        <div key={i} style={S.card}>
          <p style={S.p}>
            <b>{r.role_raw ?? r.role}</b> at{' '}
            <a href={`/company/${r.company_id}?token=${t}`} style={S.a}>{r.company}</a>
            {r.account_status && r.account_status !== 'unknown' ? ` · ${String(r.account_status).replace(/_/g, ' ')}` : ''}
          </p>
          <p style={S.meta}>
            {r.source}
            {r.first_seen ? ` · first seen ${day(r.first_seen)}` : ''}
            {r.last_seen ? ` · last seen ${day(r.last_seen)}` : ''}
            {r.source_url ? <> · <a href={r.source_url} style={S.a}>source</a></> : ''}
          </p>
        </div>
      ))}

      {affiliations.length ? (
        <>
          <h2 style={S.h2}>Fund affiliations ({affiliations.length})</h2>
          {affiliations.map((a: any, i: number) => (
            <div key={i} style={S.card}>
              <p style={S.p}>
                {a.role ?? 'Affiliated'} at{' '}
                <a href={`/org/${a.org_id}?token=${t}`} style={S.a}>{a.org}</a>
              </p>
              <p style={S.meta}>
                {a.source}
                {a.source_url ? <> · <a href={a.source_url} style={S.a}>source</a></> : ''}
              </p>
            </div>
          ))}
          <p style={S.caveat}>
            A fund affiliation and a board seat are separate facts from separate sources.
            Appearing as a director on a filing does not establish which fund a person
            represents, and this page keeps the two apart for that reason.
          </p>
        </>
      ) : null}

      {sgCompanies.length ? (
        <>
          <h2 style={S.h2}>Singapore connections</h2>
          {sgCompanies.map((c: any) => (
            <div key={c.id} style={S.card}>
              <p style={S.p}>
                Also connected to <a href={`/company/${c.id}?token=${t}`} style={S.a}>{c.name}</a>,
                which has a {c.match_status ?? 'possible'} Singapore entity
              </p>
            </div>
          ))}
          <p style={S.caveat}>
            This is an association from public records, not a confirmed introduction.
            Someone has to know whether EDB actually has access.
          </p>
        </>
      ) : null}
    </main>
  );
}
