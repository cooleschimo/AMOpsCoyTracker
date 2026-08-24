/** Entity-resolution sanity check: prefer false splits over false merges. */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  console.log('--- people attached to MORE THAN ONE company (must be genuine, not merges) ---');
  const multi = await sql`
    select p.id, p.name, count(distinct r.company_id)::int as companies,
           string_agg(distinct c.name, ' | ') as at
    from people p join roles r on r.person_id=p.id join companies c on c.id=r.company_id
    group by p.id, p.name having count(distinct r.company_id) > 1
    order by 3 desc limit 15`;
  console.table(multi);

  console.log('\n--- same normalized name, DIFFERENT person rows (deliberate splits) ---');
  const splits = await sql`
    select normalized_name, count(*)::int as person_rows, string_agg(name, ' | ') as names
    from people group by normalized_name having count(*) > 1 order by 2 desc limit 15`;
  console.table(splits);

  console.log('\n--- roles missing source_url (must be ZERO) ---');
  console.table(await sql`select count(*)::int as roles_without_source_url from roles where source_url is null`);
})();
