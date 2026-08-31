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
import { sectorLabel } from '../../../lib/subsectors';
import { hasDashboard } from '../../../lib/auth';
import { ACCOUNT_STATUS_LABELS, type AccountStatus } from '../../../lib/accounts';

export const dynamic = 'force-dynamic';

const MAIN = 'mx-auto max-w-[900px] px-5 pb-16 pt-7';
const H1 = 'font-display text-2xl font-semibold tracking-tight';
const BODY = 'text-sm';
const META = 'text-xs text-muted-foreground';
const TAG = 'ml-1.5 inline-block rounded-full px-[7px] py-px text-2xs';
const ROW = 'block hairline-b py-[7px] text-sm';
const LINK = 'text-primary link-underline hover:text-foreground';
const H2 = 'mb-2.5 mt-6 text-xs font-bold uppercase tracking-[0.08em] text-primary';

/**
 * Tag colours as class strings rather than style objects, so an accent change
 * in globals.css reaches this page too.
 *
 * The five account statuses keep their distinct meanings: an account held is
 * confirmed green, a live conversation carries the accent, and the two
 * negative-but-different states stay neutral and separable — 'not an account'
 * is a fact about the relationship, 'not pursuing' a decision, so the latter
 * reads dimmer rather than identical.
 */
const TAG_COLOURS: Record<string, string> = {
  unknown: 'bg-muted text-muted-foreground',
  existing_account: 'bg-confirmed/15 text-confirmed',
  in_conversation: 'bg-primary/10 text-primary',
  not_an_account: 'bg-muted text-muted-foreground',
  not_pursuing: 'bg-muted/60 text-muted-foreground/70',
  surfaced: 'bg-caution-soft/60 text-caution',
  singapore: 'bg-destructive/10 text-destructive',
};

export default async function OrgPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> },
) {
  const { id } = await params;
  const sp = await searchParams;
  if (!(await hasDashboard(sp.token))) {
    return <main className={MAIN}><h1 className={H1}>Not authorised</h1>
      <p className={`${BODY} mt-1`}>Append <code>?token=…</code> with your DASHBOARD_TOKEN.</p></main>;
  }

  const orgId = Number(id);
  if (!Number.isFinite(orgId)) return <main className={MAIN}><h1 className={H1}>Not found</h1></main>;

  const sql = getSql();
  const [o]: any = await sql`select * from organizations where id = ${orgId}`;
  if (!o) return <main className={MAIN}><h1 className={H1}>Not found</h1></main>;

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
    <main className={MAIN}>
      <h1 className={H1}>{o.name}</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        {o.org_type ?? 'organization'}
        {o.website ? <> · <a href={o.website} className={LINK}>{o.website.replace(/^https?:\/\//, '')}</a></> : null}
        {o.hq_city ? ` · ${o.hq_city}${o.hq_country && o.hq_country !== 'United States' ? `, ${o.hq_country}` : ''}` : ''}
        {o.founded_year ? ` · founded ${o.founded_year}` : ''}
      </p>
      {o.apac_office ? (
        <p className={META}>
          <b>Asian office: {o.apac_office}</b> — reachable directly rather than through a portfolio company
        </p>
      ) : null}
      {o.description ? <p className={`${BODY} mb-1.5`}>{o.description}</p> : null}

      <div className="mb-2 rounded-md border border-border bg-card px-3.5 py-3">
        <p className={`${BODY} mb-1.5`}>
          <b>{sgCompanies.length}</b> portfolio companies with a Singapore entity ·{' '}
          <b>{accounts.length}</b> EDB already holds or is talking to ·{' '}
          <b>{surfaced.length}</b> surfaced in the last month
        </p>
        {sectorMix.length ? (
          <p className={META}>
            Backs: {sectorMix.map((x: any) => `${sectorLabel(x.sector)} (${x.n})`).join(' · ')}
          </p>
        ) : null}
        {stageMix.length ? (
          <p className={META}>
            Stage: {[...stageMix].sort((a: any, b: any) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
              .map((x: any) => `${x.stage} ${Math.round((x.n / totalStage) * 100)}%`).join(' · ')}
            <span> — of {totalStage} round{totalStage === 1 ? '' : 's'} with a stage recorded</span>
          </p>
        ) : null}
        <p className={META}>
          Portfolio counts reflect what has been read from public sources, not the fund&rsquo;s full
          book. A fund with few companies here may simply be one we have read less of.
        </p>
      </div>

      {surfaced.length ? (
        <>
          <h2 className={H2}>Surfaced in the last month ({surfaced.length})</h2>
          {surfaced.map((c: any) => (
            <span key={c.id} className={ROW}>
              <a href={`/company/${c.id}?token=${t}`} className={LINK}>{c.name}</a>
              <span className={`${TAG} ${TAG_COLOURS.surfaced}`}>surfaced</span>
              {c.has_sg ? <span className={`${TAG} ${TAG_COLOURS.singapore}`}>SG entity</span> : null}
            </span>
          ))}
        </>
      ) : null}

      <h2 className={H2}>Portfolio — worth a look ({notable.length})</h2>
      {notable.length === 0 ? <p className={BODY}>Nothing in this portfolio is marked.</p> : notable.map((c: any) => (
        <span key={c.id} className={ROW}>
          <a href={`/company/${c.id}?token=${t}`} className={LINK}>{c.name}</a>
          {c.is_lead ? <span className={META}> · lead</span> : null}
          {c.round ? <span className={META}> · {c.round}</span> : null}
          {c.account_status && c.account_status !== 'unknown' ? (
            <span className={`${TAG} ${TAG_COLOURS[c.account_status] ?? TAG_COLOURS.not_pursuing}`}>
              {ACCOUNT_STATUS_LABELS[c.account_status as AccountStatus] ?? c.account_status}
            </span>
          ) : null}
          {(c.recent_signal ?? 0) >= 2 ? <span className={`${TAG} ${TAG_COLOURS.surfaced}`}>surfaced</span> : null}
          {c.has_sg ? <span className={`${TAG} ${TAG_COLOURS.singapore}`}>SG entity</span> : null}
        </span>
      ))}

      {rest.length ? (
        <details className="mt-3.5">
          <summary className={`${H2} mb-2 mt-3.5 cursor-pointer`}>
            The other {rest.length} portfolio companies
          </summary>
          {rest.map((c: any) => (
            <span key={c.id} className={ROW}>
              <a href={`/company/${c.id}?token=${t}`} className={LINK}>{c.name}</a>
              {c.round ? <span className={META}> · {c.round}</span> : null}
            </span>
          ))}
        </details>
      ) : null}

      {people.length ? (
        <>
          <h2 className={H2}>People ({people.length})</h2>
          {people.map((p: any) => (
            <span key={p.id} className={ROW}>
              <a href={`/person/${p.id}?token=${t}`} className={LINK}>{p.name}</a>
              {p.title || p.role ? <span className={META}> · {p.title ?? p.role}</span> : null}
            </span>
          ))}
          <p className="mb-3.5 rounded-md border border-caution/40 bg-caution-soft/40 px-3 py-2.5 text-xs text-caution">
            A person affiliated with this fund who also sits on a company board is a possible
            path, not a confirmed one. Someone has to know whether EDB actually has access.
          </p>
        </>
      ) : null}
    </main>
  );
}
