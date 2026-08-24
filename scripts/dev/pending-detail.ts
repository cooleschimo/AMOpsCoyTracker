import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  console.table(await sql`
    select name, website, hq_city, hq_state,
           replace(description,'Form D industry group: ','') as industry
    from companies
    where discovered_via='form_d' and scope_status='in_scope'
      and (sectors is null or array_length(sectors,1) is null)
    order by name limit 8`);
})();
