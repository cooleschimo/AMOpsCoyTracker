import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const sig: any = await sql`select count(*)::int n from company_signals
    where signal_version='signal-v5' and (expansion>=2 or partnership>=2)`;
  console.log('companies scoring 2+ on expansion or partnership:', sig[0].n);

  const withPeople: any = await sql`select count(distinct cs.company_id)::int n
    from company_signals cs join roles r on r.company_id=cs.company_id
    where cs.signal_version='signal-v5' and (cs.expansion>=2 or cs.partnership>=2)`;
  console.log('  of those, how many have ANY person attached:', withPeople[0].n);

  const byOrigin: any = await sql`select c.discovered_via, count(distinct r.person_id)::int people, count(distinct c.id)::int coys
    from roles r join companies c on c.id=r.company_id group by 1 order by people desc`;
  console.log('\nwhere the 570 people actually attach:'); console.table(byOrigin);
})();
