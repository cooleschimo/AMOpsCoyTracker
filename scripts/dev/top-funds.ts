import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r: any = await sql`select o.name, count(*)::int n from investments i
    join organizations o on o.id=i.org_id group by 1 order by n desc limit 24`;
  console.log(r.map((x:any)=>x.name).join(' | '));
})();
