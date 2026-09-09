/**
 * Load investor edges and funding rounds from hand-checked CSVs.
 *
 * Round history and valuations are the one real gap in the free sources: Form D
 * gives an amount as filed on a single form, which §5.1 is explicit is not
 * cumulative funding, and portfolio pages give a name with no round attached.
 *
 * Every row carries its source and as_of, because a valuation ages within
 * months and §15 requires a figure to travel with where it came from.
 *
 * Two files, either or both:
 *   data/investors_cbi.csv  company_name, investor_name, round, announced_date, source, as_of
 *   data/funding_cbi.csv    company_name, round, announced_date, amount_usd, valuation_usd, source, as_of
 *
 * Usage: npx tsx scripts/load-funding.ts [--dry]
 */
import '../lib/loadenv';
import { eq } from 'drizzle-orm';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { getDb, getSql, withRetry } from '../lib/db';
import { companies, investments, organizations, runs } from '../lib/schema';
import { parseCsv } from '../lib/csv';
import { normalizeCompanyName, normalizeOrgName } from '../lib/normalize';

const flag = (n: string) => process.argv.includes(`--${n}`);

/** Rounds that are not an investment in this company. */
const NOT_A_ROUND = /^(acquired|merger|ipo|spac|shelf|reverse merger|bankruptcy)/i;

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const dry = flag('dry');

  const [run] = await db.insert(runs).values({ stage: 'load_funding' }).returning();
  const counts = {
    investor_rows: 0, orgs_created: 0, investments_created: 0, investments_existing: 0,
    investor_company_unmatched: 0, skipped_not_a_round: 0,
    funding_rows: 0, funding_duplicate_rows: 0, companies_updated: 0, funding_company_unmatched: 0,
  };

  /**
   * Every matching CSV in data/, so a batch added later loads with the rest and
   * nothing has to be listed here by hand.
   */
  const filesMatching = (re: RegExp) =>
    readdirSync('data').filter((f) => re.test(f)).sort().map((f) => `data/${f}`);

  // ---- investor edges ------------------------------------------------------
  const investorFiles = filesMatching(/^investors[_-].*\.csv$/);
  if (investorFiles.length) {
    const rows = investorFiles.flatMap((f) => parseCsv(readFileSync(f, 'utf8')));
    console.log(`${rows.length} investor rows from ${investorFiles.length} file(s)`);

    /**
     * Resolve every name once, up front. A per-row lookup is two round trips
     * over the HTTP driver, which at a few thousand rows takes longer than the
     * rest of the pipeline put together; the whole name space fits in memory.
     */
    const wantCompanies = new Set<string>();
    const wantOrgs = new Set<string>();
    const orgNameByNorm = new Map<string, string>();
    for (const r of rows as any[]) {
      const cn = (r.company_name ?? '').trim();
      const inm = (r.investor_name ?? '').trim();
      if (cn) wantCompanies.add(normalizeCompanyName(cn));
      if (inm) { wantOrgs.add(normalizeOrgName(inm)); orgNameByNorm.set(normalizeOrgName(inm), inm); }
    }

    const companyRows: any = await sqlc`
      select id, normalized_name from companies
      where normalized_name = any(${[...wantCompanies]}::text[])`;
    const companyByNorm = new Map<string, number>(companyRows.map((c: any) => [c.normalized_name, c.id]));

    const orgRows: any = await sqlc`
      select id, normalized_name from organizations
      where normalized_name = any(${[...wantOrgs]}::text[])`;
    const orgByNorm = new Map<string, number>(orgRows.map((o: any) => [o.normalized_name, o.id]));

    // Every investor not already known, inserted in batches rather than singly.
    const newOrgs = [...wantOrgs].filter((n) => n && !orgByNorm.has(n));
    counts.orgs_created = newOrgs.length;
    if (newOrgs.length && !dry) {
      for (let i = 0; i < newOrgs.length; i += 200) {
        const created: any = await withRetry(() => db.insert(organizations).values(
          newOrgs.slice(i, i + 200).map((norm) => ({
            name: orgNameByNorm.get(norm)!, normalizedName: norm, orgType: 'vc',
          })),
        ).onConflictDoNothing().returning({ id: organizations.id, normalizedName: organizations.normalizedName }));
        for (const o of created) orgByNorm.set(o.normalizedName, o.id);
      }
    }

    // Edges already stored, so a rerun adds only what is new.
    const existing = new Set<string>();
    const edgeRows: any = await sqlc`select org_id, company_id, coalesce(round, '') r from investments`;
    for (const e of edgeRows) existing.add(`${e.org_id}|${e.company_id}|${e.r}`);

    const pending: any[] = [];
    for (const r of rows as any[]) {
      counts.investor_rows++;
      const companyName = (r.company_name ?? '').trim();
      const investorName = (r.investor_name ?? '').trim();
      const round = (r.round ?? '').trim();
      const source = (r.source ?? '').trim();
      if (!companyName || !investorName || !source) continue;

      // An acquisition is a company-to-company event, not an investment edge.
      if (NOT_A_ROUND.test(round)) { counts.skipped_not_a_round++; continue; }

      const companyId = companyByNorm.get(normalizeCompanyName(companyName));
      if (!companyId) { counts.investor_company_unmatched++; continue; }
      const orgId = orgByNorm.get(normalizeOrgName(investorName));
      if (!orgId) continue;

      const key = `${orgId}|${companyId}|${round}`;
      if (existing.has(key)) { counts.investments_existing++; continue; }
      existing.add(key);

      pending.push({
        orgId, companyId, round: round || null,
        isLead: /^(true|1|yes)$/i.test((r.is_lead ?? '').trim()) || null,
        announcedDate: (r.announced_date ?? '').trim() || null,
        source, sourceUrl: null,
      });
      counts.investments_created++;
    }

    if (!dry) {
      for (let i = 0; i < pending.length; i += 200) {
        await withRetry(() => db.insert(investments)
          .values(pending.slice(i, i + 200)).onConflictDoNothing());
      }
    }
  }

  // ---- funding rounds ------------------------------------------------------
  const fundingFiles = filesMatching(/^funding[_-].*\.csv$/);
  if (fundingFiles.length) {
    const rows = fundingFiles.flatMap((f) => parseCsv(readFileSync(f, 'utf8')));
    console.log(`${rows.length} funding rows`);

    /**
     * Total raised is summed from the rounds, and only from rounds that are
     * actually investments. An acquisition or an IPO is not money raised, and
     * a rumoured round is not money in the bank — both are excluded, so the
     * figure means what it says.
     *
     * A company re-pulled into a later batch appears in two files, so a round
     * counts once no matter how many files carry it. Without this the total is
     * a multiple of the truth and looks plausible while being wrong.
     */
    const byCompany = new Map<string, { total: number; latestVal: number | null; latestDate: string | null; latestRound: string | null }>();
    const seenRound = new Set<string>();
    for (const r of rows as any[]) {
      counts.funding_rows++;
      const name = (r.company_name ?? '').trim();
      const round = (r.round ?? '').trim();
      if (!name) continue;

      const key = `${name}|${round}|${(r.announced_date ?? '').trim()}`;
      if (seenRound.has(key)) { counts.funding_duplicate_rows++; continue; }
      seenRound.add(key);

      const amount = Number(r.amount_usd) || 0;
      const val = Number(r.valuation_usd) || null;
      const date = (r.announced_date ?? '').trim() || null;

      const cur = byCompany.get(name) ?? { total: 0, latestVal: null, latestDate: null, latestRound: null };
      if (!NOT_A_ROUND.test(round) && !/rumored|rumoured/i.test(round)) cur.total += amount;
      if (val && (!cur.latestDate || (date && date > cur.latestDate))) {
        cur.latestVal = val; cur.latestDate = date; cur.latestRound = round || null;
      }
      byCompany.set(name, cur);
    }

    for (const [name, agg] of byCompany) {
      const [co]: any = await sqlc`
        select id, name from companies where normalized_name = ${normalizeCompanyName(name)} limit 1`;
      if (!co) { counts.funding_company_unmatched++; continue; }

      if (!dry) {
        /*
         * The CSV carries dollars — amount_usd, valuation_usd — and the columns
         * hold millions, the unit scripts/load-manual.ts writes and the one
         * round_amount_musd beside them already uses. Writing the raw figure
         * put 60000000000 and 2500 in the same column, so a reader could not
         * tell a $60B valuation from a $2,500 one without guessing at scale.
         */
        const toMusd = (v: number) => String(Math.round(v / 1e6));
        await withRetry(() => db.update(companies).set({
          totalRaised: agg.total > 0 ? toMusd(agg.total) : undefined,
          valuationEst: agg.latestVal ? toMusd(agg.latestVal) : undefined,
          // §15: a valuation is only usable with its source attached.
          valuationSource: agg.latestVal
            ? `CB Insights${agg.latestDate ? `, ${agg.latestDate}` : ''}${agg.latestRound ? ` (${agg.latestRound})` : ''}`
            : undefined,
        }).where(eq(companies.id, co.id)));
      }
      counts.companies_updated++;
      console.log(`  ${co.name}: raised $${(agg.total / 1e6).toFixed(0)}M${agg.latestVal ? `, valued $${(agg.latestVal / 1e9).toFixed(1)}B` : ''}`);
    }
  }

  await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
  console.log('\ncounts:', JSON.stringify(counts, null, 2));
  if (dry) console.log('DRY RUN — nothing written');
})();
