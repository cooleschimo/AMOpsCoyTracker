import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const q = getSql();
  console.log('=== where every company came from ===');
  console.table(await q`select discovered_via, count(*)::int as n from companies group by 1 order by 2 desc`);

  console.log('\n=== did scraping find the SEED companies? (overlap = validation) ===');
  console.table(await q`
    select count(distinct c.id)::int as seed_companies_with_investor_edge
    from companies c join investments i on i.company_id=c.id
    where c.discovered_via='seed'`);

  console.log('\n=== how many funds back each company (multi-fund = better evidence) ===');
  console.table(await q`
    select investors, count(*)::int as companies from (
      select company_id, count(distinct org_id)::int as investors
      from investments group by company_id
    ) t group by 1 order by 1 desc limit 8`);

  console.log('\n=== fund sector coverage per funds.ts config ===');
})();
