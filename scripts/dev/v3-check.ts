import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r: any = await sql`select c.name, cs.expansion, cs.momentum, cs.partnership, cs.why
    from company_signals cs join companies c on c.id=cs.company_id
    where cs.signal_version='signal-v3' order by c.name`;
  for (const x of r) {
    console.log(`\n${x.name}: e${x.expansion} m${x.momentum} p${x.partnership}`);
    for (const p of String(x.why).split(' · ')) console.log('   -', p);
  }
})();
