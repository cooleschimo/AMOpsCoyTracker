import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r: any = await sql`select c.name, cs.expansion, cs.momentum, cs.partnership, cs.why
    from company_signals cs join companies c on c.id=cs.company_id
    where cs.partnership >= 2 order by cs.partnership desc, cs.momentum desc limit 6`;
  console.log('highest partnership scores:');
  for (const x of r) console.log(`  ${x.name}: e${x.expansion} m${x.momentum} p${x.partnership} — ${String(x.why).split(' · ')[0].slice(0,70)}`);
})();
