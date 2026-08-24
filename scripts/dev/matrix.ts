/**
 * The §7a placement matrix: item score × company assessment.
 *
 * Brief §7a: digest placement is the matrix of the two axes, not the item score
 * alone. This report shows whether the second axis is actually populated — it
 * was 1 of 56 before `assess-companies.ts --with-signals` existed.
 *
 * Run: npx tsx scripts/dev/matrix.ts
 */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';

(async () => {
  const sql = getSql();

  const a: any = await sql`select count(*)::int n from company_assessments`;
  const b: any = await sql`select count(distinct c.id)::int n
    from scores s
    join items i on i.id = s.item_id
    join companies c on c.id = i.company_id
    join company_assessments ca on ca.company_id = c.id
    where s.rubric_version = 'item-v3' and s.score >= 2`;
  console.log('assessments:', a[0].n, '| companies with a 2+ item AND an assessment:', b[0].n);

  const d: any = await sql`select target_priority, count(*)::int n
    from company_assessments group by 1 order by n desc`;
  console.table(d);

  // The matrix itself: item score band × company priority.
  const m: any = await sql`
    select
      case when s.score = 3 then '3 strong'
           when s.score = 2 then '2 moderate'
           else '0-1 weak' end as trigger,
      coalesce(ca.target_priority, 'unassessed') as priority,
      count(*)::int n
    from scores s
    join items i on i.id = s.item_id and i.status = 'kept'
    join companies c on c.id = i.company_id
    left join company_assessments ca on ca.company_id = c.id
    where s.rubric_version = 'item-v3'
    group by 1, 2 order by 1 desc, n desc`;
  console.log('\nplacement matrix (§7a):');
  console.table(m);
})();
