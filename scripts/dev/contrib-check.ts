import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  // Does the band track company size, or substance?
  const r: any = await sql`select c.name, ca.potential_contribution pc, ca.contribution_drivers dr,
      ca.target_priority tp, ca.rationale
    from company_assessments ca join companies c on c.id=ca.company_id
    where ca.rubric_version='company-v4'
    order by case ca.potential_contribution when 'high' then 0 when 'medium' then 1 else 2 end, c.name
    limit 18`;
  for (const x of r) console.log(`${String(x.pc).padEnd(7)} [${(x.dr||[]).join(', ')}]  ${x.name}\n         ${x.rationale?.slice(0,105)}`);
})();
