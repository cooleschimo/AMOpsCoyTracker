import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  console.log('--- SAME normalized person at SAME company on multiple person rows = REAL BUG ---');
  const bad = await sql`
    select p.normalized_name, c.name as company, count(distinct p.id)::int as person_rows,
           string_agg(distinct r.source_url, ' , ') as urls
    from people p join roles r on r.person_id=p.id join companies c on c.id=r.company_id
    group by p.normalized_name, c.name
    having count(distinct p.id) > 1
    order by 3 desc limit 10`;
  console.table(bad);
  console.log(`rows affected: ${bad.length}`);
})();
