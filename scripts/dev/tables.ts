import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const rows = await sql`
    select table_name, (select count(*) from information_schema.columns c where c.table_name = t.table_name) as cols
    from information_schema.tables t where table_schema='public' order by table_name`;
  console.log(`${rows.length} tables:`);
  for (const r of rows) console.log(`  ${r.table_name} (${r.cols} cols)`);
})();
