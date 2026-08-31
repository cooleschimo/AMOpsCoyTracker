import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r:any = await sql`select target_priority p, singapore_fit f, potential_contribution c, count(*)::int n
    from company_assessments where rubric_version='company-v2' group by 1,2,3 order by n desc limit 10`;
  console.table(r);
  const h:any = await sql`select count(*)::int n from company_assessments where rubric_version='company-v2' and target_priority=singapore_fit and singapore_fit=potential_contribution`;
  const t:any = await sql`select count(*)::int n from company_assessments where rubric_version='company-v2'`;
  console.log('all-three-identical:', h[0].n, '/', t[0].n);
})();
