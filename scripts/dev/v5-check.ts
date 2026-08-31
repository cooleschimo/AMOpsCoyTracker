import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r: any = await sql`select c.name, ca.apac_footprint af, ca.apac_footprint_detail afd,
      ca.prior_expansions pe, ca.prior_expansions_detail ped,
      ca.financial_health fh, ca.financial_health_detail fhd, ca.revision_note rn
    from company_assessments ca join companies c on c.id=ca.company_id
    where ca.rubric_version='company-v5' order by c.name`;
  console.log('v5 assessments:', r.length);
  for (const x of r) {
    console.log(`\n${x.name}`);
    console.log(`  APAC footprint: ${x.af} — ${x.afd ?? '(no detail)'}`);
    console.log(`  Prior expansions: ${x.pe} — ${x.ped ?? '(no detail)'}`);
    console.log(`  Financial health: ${x.fh} — ${x.fhd ?? '(no detail)'}`);
    if (x.rn) console.log(`  Revision: ${x.rn}`);
  }
})();
