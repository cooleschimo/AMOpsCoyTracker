/**
 * /admin/accounts — record which companies EDB already engages with.
 *
 * The tool cannot derive this (§14): EDB account history is internal and stays
 * off personal infrastructure, so it arrives only by a person typing it. Until
 * it does, the digest cannot tell a new discovery from a company already in
 * conversation.
 *
 * Ordered by signal strength rather than alphabetically, so the companies
 * actually appearing in the digest are the ones you are asked about first.
 */
import { getSql } from '../../../lib/db';
import { hasAdmin } from '../../../lib/auth';
import { setAccountStatus } from './actions';
import {
  ACCOUNT_STATUSES, ACCOUNT_STATUS_LABELS, ACCOUNT_STATUS_HELP, type AccountStatus,
} from '../../../lib/accounts';

export const dynamic = 'force-dynamic';

const S = {
  main: { maxWidth: 940, margin: '0 auto', padding: '28px 20px 60px', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', color: '#111' } as const,
  h1: { fontSize: 24, margin: '0 0 4px', fontWeight: 650 } as const,
  sub: { color: '#666', fontSize: 14, margin: '0 0 20px', lineHeight: 1.5 } as const,
  h2: { fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: '#1a4d8f', margin: '26px 0 10px', fontWeight: 700 } as const,
  row: { display: 'block', border: '1px solid #e3e3e3', borderRadius: 6, padding: '12px 14px', marginBottom: 8, background: '#fff' } as const,
  name: { fontSize: 15, fontWeight: 600, margin: '0 0 4px' } as const,
  meta: { color: '#777', fontSize: 12, margin: '2px 0' } as const,
  sel: { fontSize: 13, padding: '6px 8px', borderRadius: 5, border: '1px solid #ccc', marginRight: 8 } as const,
  inp: { fontSize: 13, padding: '6px 8px', borderRadius: 5, border: '1px solid #ccc', width: 240, marginRight: 8 } as const,
  btn: { fontSize: 13, padding: '6px 14px', borderRadius: 5, border: '1px solid #1a4d8f', background: '#1a4d8f', color: '#fff', cursor: 'pointer' } as const,
  help: { fontSize: 12, color: '#777', lineHeight: 1.6, margin: '0 0 18px' } as const,
  a: { color: '#1a4d8f' } as const,
};

export default async function AccountsPage(
  { searchParams }: { searchParams: Promise<{ token?: string; q?: string }> },
) {
  const sp = await searchParams;
  if (!(await hasAdmin(sp.token))) {
    return <main style={S.main}><h1 style={S.h1}>Not authorised</h1>
      <p style={S.sub}>Append <code>?token=…</code> with your ADMIN_TOKEN.</p></main>;
  }

  const sql = getSql();
  const q = (sp.q ?? '').trim();

  // Companies that have surfaced a real signal, strongest first. A search box
  // reaches anything else — the full list is 2,824 rows and not worth paging.
  const rows: any = q
    ? await sql`select c.id, c.name, c.account_status, c.account_status_source,
                       c.account_status_reviewed_at, c.discovered_via, c.sectors,
                       0 as best_score, 0 as n_items
                from companies c
                where c.name ilike ${'%' + q + '%'}
                order by c.name limit 60`
    : await sql`select c.id, c.name, c.account_status, c.account_status_source,
                       c.account_status_reviewed_at, c.discovered_via, c.sectors,
                       max(s.score)::int as best_score, count(*)::int as n_items
                from companies c
                join items i on i.company_id = c.id and i.status = 'kept'
                join scores s on s.item_id = i.id
                group by c.id
                order by max(s.score) desc, count(*) desc, c.name
                limit 60`;

  const counts: any = await sql`select account_status, count(*)::int n
    from companies group by 1 order by n desc`;

  return (
    <main style={S.main}>
      <h1 style={S.h1}>Account status</h1>
      <p style={S.sub}>
        The one thing this tool cannot work out for itself. Whether EDB already holds an
        account, is mid-conversation, or has decided not to pursue a company lives in EDB&rsquo;s
        own records — it only gets here if someone types it. Until then every company reads
        as a new discovery.
      </p>

      <p style={S.help}>
        {ACCOUNT_STATUSES.map((s) => (
          <span key={s} style={{ display: 'block' }}>
            <b>{ACCOUNT_STATUS_LABELS[s]}</b> — {ACCOUNT_STATUS_HELP[s]}
          </span>
        ))}
      </p>

      <p style={S.meta}>
        {counts.map((c: any) => `${ACCOUNT_STATUS_LABELS[c.account_status as AccountStatus] ?? c.account_status}: ${c.n}`).join(' · ')}
      </p>

      <form method="get" style={{ margin: '14px 0 6px' }}>
        <input type="hidden" name="token" value={sp.token ?? ''} />
        <input name="q" defaultValue={q} placeholder="Search all companies by name" style={S.inp} />
        <button type="submit" style={S.btn}>Search</button>
        {q ? <> <a href={`/admin/accounts?token=${sp.token ?? ''}`} style={S.a}>clear</a></> : null}
      </form>

      <h2 style={S.h2}>{q ? `Matching “${q}”` : 'Companies with a live signal, strongest first'}</h2>

      {rows.length === 0 ? <p style={S.sub}>No companies found.</p> : rows.map((c: any) => (
        <div key={c.id} style={S.row}>
          <p style={S.name}>
            <a href={`/company/${c.id}?token=${sp.token ?? ''}`} style={S.a}>{c.name}</a>
            {c.best_score ? <span style={S.meta}> · best score {c.best_score} · {c.n_items} items</span> : null}
          </p>
          <p style={S.meta}>
            {(c.sectors ?? []).join(', ') || 'no sectors'} · discovered via {c.discovered_via ?? 'unknown'}
          </p>
          {c.account_status && c.account_status !== 'unknown' ? (
            <p style={S.meta}>
              Currently <b>{ACCOUNT_STATUS_LABELS[c.account_status as AccountStatus] ?? c.account_status}</b>
              {c.account_status_source ? ` — ${c.account_status_source}` : ''}
              {c.account_status_reviewed_at ? ` · recorded ${new Date(c.account_status_reviewed_at).toISOString().slice(0, 10)}` : ''}
            </p>
          ) : null}
          <form action={setAccountStatus} style={{ marginTop: 8 }}>
            <input type="hidden" name="companyId" value={c.id} />
            <select name="status" defaultValue={c.account_status ?? 'unknown'} style={S.sel}>
              {ACCOUNT_STATUSES.map((s) => (
                <option key={s} value={s}>{ACCOUNT_STATUS_LABELS[s]}</option>
              ))}
            </select>
            <input name="note" placeholder="Who, when, context (optional)" style={S.inp} />
            <button type="submit" style={S.btn}>Save</button>
          </form>
        </div>
      ))}
    </main>
  );
}
