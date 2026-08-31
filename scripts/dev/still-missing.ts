import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r: any = await sql`select c.name from companies c join company_signals cs on cs.company_id=c.id
    where cs.signal_version='signal-v5' and (cs.expansion>=2 or cs.partnership>=2)
      and c.total_raised is null order by c.name`;
  console.log('no funding total:', r.map((x:any)=>x.name).join(', '));
  const p: any = await sql`select c.name from companies c join company_signals cs on cs.company_id=c.id
    where cs.signal_version='signal-v5' and (cs.expansion>=2 or cs.partnership>=2)
      and not exists (select 1 from roles rr where rr.company_id=c.id) order by c.name`;
  console.log('\nno people:', p.map((x:any)=>x.name).join(', '));
})();
