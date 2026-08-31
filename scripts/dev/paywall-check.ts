import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r: any = await sql`select source, count(*)::int n from items
    where status='kept' group by 1 order by n desc limit 25`;
  const PAY = /wall street journal|financial times|bloomberg|the information|the economist|business insider|barron|new york times|washington post|nikkei|seeking alpha|forbes/i;
  let paywalled = 0, open_ = 0;
  for (const x of r) { if (PAY.test(x.source)) { paywalled += x.n; console.log('PAYWALLED', x.source, x.n); } else open_ += x.n; }
  console.log('\nkept items from likely-paywalled sources:', paywalled, '| others:', open_);
})();
