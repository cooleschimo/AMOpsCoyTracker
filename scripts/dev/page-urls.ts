import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { optional } from '../../lib/env';
(async () => {
  const sql = getSql(); const t = optional('DASHBOARD_TOKEN');
  const [p]: any = await sql`select id,name from people where title is not null limit 1`;
  const [o]: any = await sql`select o.id,o.name,count(*)::int n from organizations o
    join investments i on i.org_id=o.id group by 1,2 order by n desc limit 1`;
  console.log(`person: http://localhost:3111/person/${p.id}?token=${t}   (${p.name})`);
  console.log(`org:    http://localhost:3111/org/${o.id}?token=${t}   (${o.name}, ${o.n} companies)`);
})();
