/**
 * Step 1-3 review report. Brief process step 1.
 * Shows real DB rows: seed load, sg_links from tokens, and Form D people.
 * Run: npx tsx scripts/dev/report-step1.ts
 */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';

const hr = (t: string) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);

(async () => {
  const sql = getSql();

  hr('1. SEED LOAD — row counts');
  const counts = await sql`
    select 'companies (seed)' as t, count(*)::int as n from companies where discovered_via='seed'
    union all select 'companies (form_d)', count(*)::int from companies where discovered_via='form_d'
    union all select 'excluded_companies', count(*)::int from excluded_companies
    union all select 'organizations', count(*)::int from organizations
    union all select 'sg_links', count(*)::int from sg_links
    union all select 'investments', count(*)::int from investments
    union all select 'people', count(*)::int from people
    union all select 'roles', count(*)::int from roles
    union all select 'sec_filings', count(*)::int from sec_filings`;
  console.table(counts);

  hr('2. sg_links CREATED FROM sg_apac TOKENS (match_status from the ? suffix)');
  const links = await sql`
    select c.name as company, s.match_status, s.detail, s.link_type
    from sg_links s join companies c on c.id = s.subject_id
    where s.subject_type='company' order by s.match_status, c.name`;
  console.table(links);

  hr('3. TRI-STATE INTEGRITY — account_status must be 100% unknown after seed');
  console.table(await sql`select account_status, count(*)::int as n from companies group by 1 order by 2 desc`);

  hr('4. FORM D — companies discovered, with named people and source URLs');
  const rows = await sql`
    select c.name as company, c.hq_state as st, c.hq_region as region, c.cik,
           p.name as person, r.role, r.role_raw, r.first_seen, r.source, r.source_url
    from companies c
    join roles r on r.company_id = c.id
    join people p on p.id = r.person_id
    where c.discovered_via = 'form_d' and r.source = 'form_d'
    order by c.name, p.name limit 40`;
  for (const r of rows) {
    console.log(`\n  ${r.company}  [${r.st} / ${r.region}]  CIK ${r.cik}`);
    console.log(`    person : ${r.person}`);
    console.log(`    role   : ${r.role}  (as filed: "${r.role_raw}")  first_seen ${r.first_seen}`);
    console.log(`    source : ${r.source} -> ${r.source_url}`);
  }
  console.log(`\n  (showing ${rows.length} role edges)`);

  hr('5. sec_filings — amount ALWAYS carries security_type (never shown as "total raised")');
  console.table(await sql`
    select c.name as company, f.form_type, f.filed_at, f.security_type,
           f.amount::numeric::bigint as amount_as_filed
    from sec_filings f join companies c on c.id = f.company_id
    order by f.amount desc nulls last limit 12`);

  hr('6. SECURITY TYPE MIX — why the honesty rule matters');
  console.table(await sql`
    select security_type, count(*)::int as filings,
           sum(amount)::numeric::bigint as total_if_naively_summed
    from sec_filings group by 1 order by 2 desc`);

  hr('7. RUN LOG');
  console.table(await sql`
    select id, stage, started_at, finished_at, error, counts
    from runs order by id`);
})();
