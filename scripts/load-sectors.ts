/**
 * Load classified sectors back onto companies.
 *
 * Matches on id, not name — the export carries it for exactly this reason.
 * A row whose sector is not in SECTOR_DEFS is rejected rather than written,
 * because a typo'd id would silently drop the company out of every sector
 * filter it belongs in.
 *
 * companies.sectors keeps the primary first, then the tags. In the current
 * classification file, `sector` is the broad sector and `subsector` is the
 * precise primary when known. Broad-only rows are allowed for thin evidence.
 *
 * CSV columns: id, sector, subsector, tags (pipe-separated), confidence, why
 *
 * Usage: npx tsx scripts/load-sectors.ts [--file data/sectors_classified.csv] [--dry]
 *        [--min-confidence high|medium|low]
 */
import '../lib/loadenv';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { getDb, getSql, withRetry } from '../lib/db';
import { companies, runs } from '../lib/schema';
import { parseCsv } from '../lib/csv';
import { isBroadSector, isSector, sectorBroadSector } from '../lib/subsectors';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const file = arg('file', 'data/sectors_classified.csv')!;
  const dry = flag('dry');
  const floor = RANK[arg('min-confidence', 'low')!] ?? 0;

  const rows = parseCsv(readFileSync(file, 'utf8')) as any[];
  console.log(`${rows.length} rows in ${file}`);

  const [run] = await db.insert(runs).values({ stage: 'load_sectors' }).returning();
  const counts = {
    rows: 0, updated: 0, unknown_sector: 0, unknown_tag: 0,
    broad_mismatch: 0, below_confidence: 0, no_such_company: 0,
  };
  const byS: Record<string, number> = {};

  for (const r of rows) {
    counts.rows++;
    const id = Number(r.id);
    const sector = (r.sector ?? '').trim();
    const subsector = (r.subsector ?? '').trim();
    const primary = subsector || sector;
    const conf = (r.confidence ?? 'low').trim().toLowerCase();

    if (!Number.isFinite(id)) { counts.no_such_company++; continue; }
    if (subsector && (!isBroadSector(sector) || sectorBroadSector(subsector) !== sector)) {
      counts.broad_mismatch++;
      console.warn(`  row ${id}: "${subsector}" does not belong under broad sector "${sector}"`);
      continue;
    }
    if (!isSector(primary) && !isBroadSector(primary)) {
      counts.unknown_sector++;
      console.warn(`  row ${id}: "${primary}" is not a sector`);
      continue;
    }
    if ((RANK[conf] ?? 0) < floor) { counts.below_confidence++; continue; }

    const tags = (r.tags ?? '').split('|').map((t: string) => t.trim()).filter(Boolean);
    const good = tags.filter((t: string) => {
      if (isSector(t) || isBroadSector(t)) return true;
      counts.unknown_tag++;
      console.warn(`  row ${id}: tag "${t}" is not a sector`);
      return false;
    });
    // Primary first; the rest are the secondary reading.
    const value = [primary, ...good.filter((t: string) => t !== primary)];

    if (!dry) {
      const res: any = await withRetry(() => db.update(companies)
        .set({ sectors: value }).where(eq(companies.id, id)).returning({ id: companies.id }));
      if (!res.length) { counts.no_such_company++; continue; }
    }
    counts.updated++;
    byS[sector] = (byS[sector] ?? 0) + 1;
  }

  await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
  console.log('\ndistribution:');
  for (const [s, n] of Object.entries(byS).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)} ${s}`);
  }
  console.log('\ncounts:', JSON.stringify(counts));
  if (dry) console.log('DRY RUN — nothing written');
})();
