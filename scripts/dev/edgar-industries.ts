/** Every industryGroupType EDGAR emitted across the fetched filings. */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  console.table(await sql`
    select coalesce(replace(description,'Form D industry group: ',''),'(none)') as industry,
           count(*)::int as n
    from companies where discovered_via='form_d' group by 1 order by 2 desc`);
})();
