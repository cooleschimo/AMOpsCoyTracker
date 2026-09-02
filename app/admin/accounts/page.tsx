/**
 * /admin/accounts — record how well EDB knows each company.
 *
 * The tool cannot derive this (§14): how well a company is known is internal
 * knowledge and stays
 * off personal infrastructure, so it arrives only by a person typing it. Until
 * it does, the digest cannot tell a new discovery from a company already in
 * conversation.
 *
 * Ordered by signal strength rather than alphabetically, so the companies
 * actually appearing in the digest are the ones you are asked about first.
 */
import { getSql } from '../../../lib/db';
import { hasAdmin } from '../../../lib/auth';
import { setFamiliarity } from './actions';
import {
  FAMILIARITIES, FAMILIARITY_LABELS, FAMILIARITY_HELP, type Familiarity,
} from '../../../lib/familiarity';

export const dynamic = 'force-dynamic';

const MAIN = 'mx-auto max-w-[940px] px-5 pb-16 pt-7';
const H1 = 'font-display text-2xl font-semibold tracking-tight';
const SUB = 'mb-5 text-sm text-muted-foreground';
const H2 = 'mb-2.5 mt-6 text-xs font-bold uppercase tracking-[0.08em] text-primary';
const META = 'text-xs text-muted-foreground';
const FIELD = 'mr-2 rounded-sm border border-input bg-card px-2 py-1.5 text-xs';
const BTN = 'cursor-pointer rounded-sm border border-primary bg-primary px-3.5 py-1.5 text-xs text-primary-foreground hover:bg-primary/90';
const LINK = 'text-primary link-underline hover:text-foreground';

export default async function FamiliarityPage(
  { searchParams }: { searchParams: Promise<{ token?: string; q?: string }> },
) {
  const sp = await searchParams;
  if (!(await hasAdmin(sp.token))) {
    return <main className={MAIN}><h1 className={H1}>Not authorised</h1>
      <p className={SUB}>Append <code>?token=…</code> with your ADMIN_TOKEN.</p></main>;
  }

  const sql = getSql();
  const q = (sp.q ?? '').trim();

  // Companies that have surfaced a real signal, strongest first. A search box
  // reaches anything else — the full list is 2,824 rows and not worth paging.
  const rows: any = q
    ? await sql`select c.id, c.name, c.familiarity, c.familiarity_source,
                       c.familiarity_reviewed_at, c.discovered_via, c.sectors,
                       0 as best_score, 0 as n_items
                from companies c
                where c.name ilike ${'%' + q + '%'}
                order by c.name limit 60`
    : await sql`select c.id, c.name, c.familiarity, c.familiarity_source,
                       c.familiarity_reviewed_at, c.discovered_via, c.sectors,
                       max(s.score)::int as best_score, count(distinct i.id)::int as n_items
                from companies c
                join items i on i.company_id = c.id and i.status = 'kept'
                -- count(distinct i.id): a plain count over the score join counts
                -- one row per rubric version, so an item scored five times read
                -- as five items.
                join scores s on s.item_id = i.id
                group by c.id
                order by max(s.score) desc, count(*) desc, c.name
                limit 60`;

  const counts: any = await sql`select familiarity, count(*)::int n
    from companies group by 1 order by n desc`;

  return (
    <main className={MAIN}>
      <h1 className={H1}>Company familiarity</h1>
      <p className={SUB}>
        The one thing this tool cannot work out for itself. Whether EDB already holds an
        account, is mid-conversation, or has decided not to pursue a company lives in EDB&rsquo;s
        own records — it only gets here if someone types it. Until then every company reads
        as a new discovery.
      </p>

      <p className="mb-[18px] text-xs leading-relaxed text-muted-foreground">
        {FAMILIARITIES.map((s) => (
          <span key={s} className="block">
            <b>{FAMILIARITY_LABELS[s]}</b> — {FAMILIARITY_HELP[s]}
          </span>
        ))}
      </p>

      <p className={META}>
        {counts.map((c: any) => `${FAMILIARITY_LABELS[c.familiarity as Familiarity] ?? c.familiarity}: ${c.n}`).join(' · ')}
      </p>

      <form method="get" className="mb-1.5 mt-3.5">
        <input type="hidden" name="token" value={sp.token ?? ''} />
        <input name="q" defaultValue={q} placeholder="Search all companies by name" className={`${FIELD} w-60`} />
        <button type="submit" className={BTN}>Search</button>
        {q ? <> <a href={`/admin/accounts?token=${sp.token ?? ''}`} className={LINK}>clear</a></> : null}
      </form>

      <h2 className={H2}>{q ? `Matching “${q}”` : 'Companies with a live signal, strongest first'}</h2>

      {rows.length === 0 ? <p className={SUB}>No companies found.</p> : rows.map((c: any) => (
        <div key={c.id} className="mb-2 rounded-md border border-border bg-card px-3.5 py-3">
          <p className="mb-1 text-sm font-semibold">
            <a href={`/company/${c.id}?token=${sp.token ?? ''}`} className={LINK}>{c.name}</a>
            {c.best_score ? <span className={META}> · best score {c.best_score} · {c.n_items} items</span> : null}
          </p>
          <p className={META}>
            {(c.sectors ?? []).join(', ') || 'no sectors'} · discovered via {c.discovered_via ?? 'no_status'}
          </p>
          {c.familiarity && c.familiarity !== 'no_status' ? (
            <p className={META}>
              Currently <b>{FAMILIARITY_LABELS[c.familiarity as Familiarity] ?? c.familiarity}</b>
              {c.familiarity_source ? ` — ${c.familiarity_source}` : ''}
              {c.familiarity_reviewed_at ? ` · recorded ${new Date(c.familiarity_reviewed_at).toISOString().slice(0, 10)}` : ''}
            </p>
          ) : null}
          <form action={setFamiliarity} className="mt-2">
            <input type="hidden" name="companyId" value={c.id} />
            <select name="status" defaultValue={c.familiarity ?? 'no_status'} className={FIELD}>
              {FAMILIARITIES.map((s) => (
                <option key={s} value={s}>{FAMILIARITY_LABELS[s]}</option>
              ))}
            </select>
            <input name="note" placeholder="Who, when, context (optional)" className={`${FIELD} w-60`} />
            <button type="submit" className={BTN}>Save</button>
          </form>
        </div>
      ))}
    </main>
  );
}
