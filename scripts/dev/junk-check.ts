import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const q = getSql();
  console.log('--- suspicious short/generic names from portfolio scraping ---');
  console.table(await q`
    select c.name, count(i.id)::int as edges
    from companies c join investments i on i.company_id=c.id
    where c.discovered_via='portfolio'
      and (length(c.name) <= 6 or c.name ~ '^[A-Z][a-z]+$')
    group by c.name order by 2 desc, 1 limit 25`);
  console.log('\n--- total portfolio-discovered ---');
  console.table(await q`select count(*)::int as n from companies where discovered_via='portfolio'`);
})();
