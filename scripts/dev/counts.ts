/** Row counts across the graph. Run: npx tsx scripts/dev/counts.ts */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const tables = ['companies','people','roles','organizations','sg_links','investments',
                  'excluded_companies','sec_filings','items','scores','runs'];
  for (const t of tables) {
    // sql.query() for a conventional call; table names are from this fixed list, not user input.
    const r = await sql.query(`select count(*)::int as n from ${t}`);
    console.log(`  ${t.padEnd(20)} ${r[0].n}`);
  }
})();
