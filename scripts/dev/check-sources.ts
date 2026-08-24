import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const q = getSql();
  console.log('--- edges missing source_url, by source ---');
  console.table(await q`
    select source, count(*)::int as total,
           count(*) filter (where source_url is null)::int as missing_url
    from investments group by source order by 2 desc`);
  console.table(await q`
    select source, count(*)::int as total,
           count(*) filter (where source_url is null)::int as missing_url
    from roles group by source`);
  console.table(await q`
    select link_type, count(*)::int as total,
           count(*) filter (where source_url is null)::int as missing_url
    from sg_links group by link_type`);
})();
