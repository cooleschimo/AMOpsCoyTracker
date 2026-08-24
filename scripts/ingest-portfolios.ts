/**
 * VC portfolio ingestion. Brief §5.2, build step 5.
 *
 * Builds the REVERSE INDEX: organizations -> investments -> companies, so the
 * question "which funds touch this company, and where else do those funds
 * appear in our world" becomes one query.
 *
 * RULES ENFORCED:
 *  - Every investment edge carries source='portfolio_page' and the source_url.
 *  - Discovery checks excluded_companies and TAGS rather than adds.
 *  - A fund from an sgLinked house creates an sg_link on the company: portfolio
 *    membership is itself a Singapore signal (funds.ts).
 *  - An empty parse is a SOURCE-HEALTH event, never a silent skip.
 *  - New companies from a portfolio page get discovered_via='portfolio' and NO
 *    sectors — the fund's own sector tags describe the FUND, not the company.
 *
 * Usage: npx tsx scripts/ingest-portfolios.ts [--limit N] [--fund "Lux"] [--dry]
 */
import '../lib/loadenv';
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { companies, organizations, investments, excludedCompanies, sgLinks, runs, sourceHealth } from '../lib/schema';
import { FUNDS } from '../lib/funds';
import { scrapePortfolio } from '../lib/portfolio';
import { normalizeCompanyName, normalizeOrgName } from '../lib/normalize';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

(async () => {
  const db = getDb();
  const dry = process.argv.includes('--dry');
  const only = arg('fund');
  const limit = Number(arg('limit', '0'));

  let funds = FUNDS.filter((f) => f.scrape);
  if (only) funds = funds.filter((f) => f.name.toLowerCase().includes(only.toLowerCase()));
  if (limit) funds = funds.slice(0, limit);

  const [run] = await db.insert(runs).values({ stage: 'portfolios' }).returning();
  const counts = {
    funds_attempted: 0, funds_ok: 0, funds_failed: 0, funds_zero_parse: 0,
    names_found: 0, companies_created: 0, companies_matched: 0,
    excluded_hits: 0, investments_created: 0, sg_links_created: 0,
    domains_found: 0, domains_backfilled: 0,
  };
  const failures: string[] = [];

  const guard = await db.select().from(excludedCompanies);
  const guardIndex = new Map<string, string>();
  for (const g of guard) {
    guardIndex.set(g.normalizedName, `${g.name} (${g.reason})`);
    for (const a of g.aliases ?? []) guardIndex.set(normalizeCompanyName(a), `${g.name} (${g.reason})`);
  }

  for (const fund of funds) {
    counts.funds_attempted++;
    const res = await scrapePortfolio(fund.portfolioUrl);
    const health = {
      source: `portfolio:${fund.name}`, sourceType: 'portfolio_page',
      lastRunAt: new Date(),
      lastSuccessAt: res.ok && res.names.length ? new Date() : undefined,
      lastCount: res.names.length,
      status: !res.ok ? 'error' : res.names.length === 0 ? 'zero_volume' : 'ok',
      note: res.error ?? res.strategy,
    };
    if (!dry) {
      const ex = await db.select({ id: sourceHealth.id }).from(sourceHealth)
        .where(eq(sourceHealth.source, health.source)).limit(1);
      if (ex.length) await db.update(sourceHealth).set(health).where(eq(sourceHealth.id, ex[0].id));
      else await db.insert(sourceHealth).values(health);
    }

    if (!res.ok) {
      counts.funds_failed++; failures.push(`${fund.name}: ${res.error}`);
      console.log(`  ✗ ${fund.name}: ${res.error}`);
      continue;
    }
    if (!res.names.length) {
      counts.funds_zero_parse++; failures.push(`${fund.name}: zero names parsed`);
      console.log(`  ⚠ ${fund.name}: parsed 0 names (${res.strategy})`);
      continue;
    }
    counts.funds_ok++;
    counts.names_found += res.names.length;
    counts.domains_found += Object.keys(res.domains).length;
    console.log(`  ✓ ${fund.name}: ${res.names.length} names [${res.strategy}]`);
    if (dry) continue;

    // The fund's own organization row.
    const orgNorm = normalizeOrgName(fund.name);
    let orgId: number;
    const foundOrg = await db.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.normalizedName, orgNorm)).limit(1);
    if (foundOrg.length) {
      orgId = foundOrg[0].id;
      await db.update(organizations)
        .set({ orgType: 'vc', website: new URL(fund.portfolioUrl).hostname, sgPresence: fund.sgLinked ?? false })
        .where(eq(organizations.id, orgId));
    } else {
      const [o] = await db.insert(organizations).values({
        name: fund.name, normalizedName: orgNorm, orgType: 'vc',
        website: new URL(fund.portfolioUrl).hostname,
        sgPresence: fund.sgLinked ?? false,
        notes: `tier: ${fund.tier}; sectors: ${fund.sectors.join('|')}`,
      }).returning({ id: organizations.id });
      orgId = o.id;
    }

    // Domains recovered from the page, keyed by the same name text.
    const domainFor = (n: string): string | null => res.domains[n] ?? null;

    for (const name of res.names) {
      const norm = normalizeCompanyName(name);
      if (!norm) continue;

      const hit = guardIndex.get(norm);
      if (hit) { counts.excluded_hits++; continue; }   // tag, don't add

      const site = domainFor(name);

      let companyId: number;
      const found = await db.select({ id: companies.id, website: companies.website })
        .from(companies).where(eq(companies.normalizedName, norm)).limit(1);
      if (found.length) {
        companyId = found[0].id;
        counts.companies_matched++;
        // Backfill a website we did not have. Never overwrite an existing one:
        // a portfolio page can link to a redirect or an acquirer.
        if (site && !found[0].website) {
          await db.update(companies).set({ website: site }).where(eq(companies.id, companyId));
          counts.domains_backfilled++;
        }
      }
      else {
        const [c] = await db.insert(companies).values({
          name, normalizedName: norm,
          website: site,
          // The fund's sector tags describe the FUND, not this company.
          sectors: [],
          accountStatus: 'unknown',
          discoveredVia: 'portfolio',
          scopeStatus: 'in_scope',
          scopeReason: `found on ${fund.name} portfolio page; sectors pending assessment`,
        }).returning({ id: companies.id });
        companyId = c.id;
        counts.companies_created++;
      }

      const dupe = await db.select({ id: investments.id }).from(investments)
        .where(and(eq(investments.orgId, orgId), eq(investments.companyId, companyId), eq(investments.round, 'portfolio')))
        .limit(1);
      if (!dupe.length) {
        await db.insert(investments).values({
          orgId, companyId, round: 'portfolio',
          isLead: null,                       // a portfolio page does not say
          source: 'portfolio_page',
          sourceUrl: fund.portfolioUrl,       // every edge carries its source
        });
        counts.investments_created++;
      }

      // sgLinked funds: portfolio membership is itself a Singapore signal.
      if (fund.sgLinked) {
        const detail = `in ${fund.name} portfolio (Singapore-linked fund)`;
        const dl = await db.select({ id: sgLinks.id }).from(sgLinks)
          .where(sql`${sgLinks.subjectType}='company' AND ${sgLinks.subjectId}=${companyId} AND ${sgLinks.detail}=${detail}`)
          .limit(1);
        if (!dl.length) {
          await db.insert(sgLinks).values({
            subjectType: 'company', subjectId: companyId,
            linkType: 'portfolio_co_in_sg', matchStatus: 'probable',
            detail, sourceUrl: fund.portfolioUrl,
          });
          counts.sg_links_created++;
        }
      }
    }
  }

  if (!dry) await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
  console.log('\n=== PORTFOLIO INGESTION ===');
  console.table(counts);
  if (failures.length) {
    console.log('\n--- source health events (logged, not silent) ---');
    failures.forEach((f) => console.log('  ' + f));
  }
})();
