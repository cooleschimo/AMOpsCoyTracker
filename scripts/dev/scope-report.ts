import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  console.log('=== SECTOR MATCHED DIRECTLY FROM EDGAR (no LLM needed) ===');
  console.table(await sql`
    select name, hq_state as st, sectors, scope_reason
    from companies where discovered_via='form_d' and array_length(sectors,1) > 0`);

  console.log('\n=== PENDING ASSESSMENT (the only ones needing an LLM call) ===');
  console.table(await sql`
    select name, hq_state as st, replace(description,'Form D industry group: ','') as edgar_industry
    from companies where discovered_via='form_d' and scope_status='in_scope'
      and (sectors is null or array_length(sectors,1) is null)
    order by name`);

  console.log('\n=== TOTALS ===');
  console.table(await sql`
    select scope_status, count(*)::int as n from companies
    where discovered_via='form_d' group by 1 order by 2 desc`);
  console.table(await sql`select count(*)::int as organizations_total from organizations`);
})();
