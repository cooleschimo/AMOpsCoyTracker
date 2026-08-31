/**
 * Compare singapore_fit across rubric versions.
 *
 * company-v3 rewrote the question: it asks how well Singapore suits the most
 * plausible ENGAGEMENT (regional HQ, R&D centre, deployment, partnership),
 * rather than whether the whole company would relocate. Under v2 a frontier AI
 * lab scored LOW fit because Singapore cannot host its training compute —
 * which ranked down companies EDB is actively meeting.
 *
 * Run: npx tsx scripts/dev/fit-check.ts
 */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';

(async () => {
  const sql = getSql();

  const cov: any = await sql`select rubric_version, count(*)::int n
    from company_assessments group by 1 order by 1`;
  console.log('assessments by rubric version:');
  console.table(cov);

  const spread: any = await sql`select singapore_fit, count(*)::int n
    from company_assessments where rubric_version = 'company-v3'
    group by 1 order by n desc`;
  console.log('v3 singapore_fit spread:');
  console.table(spread);

  // The companies whose fit CHANGED between versions — the point of the rewrite.
  const moved: any = await sql`
    select c.name, v2.singapore_fit as v2_fit, v3.singapore_fit as v3_fit,
           v3.target_priority, v3.rationale
    from companies c
    join company_assessments v2 on v2.company_id = c.id and v2.rubric_version = 'company-v2'
    join company_assessments v3 on v3.company_id = c.id and v3.rubric_version = 'company-v3'
    where v2.singapore_fit is distinct from v3.singapore_fit
    order by case v3.target_priority when 'high' then 0 when 'medium' then 1 else 2 end,
             c.name
    limit 14`;
  console.log(`\nfit changed for ${moved.length} companies (v2 -> v3):`);
  for (const m of moved) {
    console.log(`  ${m.name}: ${m.v2_fit} -> ${m.v3_fit}  [${m.target_priority} priority]`);
    console.log(`     ${m.rationale}`);
  }
})();
