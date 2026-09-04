/**
 * Load the discovery guard table from data/excluded_companies.csv.
 *
 * Companies discovery must never surface again: ones that have been acquired,
 * ones whose independence is gone, ones already decided about. Discovery reads
 * this table before creating a company, so without it the same acquired names
 * arrive back in the digest every week under whatever headline mentions them.
 *
 * A loader of its own rather than a step inside a company import, because the
 * guard is permanent where an import is occasional. It used to run only as a
 * side effect of the initial company load, which meant adding an exclusion
 * required re-running an importer that had nothing to do with it.
 *
 * Idempotent: matches on normalised name and updates rather than duplicating.
 *
 * Usage: npx tsx scripts/load-exclusions.ts [--dry]
 */
import '../lib/loadenv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { excludedCompanies, runs } from '../lib/schema';
import { parseCsv } from '../lib/csv';
import { normalizeCompanyName, parsePipeList } from '../lib/normalize';
import { isExclusionReason } from '../lib/scope';

const flag = (n: string) => process.argv.includes(`--${n}`);

(async () => {
  const db = getDb();
  const dry = flag('dry');

  const rows = parseCsv(readFileSync(join(process.cwd(), 'data', 'excluded_companies.csv'), 'utf8'));
  console.log(`${rows.length} exclusions in the file\n`);

  const [run] = await db.insert(runs).values({ stage: 'load_exclusions' }).returning();
  const counts = { read: rows.length, inserted: 0, updated: 0, skipped: 0 };
  const issues: Array<{ row: number; name: string; note: string }> = [];

  for (const [idx, r] of rows.entries()) {
    const rowNum = idx + 2;
    const name = r.name?.trim();
    if (!name) { counts.skipped++; continue; }

    // A bad reason is reported but never silently dropped: the exclusion still
    // has to take effect, since the name is the part that guards discovery.
    const reason = r.reason?.trim();
    if (!reason || !isExclusionReason(reason)) {
      issues.push({ row: rowNum, name, note: `reason "${reason ?? ''}" not in EXCLUSION_REASONS` });
    }

    const norm = normalizeCompanyName(name);
    const vals = {
      name, normalizedName: norm,
      aliases: parsePipeList(r.aliases),
      reason: reason || 'independence_uncertain',
      // A bare year means the start of it; "2024-06" the start of that month.
      asOf: r.as_of ? (r.as_of.length === 4 ? `${r.as_of}-01-01` : `${r.as_of}-01`) : null,
      detail: r.detail || null,
    };

    const existing = await db.select({ id: excludedCompanies.id }).from(excludedCompanies)
      .where(eq(excludedCompanies.normalizedName, norm)).limit(1);

    if (dry) { existing.length ? counts.updated++ : counts.inserted++; continue; }
    if (existing.length) {
      await db.update(excludedCompanies).set(vals).where(eq(excludedCompanies.id, existing[0].id));
      counts.updated++;
    } else {
      await db.insert(excludedCompanies).values(vals);
      counts.inserted++;
    }
  }

  await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));

  console.log(`counts: ${JSON.stringify(counts)}`);
  if (issues.length) {
    console.log(`\n${issues.length} issue${issues.length === 1 ? '' : 's'}:`);
    for (const i of issues) console.log(`  row ${i.row} ${i.name}: ${i.note}`);
  }
  if (dry) console.log('DRY RUN — nothing written');
})();
