import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const n: any = await sql`select count(*)::int c from items where snippet like '%&lt;%' or snippet like '%<%'`;
  const t: any = await sql`select count(*)::int c from items where snippet is not null`;
  console.log('snippets containing markup:', n[0].c, '/', t[0].c);
  const s: any = await sql`select id, source_type, left(snippet, 160) sn from items
    where (snippet like '%&lt;%' or snippet like '%<%') limit 3`;
  for (const x of s) console.log(`\n[${x.id}] ${x.source_type}: ${x.sn}`);
})();
