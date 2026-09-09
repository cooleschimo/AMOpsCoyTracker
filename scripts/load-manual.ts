/**
 * Load hand-entered company enrichment. DESIGN_RATIONALE §14.
 *
 * WHY THIS EXISTS: licensed vendors (CB Insights, PitchBook) may NOT feed the
 * pipeline — CB Insights licenses per seat and non-sublicensable, PitchBook
 * bars transferring or displaying content. Both terms bind the licensee
 * directly, so an automated feed would be redistribution. §14 permits exactly
 * one use: "one-time enrichment of static company fields" through their own UI.
 *
 * This script is that path. A human looks a company up, types the facts into
 * data/manual_enrichment.csv, and they are recorded WITH their source and date
 * so the UI can always say where a number came from and how stale it is.
 *
 * Columns:
 *   name              must match an existing company (normalised)
 *   total_raised_musd integer USD millions, blank if unknown — never 0
 *   valuation_musd    integer USD millions, blank if unknown
 *   round_stage       see lib/scope.ts ROUND_STAGES
 *   round_date        YYYY or YYYY-MM
 *   headcount         integer
 *   founded_year      integer, four digits
 *   hq_city           city only; written with hq_source 'researched'
 *   website           bare domain
 *   investors         pipe-separated org names -> investments rows
 *   notes             free text for humans; NEVER parsed
 *   source            where the human read it, e.g. "CB Insights" — REQUIRED
 *   as_of             YYYY-MM-DD the human read it — REQUIRED, values go stale
 *
 * Usage: npx tsx scripts/load-manual.ts [--dry]
 */
import '../lib/loadenv';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { eq, and } from 'drizzle-orm';
import { getDb, withRetry } from '../lib/db';
import { companies, organizations, investments, runs } from '../lib/schema';
import { parseCsv } from '../lib/csv';
import { normalizeCompanyName, normalizeOrgName, parsePipeList, parseMusd, validRoundDate } from '../lib/normalize';
import { isRoundStage } from '../lib/scope';

(async () => {
  const db = getDb();
  const dry = process.argv.includes('--dry');
  const path = join(process.cwd(), 'data', 'manual_enrichment.csv');
  if (!existsSync(path)) { console.log('no data/manual_enrichment.csv'); return; }

  const rows = parseCsv(readFileSync(path, 'utf8'));
  if (!rows.length) { console.log('manual_enrichment.csv has no data rows yet'); return; }

  const [run] = await db.insert(runs).values({ stage: 'manual_enrich' }).returning();
  const counts = { rows: 0, matched: 0, unmatched: 0, updated: 0, investments_created: 0, rejected_no_source: 0 };
  const issues: string[] = [];

  for (const r of rows) {
    counts.rows++;
    const name = r.name?.trim();
    if (!name) continue;

    // Provenance is mandatory. A number with no source and no date is exactly
    // the unsourced assertion brief §15 says is worthless.
    if (!r.source?.trim() || !r.as_of?.trim()) {
      counts.rejected_no_source++;
      issues.push(`${name}: missing source and/or as_of — rejected`);
      continue;
    }

    const norm = normalizeCompanyName(name);
    const found = await withRetry(() => db
      .select({ id: companies.id, hqSource: companies.hqSource }).from(companies)
      .where(eq(companies.normalizedName, norm)).limit(1));
    if (!found.length) {
      counts.unmatched++;
      issues.push(`${name}: no matching company in the database`);
      continue;
    }
    counts.matched++;
    const companyId = found[0].id;
    const provenance = `${r.source.trim()} (read ${r.as_of.trim()})`;

    const stage = r.round_stage && isRoundStage(r.round_stage) ? r.round_stage : null;
    const patch: Record<string, unknown> = {};
    const raised = parseMusd(r.total_raised_musd);
    const val = parseMusd(r.valuation_musd);
    const head = parseMusd(r.headcount);
    if (raised !== null) patch.totalRaised = String(raised);
    if (val !== null) { patch.valuationEst = String(val); patch.valuationSource = provenance; }
    if (head !== null) patch.headcountEst = head;
    if (stage) patch.roundStage = stage;
    if (validRoundDate(r.round_date)) patch.roundDate = validRoundDate(r.round_date);

    const founded = parseMusd(r.founded_year);
    if (founded !== null && founded > 1600 && founded <= new Date().getFullYear()) {
      patch.foundedYear = founded;
    }
    const site = r.website?.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (site) patch.website = site;

    /*
     * 'researched' rather than 'manual': the figure was read out of a vendor's
     * profile, not corrected by someone who knows the company. That keeps
     * hq_source honest and leaves 'manual' meaning what the schema says it
     * means. enrich-location.ts already treats 'researched' as settled, so a
     * later news-derived guess will not overwrite this.
     */
    const city = r.hq_city?.trim();
    if (city && found[0].hqSource !== 'manual') {
      patch.hqCity = city;
      patch.hqSource = 'researched';
    }

    if (Object.keys(patch).length && !dry) {
      await withRetry(() => db.update(companies).set(patch).where(eq(companies.id, companyId)));
      counts.updated++;
    }

    for (const inv of parsePipeList(r.investors)) {
      const orgNorm = normalizeOrgName(inv);
      if (dry) { counts.investments_created++; continue; }
      const fo = await withRetry(() => db.select({ id: organizations.id }).from(organizations)
        .where(eq(organizations.normalizedName, orgNorm)).limit(1));
      const orgId = fo.length ? fo[0].id : (await withRetry(() => db.insert(organizations)
        .values({ name: inv, normalizedName: orgNorm, orgType: 'vc' })
        .returning({ id: organizations.id })))[0].id;

      const dupe = await withRetry(() => db.select({ id: investments.id }).from(investments)
        .where(and(eq(investments.orgId, orgId), eq(investments.companyId, companyId), eq(investments.round, 'manual')))
        .limit(1));
      if (!dupe.length) {
        await withRetry(() => db.insert(investments).values({
          orgId, companyId, round: 'manual',
          source: 'manual',
          // Every edge carries its source. Here that is the human and the date.
          sourceUrl: `manual:${provenance}`,
        }));
        counts.investments_created++;
      }
    }
  }

  if (!dry) await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
  console.log('\n=== MANUAL ENRICHMENT ===');
  console.table(counts);
  if (issues.length) { console.log('\n--- issues ---'); issues.forEach((i) => console.log('  ' + i)); }
})();
