import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r:any = await sql`select target_priority p, singapore_fit f, potential_contribution c, count(*)::int n
    from company_assessments group by 1,2,3 order by n desc limit 10`;
  console.table(r);
  const h:any = await sql`select count(*)::int n from company_assessments where target_priority='high' and singapore_fit='high' and potential_contribution='high'`;
  const t:any = await sql`select count(*)::int n from company_assessments`;
  console.log('all-high:', h[0].n, '/', t[0].n);
})();
