import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  console.log('--- industry group of Form D discoveries ---');
  console.table(await sql`
    select coalesce(replace(description,'Form D industry group: ',''),'(none)') as industry,
           count(*)::int as companies
    from companies where discovered_via='form_d'
    group by 1 order by 2 desc`);

  console.log('\n--- security type vs industry (the two filters combined) ---');
  console.table(await sql`
    select coalesce(replace(c.description,'Form D industry group: ',''),'(none)') as industry,
           f.security_type, count(*)::int as n
    from companies c join sec_filings f on f.company_id=c.id
    where c.discovered_via='form_d'
    group by 1,2 order by 3 desc limit 18`);
})();
