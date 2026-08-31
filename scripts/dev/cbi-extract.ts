/**
 * Turn a saved CB Insights funding result into the two CSVs the loaders read.
 *
 * The connector returns more than fits in one response, so results land in a
 * file and this pulls out the rows. Run once per saved result, appending.
 *
 * Usage: npx tsx scripts/dev/cbi-extract.ts <result.json>
 */
import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: cbi-extract.ts <result.json>'); process.exit(1); }

const json = JSON.parse(readFileSync(file, 'utf8'));
const AS_OF = '2026-08-27';
const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const invPath = 'data/investors_cbi.csv';
const fundPath = 'data/funding_cbi.csv';
if (!existsSync(invPath)) {
  writeFileSync(invPath, 'company_name,investor_name,round,announced_date,source,as_of\n');
}
if (!existsSync(fundPath)) {
  writeFileSync(fundPath, 'company_name,round,announced_date,amount_usd,valuation_usd,source,as_of\n');
}

let invRows = 0, fundRows = 0;
for (const c of json.results ?? []) {
  for (const f of c.fundings ?? []) {
    appendFileSync(fundPath, [
      q(c.name), q(f.round), q(f.date),
      q(f.amount ?? ''), q(f.valuation?.maxValuation ?? ''),
      q('CB Insights'), q(AS_OF),
    ].join(',') + '\n');
    fundRows++;
    for (const inv of f.investors ?? []) {
      appendFileSync(invPath, [
        q(c.name), q(inv.name), q(f.round), q(f.date), q('CB Insights'), q(AS_OF),
      ].join(',') + '\n');
      invRows++;
    }
  }
}
console.log(`appended ${invRows} investor rows, ${fundRows} funding rows`);
for (const e of json.errors ?? []) console.log(`  unresolved: ${e.input}`);
