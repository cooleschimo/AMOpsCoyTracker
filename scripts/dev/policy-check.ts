import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  // Items with no company attached — where sector/policy news would live.
  const unattached: any = await sql`select count(*)::int c from items where company_id is null`;
  const dropped: any = await sql`select dropped_reason, count(*)::int c from items
    where company_id is null group by 1 order by c desc limit 4`;
  console.log('items with no company:', unattached[0].c);
  console.table(dropped);
  // Anything that reads as policy or sector-level?
  const policy: any = await sql`select count(*)::int c from items
    where title ~* '(policy|regulation|tariff|export control|EDB|MTI|budget 20|national strategy)'`;
  console.log('items whose title mentions policy-ish terms:', policy[0].c);
})();
