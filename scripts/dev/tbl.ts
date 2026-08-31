import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r: any = await sql`select table_name from information_schema.tables
    where table_schema='public' and table_name in ('monitoring')`;
  console.log('tables present:', r.map((x:any)=>x.table_name).join(', ') || 'neither');
})();
