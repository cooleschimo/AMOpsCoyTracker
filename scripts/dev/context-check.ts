import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  // How much other activity exists per featured company?
  const r: any = await sql`
    select c.name,
      count(*) filter (where i.source_type='news')::int news,
      count(*) filter (where i.source_type='ats')::int ats,
      (select count(*) from job_snapshots js where js.company_id=c.id)::int snaps,
      (select count(*) from sec_filings f where f.company_id=c.id)::int filings
    from items i join companies c on c.id=i.company_id
    where i.status='kept'
    group by c.id, c.name having count(*) > 2
    order by count(*) desc limit 8`;
  console.table(r);
})();
