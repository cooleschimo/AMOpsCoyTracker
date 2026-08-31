import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  // Remove the opportunity the smoke test created for company 1 with no owner.
  const r: any = await sql`delete from opportunities
    where company_id = 1 and owner is null and next_action is null
      and status = 'open' returning id`;
  console.log('removed smoke-test opportunities:', r.length);
})();
