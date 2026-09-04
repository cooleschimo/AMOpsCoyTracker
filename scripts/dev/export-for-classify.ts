/**
 * Export every company for sector classification.
 *
 * Writes data/companies_to_classify.csv — id, name, description, website,
 * current sectors. The id round-trips so the loader never has to match on
 * name, which is the step that goes wrong.
 *
 * Only companies worth classifying. Portfolio scraping pulls a fund's whole
 * book, so most of what it returned is retail, consumer and general SaaS that
 * was never in scope; describing those so a classifier can file them under
 * `other` spends effort to learn nothing. A row is offered when it was seeded
 * or found through Form D, or when it already carries a sector or a real
 * description — a portfolio name with nothing attached is not classifiable
 * from what is stored and is left alone until something is.
 *
 * --all overrides, for a run that deliberately wants the whole table.
 *
 * Usage: npx tsx scripts/dev/export-for-classify.ts [--out <path>] [--all]
 */
import '../../lib/loadenv';
import { writeFileSync } from 'node:fs';
import { getSql } from '../../lib/db';

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

(async () => {
  const out = arg('out', 'data/companies_to_classify.csv');
  const all = process.argv.includes('--all');
  const rows: any = await getSql()`
    select id, name, coalesce(description, '') description,
           coalesce(website, '') website,
           array_to_string(coalesce(sectors, '{}'), '|') current_sectors,
           exists (select 1 from company_signals cs
                   where cs.company_id = companies.id
                     and cs.week_of > current_date - 60) as live
    from companies
    where ${all}
       or discovered_via in ('manual', 'form_d')
       or array_length(sectors, 1) > 0
       or (description is not null and description <> ''
           and description not ilike 'Website:%')
    order by live desc, name`;

  const esc = (v: string) => `"${String(v).replace(/"/g, '""').replace(/\s+/g, ' ').trim()}"`;
  const csv = ['id,name,description,website,current_sectors,live']
    .concat(rows.map((r: any) => [
      r.id, esc(r.name), esc(r.description), esc(r.website), esc(r.current_sectors), r.live,
    ].join(',')))
    .join('\n');
  writeFileSync(out, csv + '\n');

  const withDesc = rows.filter((r: any) => r.description && !/^Website:/i.test(r.description)).length;
  console.log(`${rows.length} companies -> ${out}${all ? ' (--all)' : ''}`);
  console.log(`  ${withDesc} have a real description; ${rows.length - withDesc} do not and will classify poorly`);
  console.log(`  ${rows.filter((r: any) => r.live).length} have a signal in the last 60 days (listed first)`);
})();
