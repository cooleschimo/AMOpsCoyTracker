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
import { profileLabel } from '../../../lib/utils';
import { redirect } from 'next/navigation';
import { currentSession } from '../../../lib/session';
import { SectionHeading } from '@/components/primitives';

export const dynamic = 'force-dynamic';

/** A date column comes back as a Date; only the day matters here. */
const day = (v: unknown) => {
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};

/* Shared class strings. A reading column, not the dashboard's card grid. */
const MAIN = 'mx-auto max-w-[760px] px-5 pb-16 pt-7';
const H1 = 'mb-1 font-display text-2xl font-semibold tracking-tight';
const CARD = 'mb-2 rounded-md border border-border bg-card px-3.5 py-3';
const BODY = 'mb-1.5 text-sm';
const META = 'my-0.5 text-xs text-muted-foreground';
const LINK = 'text-primary link-underline hover:text-foreground';
/* Caution notice — where a claim is weaker than it looks. */
const CAUTION = 'mb-3.5 rounded-md border border-caution/30 bg-caution-soft px-3 py-2.5 text-2xs text-caution';
const HEADING = 'mb-2.5 mt-6';

export default async function PersonPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> },
) {
  const { id } = await params;
  const sp = await searchParams;
  // Scored and assessed already, so a guest may read it. `currentUser()` still
  // decides what is withheld inside — the proposition, and every action.
  if (!(await currentSession())) redirect('/login');

  const personId = Number(id);
  if (!Number.isFinite(personId)) return <main className={MAIN}><h1 className={H1}>Not found</h1></main>;

  const sql = getSql();
  const [p]: any = await sql`select * from people where id = ${personId}`;
  if (!p) return <main className={MAIN}><h1 className={H1}>Not found</h1></main>;

  const [roles, affiliations, sgCompanies]: any = await Promise.all([
    sql`select r.role, r.role_raw, r.source, r.source_url, r.first_seen, r.last_seen,
               c.id as company_id, c.name as company, c.sectors, c.familiarity
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
    <main className={MAIN}>
      <h1 className={H1}>{p.name}</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        {p.title ?? 'No title recorded'}
        {p.profile_url ? <> · <a href={p.profile_url} className={LINK}>{profileLabel(p.profile_url)}</a></> : null}
      </p>

      {p.bio ? (
        <>
          <div className={CARD}>
            <p className={BODY}>{p.bio}</p>
            <p className={META}>
              {p.bio_status === 'probable' ? 'From a search result, not verified' : 'Recorded'}
              {p.bio_source ? ` · ${p.bio_source}` : ''}
              {p.bio_source_url ? <> · <a href={p.bio_source_url} className={LINK}>source</a></> : null}
              {p.bio_fetched_at ? ` · ${new Date(p.bio_fetched_at).toISOString().slice(0, 10)}` : ''}
            </p>
          </div>
        </>
      ) : null}

      {p.contact_email || p.contact_phone ? (
        <>
          <div className={HEADING}><SectionHeading title="Contact" /></div>
          <div className={CARD}>
            {p.contact_email ? <p className={BODY}>{p.contact_email}</p> : null}
            {p.contact_phone ? <p className={BODY}>{p.contact_phone}</p> : null}
            <p className={META}>
              From a public source
              {p.contact_source_url ? <> · <a href={p.contact_source_url} className={LINK}>where it came from</a></> : null}
              {p.contact_found_at ? ` · found ${new Date(p.contact_found_at).toISOString().slice(0, 10)}` : ''}
            </p>
            <p className={META}>Contacts age quickly. Check it still works before using it.</p>
          </div>
        </>
      ) : null}

      <div className={HEADING}><SectionHeading title={`Roles (${roles.length})`} /></div>
      {roles.length === 0 ? <p className={BODY}>None recorded.</p> : roles.map((r: any, i: number) => (
        <div key={i} className={CARD}>
          <p className={BODY}>
            <b>{r.role_raw ?? r.role}</b> at{' '}
            <a href={`/company/${r.company_id}?token=${t}`} className={LINK}>{r.company}</a>
            {r.familiarity && r.familiarity !== 'unknown' ? ` · ${String(r.familiarity).replace(/_/g, ' ')}` : ''}
          </p>
          <p className={META}>
            {r.source}
            {r.first_seen ? ` · in our data since ${day(r.first_seen)}` : ''}
            {r.last_seen ? ` · last confirmed ${day(r.last_seen)}` : ''}
            {r.source_url ? <> · <a href={r.source_url} className={LINK}>source</a></> : ''}
          </p>
        </div>
      ))}

      {affiliations.length ? (
        <>
          <div className={HEADING}><SectionHeading title={`Fund affiliations (${affiliations.length})`} /></div>
          {affiliations.map((a: any, i: number) => (
            <div key={i} className={CARD}>
              <p className={BODY}>
                {a.role ?? 'Affiliated'} at{' '}
                <a href={`/org/${a.org_id}?token=${t}`} className={LINK}>{a.org}</a>
              </p>
              <p className={META}>
                {a.source}
                {a.source_url ? <> · <a href={a.source_url} className={LINK}>source</a></> : ''}
              </p>
            </div>
          ))}
          <p className={CAUTION}>
            A fund affiliation and a board seat are separate facts from separate sources.
            Appearing as a director on a filing does not establish which fund a person
            represents, and this page keeps the two apart for that reason.
          </p>
        </>
      ) : null}

      {sgCompanies.length ? (
        <>
          <div className={HEADING}><SectionHeading title="Singapore connections" /></div>
          {sgCompanies.map((c: any) => (
            <div key={c.id} className={CARD}>
              <p className={BODY}>
                Also connected to <a href={`/company/${c.id}?token=${t}`} className={LINK}>{c.name}</a>,
                which has a {c.match_status ?? 'possible'} Singapore entity
              </p>
            </div>
          ))}
          <p className={CAUTION}>
            This is an association from public records, not a confirmed introduction.
            Someone has to know whether EDB actually has access.
          </p>
        </>
      ) : null}
    </main>
  );
}
