import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const q = getSql();
  console.log('--- org degree, by how the edges were sourced ---');
  console.table(await q`
    select o.name, o.sg_presence,
           count(*)::int as degree,
           count(*) filter (where i.source='portfolio_page')::int as from_scrape,
           count(*) filter (where i.source='manual')::int as from_seed
    from organizations o join investments i on i.org_id=o.id
    group by o.id, o.name, o.sg_presence
    order by 3 desc limit 12`);
  console.log('\n--- the Singapore-linked funds specifically ---');
  console.table(await q`
    select o.name, count(i.id)::int as degree,
           count(*) filter (where i.source='manual')::int as from_seed
    from organizations o left join investments i on i.org_id=o.id
    where o.name in ('GIC','Temasek','EDBI','Vertex Ventures US','Granite Asia','B Capital')
    group by o.id, o.name order by 2 desc`);
})();
