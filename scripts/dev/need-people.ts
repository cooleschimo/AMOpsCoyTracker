import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r: any = await sql`
    select c.name, greatest(cs.expansion, cs.partnership) sig
    from companies c join company_signals cs on cs.company_id=c.id
    where cs.signal_version='signal-v5'
      and not exists (select 1 from roles rr where rr.company_id=c.id)
      and (cs.expansion>=2 or cs.partnership>=2)
    order by sig desc, c.name`;
  console.log(r.length, 'signalling companies with no people:');
  console.log(r.map((x:any)=>x.name).join(', '));
})();
