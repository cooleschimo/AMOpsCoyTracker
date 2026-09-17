/**
 * Mark investors that sit in Singapore, from a hand-checked CSV.
 *
 * WHY THIS EXISTS: lib/paths.ts only returns a shared-investor path when one
 * side is Singapore-connected — the investor carries sg_presence, the other
 * company has an sg_link, or it is an EDB account. That gate is what stops
 * "both took money from a mega-fund" filling the dashboard with trivia. But it
 * is only as good as the marking: with 14 of 2,447 investors marked, 32,201 of
 * the graph's co-investment pairs resolve to 1,735 usable ones, and the rest of
 * the graph is invisible rather than filtered.
 *
 * WHAT THE HQ FIELD CANNOT SAY. A vendor profile carries a headquarters and
 * nothing else, and the funds that matter most to EDB are the crossover ones:
 * B Capital is headquartered in San Francisco and Vertex Ventures US in Palo
 * Alto, and both are in lib/funds.ts as Singapore-linked because of offices the
 * HQ field never mentions. So an HQ rule ADDS a fund and never removes one —
 * `sg_presence = true` set by hand or by lib/funds.ts is never cleared here.
 *
 * Columns:
 *   name        must match an existing organization (normalised)
 *   hq_country  the vendor's headquarters country
 *   hq_city     optional
 *   apac_office where the fund has an APAC presence that is not its HQ — the
 *               part a headquarters field cannot express
 *   source      where this was read, e.g. "CB Insights" — REQUIRED
 *   as_of       YYYY-MM-DD it was read — REQUIRED
 *
 * Usage: npx tsx scripts/enrich-org-sg.ts [--dry]
 */
import '../lib/loadenv';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { organizations, runs } from '../lib/schema';
import { parseCsv } from '../lib/csv';
import { normalizeOrgName } from '../lib/normalize';

/** Singapore by headquarters, or an APAC office naming Singapore. */
const isSg = (country?: string | null, apac?: string | null) =>
  /singapore/i.test(String(country ?? '')) || /singapore/i.test(String(apac ?? ''));

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const dry = process.argv.includes('--dry');
  const path = join(process.cwd(), 'data', 'org_sg.csv');
  if (!existsSync(path)) { console.log('no data/org_sg.csv'); return; }

  const rows = parseCsv(readFileSync(path, 'utf8'));
  if (!rows.length) { console.log('org_sg.csv has no data rows'); return; }

  const [run] = await db.insert(runs).values({ stage: 'org_sg' }).returning();
  const counts = {
    rows: 0, matched: 0, unmatched: 0, updated: 0,
    marked_sg: 0, already_sg: 0, rejected_no_source: 0,
  };
  const issues: string[] = [];

  for (const r of rows as any[]) {
    counts.rows++;
    const name = r.name?.trim();
    if (!name) continue;

    // Same rule the other loaders hold to: a fact with no source and no date is
    // the unsourced assertion the brief calls worthless.
    if (!r.source?.trim() || !r.as_of?.trim()) {
      counts.rejected_no_source++;
      issues.push(`${name}: missing source and/or as_of — rejected`);
      continue;
    }

    const norm = normalizeOrgName(name);
    const found = await withRetry(() => db
      .select({ id: organizations.id, sgPresence: organizations.sgPresence })
      .from(organizations).where(eq(organizations.normalizedName, norm)).limit(1));
    if (!found.length) { counts.unmatched++; continue; }
    counts.matched++;

    const org = found[0];
    const patch: Record<string, unknown> = {};
    if (r.hq_country?.trim()) patch.hqCountry = r.hq_country.trim();
    if (r.hq_city?.trim()) patch.hqCity = r.hq_city.trim();
    if (r.apac_office?.trim()) patch.apacOffice = r.apac_office.trim();

    /*
     * Only ever set true. A fund already marked keeps its mark whatever its
     * headquarters says, because lib/funds.ts knows about offices the vendor's
     * HQ field does not.
     */
    if (isSg(r.hq_country, r.apac_office)) {
      if (org.sgPresence) counts.already_sg++;
      else { patch.sgPresence = true; counts.marked_sg++; }
    }

    if (Object.keys(patch).length) {
      patch.infoSource = r.source.trim();
      patch.infoAsOf = r.as_of.trim();
      if (!dry) {
        await withRetry(() => db.update(organizations).set(patch)
          .where(eq(organizations.id, org.id)));
      }
      counts.updated++;
    }
  }

  // The health check reads an unfinished row as a stage still going, so the
  // row has to be closed whichever way the run ends. A dry run opens a row
  // like any other and has to close it too.
  await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
  console.log('\n=== ORGANIZATION SG PRESENCE ===');
  console.table(counts);
  if (issues.length) { console.log('\n--- issues ---'); issues.forEach((i) => console.log('  ' + i)); }

  const [tot]: any = await sqlc`
    select count(*) filter (where sg_presence is true)::int as sg,
           count(*)::int as total from organizations`;
  console.log(`\nsg_presence now on ${tot.sg} of ${tot.total} organizations`);
})();
