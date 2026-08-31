import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { WINDOW_DAYS } from '../../lib/company-signal';
(async () => {
  const sql = getSql();
  const [c]: any = await sql`select id, name, sectors from companies where name='Anthropic'`;
  const r: any = await sql`
    select context_kind, title from items
    where source_type='context'
      and coalesce(published_at, fetched_at) > now() - make_interval(days => ${WINDOW_DAYS})
      and (sectors is null or sectors && ${c.sectors ?? []}::text[])
    order by coalesce(published_at, fetched_at) desc limit 12`;
  console.log(`context shown for ${c.name} (sectors: ${c.sectors}):`);
  for (const x of r) console.log(`  [${x.context_kind}] ${x.title.slice(0,84)}`);
})();
