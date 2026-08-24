import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  console.log('--- What SURVIVES filtering out pooled funds + real estate ---');
  const rows = await sql`
    select c.name, c.hq_state as st, c.hq_region,
           replace(c.description,'Form D industry group: ','') as industry,
           f.security_type, f.amount::numeric::bigint as amt,
           (select count(*)::int from roles r where r.company_id=c.id) as people
    from companies c join sec_filings f on f.company_id=c.id
    where c.discovered_via='form_d'
      and c.description not ilike '%Pooled Investment Fund%'
      and c.description not ilike '%Real Estate%'
      and c.description not ilike '%REITS%'
      and c.description not ilike '%Lodging%'
      and f.security_type not like '%pooled_fund%'
    order by f.amount desc nulls last`;
  for (const r of rows) {
    console.log(`  ${String(r.name).slice(0,42).padEnd(44)} ${String(r.st).padEnd(3)} ${String(r.industry).slice(0,28).padEnd(30)} ${String(r.security_type).padEnd(22)} ${r.amt ?? '-'}  (${r.people}p)`);
  }
  console.log(`\n  ${rows.length} companies survive (of 116 ingested)`);
})();
