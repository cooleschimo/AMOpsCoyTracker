/**
 * Load fund profiles from a hand-checked CSV.
 *
 * What matters about a fund here is whether it is a route to companies EDB
 * cares about, not whether it is a good fund. Size, returns and deal counts say
 * the latter; where it sits, what it backs and whether it has an Asian office
 * say the former. §8's degree discount already penalises the largest funds,
 * because an investor shared with half the target list is trivia rather than a
 * lead.
 *
 * CSV columns: fund_name, founded_year, hq_city, hq_country, apac_office,
 *              investor_type, website, description, source, as_of
 *
 * Usage: npx tsx scripts/load-funds.ts [--file data/funds_cbi.csv] [--dry]
 */
import '../lib/loadenv';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { getDb, getSql, withRetry } from '../lib/db';
import { organizations, runs } from '../lib/schema';
import { parseCsv } from '../lib/csv';
import { normalizeOrgName } from '../lib/normalize';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const file = arg('file', 'data/funds_cbi.csv')!;
  const dry = flag('dry');

  const rows = parseCsv(readFileSync(file, 'utf8'));
  console.log(`${rows.length} rows in ${file}`);
  const counts = { rows: 0, rejected: 0, unmatched: 0, updated: 0 };

  const [run] = await db.insert(runs).values({ stage: 'load_funds' }).returning();

  for (const r of rows as any[]) {
    counts.rows++;
    const name = (r.fund_name ?? '').trim();
    const source = (r.source ?? '').trim();
    const asOf = (r.as_of ?? '').trim();
    if (!name || !source || !asOf) { counts.rejected++; continue; }

    const [org]: any = await sqlc`
      select id, name from organizations where normalized_name = ${normalizeOrgName(name)} limit 1`;
    if (!org) { counts.unmatched++; console.warn(`  no org matches "${name}"`); continue; }

    if (!dry) {
      await withRetry(() => db.update(organizations).set({
        foundedYear: Number(r.founded_year) || null,
        hqCity: (r.hq_city ?? '').trim() || null,
        hqCountry: (r.hq_country ?? '').trim() || null,
        apacOffice: (r.apac_office ?? '').trim() || null,
        orgType: (r.investor_type ?? '').trim() || org.orgType,
        website: (r.website ?? '').trim() || null,
        description: (r.description ?? '').trim() || null,
        infoSource: source,
        infoAsOf: asOf,
      }).where(eq(organizations.id, org.id)));
    }
    counts.updated++;
    console.log(`  ${org.name}: ${r.hq_city ?? '?'}${r.apac_office ? ` · APAC office ${r.apac_office}` : ''}`);
  }

  await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
  console.log('\ncounts:', JSON.stringify(counts));
  if (dry) console.log('DRY RUN — nothing written');
})();
