import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const k: any = await sql`select context_kind, count(*)::int c from items where source_type='context' group by 1 order by c desc`;
  console.table(k);
  for (const kind of ['export_control','sg_policy','competitor_ipa','sector']) {
    const r: any = await sql`select title, source from items where context_kind=${kind}
      order by published_at desc nulls last limit 2`;
    console.log(`\n[${kind}]`);
    for (const x of r) console.log('  -', x.title.slice(0,88), `(${x.source})`);
  }
})();
