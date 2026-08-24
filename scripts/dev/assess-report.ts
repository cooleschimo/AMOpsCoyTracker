import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  console.log('=== ASSESSED IN SCOPE ===');
  const rows = await sql`
    select c.name, c.sectors, c.hq_state as st,
           a.target_priority, a.singapore_fit, a.potential_contribution, a.confidence, a.rationale
    from companies c join company_assessments a on a.company_id=c.id
    where array_length(c.sectors,1) > 0 order by c.name`;
  for (const r of rows) {
    console.log(`\n  ${r.name}  [${r.st}]  ${r.sectors.join(', ')}`);
    console.log(`    priority ${r.target_priority} · fit ${r.singapore_fit} · contribution ${r.potential_contribution} · confidence ${r.confidence}`);
    console.log(`    ${r.rationale}`);
  }
  console.log('\n=== BAND DISTRIBUTION ===');
  console.table(await sql`
    select target_priority, count(*)::int as n from company_assessments group by 1 order by 2 desc`);
  console.log('\n=== FINAL SCOPE TOTALS (Form D discoveries) ===');
  console.table(await sql`
    select scope_status, count(*)::int as n from companies where discovered_via='form_d' group by 1 order by 2 desc`);
})();
