import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const n: any = await sql`select count(*)::int c from company_assessments
    where rubric_version='company-v4' and array_length(contribution_drivers,1) > 0`;
  const t: any = await sql`select count(*)::int c from company_assessments where rubric_version='company-v4'`;
  console.log('v4 assessments with drivers:', n[0].c, '/', t[0].c);
  const d: any = await sql`select unnest(contribution_drivers) dr, count(*)::int n
    from company_assessments where rubric_version='company-v4' group by 1 order by n desc`;
  console.table(d);
})();
