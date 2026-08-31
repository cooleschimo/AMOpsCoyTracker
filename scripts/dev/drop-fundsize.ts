import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const n: any = await sql`select count(*)::int c from organizations where fund_size_usd_m is not null`;
  console.log('rows with a fund size:', n[0].c, '(dropping the columns)');
  await sql`alter table organizations
    drop column if exists fund_size_usd_m,
    drop column if exists fund_size_source,
    drop column if exists fund_size_as_of`;
  console.log('dropped');
})();
