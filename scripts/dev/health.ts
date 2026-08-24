import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const q = getSql();
  console.log('=== 1. companies with NO sector (unassessed) ===');
  console.table(await q`
    select discovered_via, count(*)::int as n
    from companies where sectors is null or array_length(sectors,1) is null
    group by 1 order by 2 desc`);

  console.log('=== 2. source health ===');
  console.table(await q`select source, status, last_count from source_health order by status, source limit 12`);

  console.log('=== 3. people per company (Form D only source of people) ===');
  console.table(await q`
    select c.discovered_via, count(distinct c.id)::int as companies,
           count(distinct r.person_id)::int as people
    from companies c left join roles r on r.company_id=c.id
    group by 1 order by 2 desc`);

  console.log('=== 4. sg_links by match_status ===');
  console.table(await q`select match_status, count(*)::int as n from sg_links group by 1`);

  console.log('=== 5. companies with a warm-path-capable edge ===');
  const r = await q`
    select count(distinct i.company_id)::int as with_investor from investments i`;
  console.table(r);
})();
