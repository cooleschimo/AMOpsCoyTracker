/**
 * Check a backfill CSV before it is loaded.
 *
 * scripts/load-manual.ts rejects a row with no source or as_of, and silently
 * ignores a cell it cannot parse — so a typo in a number is not an error, it is
 * a missing update. This reads the same files and says what would actually be
 * written, which is the part worth seeing before a run rather than after.
 *
 * Usage: npx tsx scripts/dev/check-backfill.ts data/pub_backfill_*.csv
 */
import '../../lib/loadenv';
import { readFileSync } from 'node:fs';
import { getSql } from '../../lib/db';
import { parseCsv } from '../../lib/csv';
import { normalizeCompanyName, parseMusd, validRoundDate } from '../../lib/normalize';
import { isRoundStage } from '../../lib/scope';

const HEADER = [
  'name', 'total_raised_musd', 'valuation_musd', 'round_stage', 'round_date',
  'headcount', 'founded_year', 'hq_city', 'website', 'investors', 'notes',
  'source', 'as_of',
];

(async () => {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: check-backfill.ts <csv>...'); process.exit(1); }

  const problems: string[] = [];
  const rows: Array<Record<string, string> & { _file: string }> = [];

  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const head = text.split('\n')[0].trim().split(',');
    if (head.join(',') !== HEADER.join(',')) {
      problems.push(`${f}: header is not the expected 13 columns`);
    }
    for (const r of parseCsv(text) as any[]) rows.push({ ...r, _file: f });
  }

  const sql = getSql();
  const norms = rows.map((r) => normalizeCompanyName(r.name ?? ''));
  const found: any = await sql`
    select id, name, normalized_name, valuation_est, headcount_est, total_raised,
           round_stage, founded_year, hq_city, website
    from companies where normalized_name = any(${norms}::text[])`;
  const byNorm = new Map<string, any>(found.map((c: any) => [c.normalized_name, c]));

  const seen = new Set<string>();
  let writes = 0, noop = 0;

  for (const r of rows) {
    const label = `${r._file.split('/').pop()} ${r.name}`;
    const norm = normalizeCompanyName(r.name ?? '');

    if (seen.has(norm)) problems.push(`${label}: appears more than once across these files`);
    seen.add(norm);

    // The loader's own gate: no provenance, no row.
    if (!r.source?.trim() || !r.as_of?.trim()) { problems.push(`${label}: missing source or as_of`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.as_of.trim())) problems.push(`${label}: as_of is not YYYY-MM-DD`);

    const db = byNorm.get(norm);
    if (!db) { problems.push(`${label}: no company matches this name`); continue; }

    const patch: string[] = [];
    /*
     * Each field checked the way the loader will read it, not the way it looks
     * in the file. parseMusd tolerates '$1,200' and returns null on nonsense,
     * so a cell that silently parses to null is the case worth catching here.
     */
    const num = (col: string, field: string, current: unknown) => {
      const raw = r[col]?.trim();
      if (!raw) return;
      const v = parseMusd(raw);
      if (v === null) { problems.push(`${label}: ${col} "${raw}" does not parse`); return; }
      if (v === 0) { problems.push(`${label}: ${col} is 0 — blank means unknown, 0 is a claim`); return; }
      if (current !== null && current !== undefined && String(current) !== '' && Number(current) !== v) {
        problems.push(`${label}: ${col} would overwrite ${field}=${current} with ${v}`);
      }
      patch.push(col);
    };

    num('total_raised_musd', 'total_raised', db.total_raised);
    num('valuation_musd', 'valuation_est', db.valuation_est);
    num('headcount', 'headcount_est', db.headcount_est);
    num('founded_year', 'founded_year', db.founded_year);

    const fy = r.founded_year?.trim();
    if (fy && parseMusd(fy) !== null) {
      const y = parseMusd(fy)!;
      if (y < 1600 || y > new Date().getFullYear()) problems.push(`${label}: founded_year ${y} out of range`);
    }
    if (r.round_stage?.trim() && !isRoundStage(r.round_stage.trim())) {
      problems.push(`${label}: round_stage "${r.round_stage}" is not in ROUND_STAGES`);
    }
    if (r.round_date?.trim() && !validRoundDate(r.round_date)) {
      problems.push(`${label}: round_date "${r.round_date}" is not YYYY or YYYY-MM`);
    }
    if (r.website?.trim() && /^https?:|\//.test(r.website.trim())) {
      problems.push(`${label}: website "${r.website}" is not a bare domain`);
    }
    if (r.round_stage?.trim()) patch.push('round_stage');
    if (r.round_date?.trim()) patch.push('round_date');
    if (r.hq_city?.trim()) patch.push('hq_city');
    if (r.website?.trim()) patch.push('website');

    if (patch.length) { writes++; console.log(`  ${r.name.padEnd(24)} ${patch.join(', ')}`); }
    else { noop++; console.log(`  ${r.name.padEnd(24)} (nothing to write)`); }
  }

  console.log(`\n${rows.length} rows: ${writes} would update, ${noop} would not`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ${p}`);
    process.exit(1);
  }
  console.log('no problems');
})();
