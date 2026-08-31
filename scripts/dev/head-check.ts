import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const n: any = await sql`select count(*)::int c from items where status='kept'`;
  const u: any = await sql`select count(*)::int c from items i
    where i.status='kept' and not exists (select 1 from scores s where s.item_id=i.id and s.rubric_version='item-v6')`;
  console.log('kept heads:', n[0].c, '| unscored at item-v6:', u[0].c);
})();
