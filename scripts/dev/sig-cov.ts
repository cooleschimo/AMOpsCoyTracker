import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r: any = await sql`select signal_version, count(*)::int c from company_signals group by 1 order by 1`;
  console.table(r);
})();
