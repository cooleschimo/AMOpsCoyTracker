/**
 * /org/[id] — a fund and what it touches.
 *
 * The reverse index (§5.2): inverting investor → company answers the question
 * that matters, which is where else this fund appears in our world. A fund with
 * three portfolio companies already operating in Singapore is a warm path and a
 * talking point at once.
 *
 * The portfolio is marked so a reader sees at a glance which companies EDB
 * already holds, which are live conversations, and which surfaced this week.
 */
import { getSql } from '../../../lib/db';
import { hasDashboard } from '../../../lib/auth';
import { ACCOUNT_STATUS_LABELS, type AccountStatus } from '../../../lib/accounts';

export const dynamic = 'force-dynamic';

const S = {
  main: { maxWidth: 900, margin: '0 auto', padding: '28px 20px 60px', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', color: '#111' } as const,
  h1: { fontSize: 24, margin: '0 0 4px', fontWeight: 650 } as const,
  sub: { color: '#666', fontSize: 14, margin: '0 0 20px' } as const,
  h2: { fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: '#1a4d8f', margin: '26px 0 10px', fontWeight: 700 } as const,
  card: { border: '1px solid #e3e3e3', borderRadius: 6, padding: '12px 14px', marginBottom: 8, background: '#fff' } as const,
  p: { fontSize: 14, lineHeight: 1.55, margin: '0 0 6px' } as const,
  meta: { color: '#777', fontSize: 12, margin: '2px 0' } as const,
  caveat: { background: '#fffaf0', border: '1px solid #f0e2c0', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#6b5626', margin: '0 0 14px' } as const,
  row: { display: 'block', borderBottom: '1px solid #eee', padding: '7px 0', fontSize: 14 } as const,
  tag: { display: 'inline-block', fontSize: 11, padding: '1px 7px', borderRadius: 10, marginLeft: 6 } as const,
  a: { color: '#1a4d8f' } as const,
};

const TAG_COLOURS: Record<string, { background: string; color: string }> = {
  existing_account: { background: '#e8f0e8', color: '#2c5c2c' },
  in_conversation: { background: '#e8eef7', color: '#1a4d8f' },
  not_an_account: { background: '#f4f4f2', color: '#6b6b64' },
  not_pursuing: { background: '#f2f2f2', color: '#777' },
  surfaced: { background: '#fdf0e3', color: '#8a5a1b' },
  singapore: { background: '#f7e8ee', color: '#8a2b4d' },
};

export default async function OrgPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> },
) {
  const { id } = await params;
  const sp = await searchParams;
  if (!(await hasDashboard(sp.token))) {
    return <main style={S.main}><h1 style={S.h1}>Not authorised</h1>
      <p style={S.p}>Append <code>?token=…</code> with your DASHBOARD_TOKEN.</p></main>;
  }

  const orgId = Number(id);
  if (!Number.isFinite(orgId)) return <main style={S.main}><h1 style={S.h1}>Not found</h1></main>;

  const sql = getSql();
  const [o]: any = await sql`select * from organizations where id = ${orgId}`;
  if (!o) return <main style={S.main}><h1 style={S.h1}>Not found</h1></main>;

  const [portfolio, people, sectorMix, stageMix]: any = await Promise.all([
    // One row per company. A fund that led three rounds in the same company is
    // one portfolio company, not three, and counting rows would say otherwise.
    sql`select c.id, c.name, c.sectors, c.account_status,
               bool_or(i.is_lead) as is_lead,
               max(i.announced_date) as latest_date,
               (array_remove(array_agg(i.round order by i.announced_date desc nulls last), 'portfolio'))[1] as round,
               exists (select 1 from sg_links g
                       where g.subject_type = 'company' and g.subject_id = c.id) as has_sg,
               (select max(greatest(cs.expansion, cs.partnership))
                  from company_signals cs where cs.company_id = c.id
                   and cs.week_of > current_date - 35) as recent_signal
        from investments i join companies c on c.id = i.company_id
        where i.org_id = ${orgId}
        group by c.id, c.name, c.sectors, c.account_status
        order by c.name`,
    sql`select p.id, p.name, p.title, a.role
        from affiliations a join people p on p.id = a.person_id
        where a.org_id = ${orgId} order by p.name`,
    // What the fund actually backs, so a reader can tell whether its next
    // companies will be relevant.
    sql`select s as sector, count(distinct c.id)::int n
        from investments i join companies c on c.id = i.company_id,
             unnest(coalesce(c.sectors, '{}')) s
        where i.org_id = ${orgId} group by 1 order by n desc limit 5`,
    // Stage tells you whether its companies are near a siting decision. Only
    // over rounds we actually know: a portfolio page gives a name with no round
    // attached, and those would otherwise read as a stage of their own.
    sql`select case
            when i.round ~* 'seed|angel' then 'seed'
            when i.round ~* 'series a' then 'series A'
            when i.round ~* 'series b' then 'series B'
            when i.round ~* 'series c|series d|series e|series f|growth|late' then 'growth'
            else null end as stage,
          count(*)::int n
        from investments i
        where i.org_id = ${orgId} and i.round is not null and i.round <> 'portfolio'
        group by 1 having (case
            when i.round ~* 'seed|angel' then 'seed'
            when i.round ~* 'series a' then 'series A'
            when i.round ~* 'series b' then 'series B'
            when i.round ~* 'series c|series d|series e|series f|growth|late' then 'growth'
            else null end) is not null
        order by n desc`,
  ]);

  const t = sp.token ?? '';
  const surfaced = portfolio.filter((c: any) => (c.recent_signal ?? 0) >= 2);
  const accounts = portfolio.filter((c: any) =>
    c.account_status === 'existing_account' || c.account_status === 'in_conversation');
  const sgCompanies = portfolio.filter((c: any) => c.has_sg);
  // The rows worth reading: everything else is a name in a long list.
  const notable = portfolio.filter((c: any) =>
    c.has_sg || (c.recent_signal ?? 0) >= 2
    || (c.account_status && c.account_status !== 'unknown'));
  const rest = portfolio.filter((c: any) => !notable.includes(c));
  const totalStage = stageMix.reduce((n: number, s: any) => n + s.n, 0) || 1;
  const STAGE_ORDER = ['seed', 'series A', 'series B', 'growth'];

  return (
    <main style={S.main}>
      <h1 style={S.h1}>{o.name}</h1>
      <p style={S.sub}>
        {o.org_type ?? 'organization'}
        {o.website ? <> · <a href={o.website} style={S.a}>{o.website.replace(/^https?:\/\//, '')}</a></> : null}
        {o.hq_city ? ` · ${o.hq_city}${o.hq_country && o.hq_country !== 'United States' ? `, ${o.hq_country}` : ''}` : ''}
        {o.founded_year ? ` · founded ${o.founded_year}` : ''}
      </p>
      {o.apac_office ? (
        <p style={S.meta}>
          <b>Asian office: {o.apac_office}</b> — reachable directly rather than through a portfolio company
        </p>
      ) : null}
      {o.description ? <p style={S.p}>{o.description}</p> : null}

      <div style={S.card}>
        <p style={S.p}>
          <b>{sgCompanies.length}</b> portfolio companies with a Singapore entity ·{' '}
          <b>{accounts.length}</b> EDB already holds or is talking to ·{' '}
          <b>{surfaced.length}</b> surfaced in the last month ·{' '}
          {portfolio.length} in the graph
        </p>
        {sectorMix.length ? (
          <p style={S.meta}>
            Backs: {sectorMix.map((x: any) => `${x.sector} ${x.n}`).join(' · ')}
          </p>
        ) : null}
        {stageMix.length ? (
          <p style={S.meta}>
            Stage: {[...stageMix].sort((a: any, b: any) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
              .map((x: any) => `${x.stage} ${Math.round((x.n / totalStage) * 100)}%`).join(' · ')}
            <span> — of {totalStage} round{totalStage === 1 ? '' : 's'} with a stage recorded</span>
          </p>
        ) : null}
        <p style={S.meta}>
          Portfolio counts reflect what has been read from public sources, not the fund&rsquo;s full
          book. A fund with few companies here may simply be one we have read less of.
        </p>
      </div>

      {surfaced.length ? (
        <>
          <h2 style={S.h2}>Surfaced in the last month ({surfaced.length})</h2>
          {surfaced.map((c: any) => (
            <span key={c.id} style={S.row}>
              <a href={`/company/${c.id}?token=${t}`} style={S.a}>{c.name}</a>
              <span style={{ ...S.tag, ...TAG_COLOURS.surfaced }}>surfaced</span>
              {c.has_sg ? <span style={{ ...S.tag, ...TAG_COLOURS.singapore }}>SG entity</span> : null}
            </span>
          ))}
        </>
      ) : null}

      <h2 style={S.h2}>Portfolio — worth a look ({notable.length})</h2>
      {notable.length === 0 ? <p style={S.p}>Nothing in this portfolio is marked.</p> : notable.map((c: any) => (
        <span key={c.id} style={S.row}>
          <a href={`/company/${c.id}?token=${t}`} style={S.a}>{c.name}</a>
          {c.is_lead ? <span style={S.meta}> · lead</span> : null}
          {c.round ? <span style={S.meta}> · {c.round}</span> : null}
          {c.account_status && c.account_status !== 'unknown' ? (
            <span style={{ ...S.tag, ...(TAG_COLOURS[c.account_status] ?? TAG_COLOURS.not_pursuing) }}>
              {ACCOUNT_STATUS_LABELS[c.account_status as AccountStatus] ?? c.account_status}
            </span>
          ) : null}
          {(c.recent_signal ?? 0) >= 2 ? <span style={{ ...S.tag, ...TAG_COLOURS.surfaced }}>surfaced</span> : null}
          {c.has_sg ? <span style={{ ...S.tag, ...TAG_COLOURS.singapore }}>SG entity</span> : null}
        </span>
      ))}

      {rest.length ? (
        <details style={{ marginTop: 14 }}>
          <summary style={{ ...S.h2, cursor: 'pointer', margin: '14px 0 8px' }}>
            The other {rest.length} portfolio companies
          </summary>
          {rest.map((c: any) => (
            <span key={c.id} style={S.row}>
              <a href={`/company/${c.id}?token=${t}`} style={S.a}>{c.name}</a>
              {c.round ? <span style={S.meta}> · {c.round}</span> : null}
            </span>
          ))}
        </details>
      ) : null}

      {people.length ? (
        <>
          <h2 style={S.h2}>People ({people.length})</h2>
          {people.map((p: any) => (
            <span key={p.id} style={S.row}>
              <a href={`/person/${p.id}?token=${t}`} style={S.a}>{p.name}</a>
              {p.title || p.role ? <span style={S.meta}> · {p.title ?? p.role}</span> : null}
            </span>
          ))}
          <p style={S.caveat}>
            A person affiliated with this fund who also sits on a company board is a possible
            path, not a confirmed one. Someone has to know whether EDB actually has access.
          </p>
        </>
      ) : null}
    </main>
  );
}
