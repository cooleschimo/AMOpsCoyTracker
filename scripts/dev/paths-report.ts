/** Warm paths for a company. Usage: npx tsx scripts/dev/paths-report.ts [companyName] */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { findWarmPaths } from '../../lib/paths';
(async () => {
  const q = getSql();
  const name = process.argv[2];
  let rows;
  if (name) {
    rows = await q`select id, name from companies where name ilike ${'%' + name + '%'} limit 5`;
  } else {
    // Companies with the most investment edges - most likely to have paths.
    rows = await q`
      select c.id, c.name, count(i.id)::int as edges from companies c
      join investments i on i.company_id=c.id group by c.id, c.name
      order by 3 desc limit 6`;
  }
  for (const r of rows) {
    const paths = await findWarmPaths(Number(r.id));
    console.log(`\n${'='.repeat(72)}\n${r.name} (#${r.id}) — ${paths.length} possible paths\n${'='.repeat(72)}`);
    for (const p of paths.slice(0, 8)) {
      console.log(`\n  [${p.score.toFixed(2)}] ${p.kind}${p.degree ? ` · degree ${p.degree}${p.coverage ? ` (${p.coverage})` : ''}` : ''}`);
      console.log(`  ${p.description}`);
      console.log(`    evidence: ${p.evidence}`);
      console.log(`    source  : ${p.sourceUrl ?? '(none)'}`);
      console.log(`    review  : ${p.reviewStatus}`);
    }
  }
})();
