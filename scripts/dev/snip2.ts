import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const n: any = await sql`select count(*)::int c from items where snippet like '%<%' or snippet like '%&lt;%'`;
  console.log('still containing markup:', n[0].c);
})();
