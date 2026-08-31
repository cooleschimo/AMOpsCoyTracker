import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r: any = await sql`select c.name, cs.expansion e, cs.partnership p, cs.why
    from company_signals cs join companies c on c.id=cs.company_id
    where cs.signal_version='signal-v5' and cs.partnership>=2
    order by cs.expansion desc limit 5`;
  console.log('companies at partnership 2 (the ceiling reached):');
  for (const x of r) {
    console.log(`\n  ${x.name} (e${x.e} p${x.p})`);
    for (const w of String(x.why).split(' · ')) console.log('     -', w.slice(0,90));
  }
})();
