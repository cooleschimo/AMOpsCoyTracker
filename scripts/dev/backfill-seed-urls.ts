import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const q = getSql();
  const prov = 'seed:data/companies.csv#sg_apac (research-verified Aug 2026, no per-token URL)';
  await q`update investments set source_url=${prov} where source='seed' and source_url is null`;
  await q`update sg_links set source_url=${prov} where source_url is null`;
  console.log('backfilled seed provenance');
  console.table(await q`
    select source, count(*) filter (where source_url is null)::int as still_missing
    from investments group by source`);
})();
