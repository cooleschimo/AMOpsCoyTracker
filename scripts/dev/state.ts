import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  for (const t of ['job_snapshots','job_postings','company_assessments','dispositions','digests','source_health','opportunities']) {
    const r: any = await sql.query(`select count(*)::int n from ${t}`);
    console.log(`  ${t.padEnd(22)} ${r[0].n}`);
  }
  const s: any = await sql`select status, count(*)::int n from items group by 1 order by n desc`;
  console.log('items:', s.map((x:any)=>`${x.status} ${x.n}`).join(' · '));
})();
