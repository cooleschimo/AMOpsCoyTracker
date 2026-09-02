import '../../lib/loadenv';
import { getSql } from '../../lib/db';

const REFS: Array<[string, string]> = [
  ['company_edges', 'from_company_id'], ['company_edges', 'to_company_id'],
  ['dispositions', 'company_id'], ['drafts', 'company_id'], ['event_participants', 'company_id'],
  ['investments', 'company_id'], ['item_companies', 'company_id'], ['items', 'company_id'],
  ['opportunities', 'company_id'], ['path_reviews', 'company_id'], ['roles', 'company_id'],
  ['sec_filings', 'company_id'], ['job_postings', 'company_id'], ['job_snapshots', 'company_id'],
  ['monitoring', 'company_id'], ['company_signals', 'company_id'],
];

(async () => {
  const sql = getSql();
  const dupes: any = await sql`
    select normalized_name, min(id)::int keep_id, array_agg(id) ids
    from companies where normalized_name is not null
    group by normalized_name having count(*) > 1`;
  console.log(dupes.length, 'names to merge');

  let deleted = 0, dropped = 0;
  for (const d of dupes) {
    const drop = (d.ids as number[]).filter((i) => i !== d.keep_id);
    if (!drop.length) continue;
    for (const [t, c] of REFS) {
      // Tagged templates, not sql.unsafe with positional params: the HTTP
      // driver accepts the latter and silently applies nothing.
      try {
        await sql`update ${sql.unsafe(t)} set ${sql.unsafe(c)} = ${d.keep_id}
                  where ${sql.unsafe(c)} = any(${drop}::int[])`;
      } catch {
        // A unique key on the child means the survivor already holds that row.
        try {
          await sql`delete from ${sql.unsafe(t)} where ${sql.unsafe(c)} = any(${drop}::int[])`;
          dropped++;
        } catch { /* leave it; the delete below reports */ }
      }
    }
    try {
      const del: any = await sql`delete from companies where id = any(${drop}::int[]) returning id`;
      deleted += del.length;
    } catch (e) { console.warn('  keep', d.normalized_name, (e as Error).message.slice(0, 60)); }
  }
  console.log('deleted', deleted, 'duplicate rows;', dropped, 'redundant child rows removed');
  const [r]: any = await sql`select count(*)::int n from (select normalized_name from companies group by 1 having count(*)>1) q`;
  const [t]: any = await sql`select count(*)::int n from companies where discovered_via='news'`;
  console.log('remaining dupes:', r.n, '| news-discovered:', t.n);
})();
