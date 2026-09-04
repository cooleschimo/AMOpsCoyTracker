import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { optional } from '../../lib/env';
(async () => {
  const sql = getSql();
  const t = optional('DASHBOARD_TOKEN');
  const base = optional('SMOKE_BASE', 'http://localhost:3111');
  const items: any = await sql`select i.id, c.name, c.id cid, s.score, i.title
    from scores s join items i on i.id=s.item_id join companies c on c.id=i.company_id
    where s.rubric_version='item-v3' and s.score=3 and i.status='kept'
    order by (select count(*) from items d where d.cluster_id=i.id) desc limit 5`;
  console.log('ITEM PAGES (digest Review links):');
  for (const x of items) console.log(`  ${base}/item/${x.id}?token=${t}\n     ${x.name} — ${x.title.slice(0,70)}`);
  // Seed list companies with the richest graph — real targets, not the
  // Form D funds that dominate a raw people count.
  const cos: any = await sql`select c.id, c.name,
      (select count(*) from roles r where r.company_id=c.id)::int people,
      (select count(*) from investments v where v.company_id=c.id)::int inv,
      (select count(*) from sg_links g where g.subject_type='company' and g.subject_id=c.id)::int sg
    from companies c where c.discovered_via='manual'
    order by (select count(*) from investments v where v.company_id=c.id) desc,
             (select count(*) from roles r where r.company_id=c.id) desc limit 5`;
  console.log('\nCOMPANY PAGES (connection view):');
  for (const x of cos) console.log(`  ${base}/company/${x.id}?token=${t}\n     ${x.name} — ${x.people} people, ${x.inv} investors, ${x.sg} SG links`);
})();
