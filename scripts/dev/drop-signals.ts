import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const n: any = await sql`select count(*)::int c from company_signals`;
  console.log('rows before drop:', n[0].c, '(test rows from a partial run)');
  await sql`drop table if exists company_signals`;
  console.log('dropped; drizzle-kit push will recreate it');
})();
