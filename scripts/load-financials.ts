/**
 * Load financial health from a hand-checked CSV into the company assessment.
 *
 * Free sources give almost nothing on private-company financials, so
 * `financial_health` is 'unknown' for most companies and honestly so. This is
 * the path for filling it: a person with a valid seat reads a company in a
 * vendor's own UI or an interactive connector session, and the figures land
 * here with their source and date attached.
 *
 * DESIGN_RATIONALE §14 draws the line this sits on. A human reading a licensed
 * source and recording facts is permitted; piping that vendor into the pipeline
 * as an automated feed is not, because a digest assembled from it is
 * redistribution and the seat is non-sublicensable. This script reads a CSV a
 * person produced — it holds no vendor credentials and calls no vendor API.
 *
 * Every row needs a source and an as_of date. A figure without provenance is an
 * assertion nobody can check, and a revenue number ages within months.
 *
 * CSV columns: company_name, financial_health, detail, source, as_of
 * Usage: npx tsx scripts/load-financials.ts [--file data/financials.csv] [--dry]
 */
import '../lib/loadenv';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { companyAssessments } from '../lib/schema';
import { parseCsv } from '../lib/csv';
import { normalizeCompanyName } from '../lib/normalize';
import { isBand } from '../lib/company-rubric';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const file = arg('file', 'data/financials.csv')!;
  const dry = flag('dry');

  const rows = parseCsv(readFileSync(file, 'utf8'));
  console.log(`${rows.length} rows in ${file}`);

  const counts = { rows: 0, matched: 0, unmatched: 0, rejected: 0, updated: 0 };

  for (const r of rows as any[]) {
    counts.rows++;
    const name = (r.company_name ?? '').trim();
    const band = (r.financial_health ?? '').trim();
    const source = (r.source ?? '').trim();
    const asOf = (r.as_of ?? '').trim();

    // Provenance is not optional: a figure whose origin and date are unknown
    // cannot be shown to a regional director as fact.
    if (!name || !source || !asOf) {
      counts.rejected++;
      console.warn(`  REJECTED ${name || '(no name)'}: needs source and as_of`);
      continue;
    }
    if (!isBand(band)) {
      counts.rejected++;
      console.warn(`  REJECTED ${name}: financial_health must be high|medium|low|unknown`);
      continue;
    }

    const norm = normalizeCompanyName(name);
    const [co]: any = await sqlc`
      select id, name from companies where normalized_name = ${norm} limit 1`;
    if (!co) {
      counts.unmatched++;
      console.warn(`  no company matches "${name}"`);
      continue;
    }
    counts.matched++;

    const [latest]: any = await sqlc`
      select id from company_assessments where company_id = ${co.id}
      order by assessed_at desc limit 1`;
    if (!latest) {
      console.warn(`  ${co.name}: no assessment yet — run assess-companies first`);
      continue;
    }

    if (!dry) {
      await withRetry(() => db.update(companyAssessments).set({
        financialHealth: band,
        financialHealthDetail: (r.detail ?? '').trim() || null,
        financialSource: source,
        financialAsOf: asOf,
      }).where(eq(companyAssessments.id, latest.id)));
    }
    counts.updated++;
    console.log(`  ${co.name}: ${band} — ${r.detail ?? ''} (${source}, ${asOf})`);
  }

  console.log('\ncounts:', JSON.stringify(counts));
  if (dry) console.log('DRY RUN — nothing written');
})();
