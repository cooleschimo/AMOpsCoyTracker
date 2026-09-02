/**
 * People scraping from fund team pages and company team pages.
 *
 * Two modes:
 *   --funds      fund team pages -> people + affiliations (person -> organization)
 *   --companies  company team pages -> people + roles (person -> company)
 *
 * Funds come first because a Form D director proves a board seat rather than a
 * fund affiliation (brief §5.1, DESIGN_RATIONALE §8). The person->fund edge
 * needs independent evidence, normally the fund's team page, and this script
 * produces that second edge — the one that turns an association into a
 * checkable path.
 *
 * Every edge carries source and source_url, and re-seen people are matched
 * rather than duplicated.
 *
 * Usage:
 *   npx tsx scripts/ingest-people.ts --funds [--limit N]
 *   npx tsx scripts/ingest-people.ts --companies [--limit N] [--dry]
 */
import '../lib/loadenv';
import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { people, roles, affiliations, organizations, companies, runs, sourceHealth } from '../lib/schema';
import { FUNDS } from '../lib/funds';
import { scrapeTeamPage, findTeamPageUrl, TEAM_PATHS } from '../lib/people-scrape';
import { search } from '../lib/search-providers';
import { normalizePersonName, normalizeOrgName, normalizeDomain } from '../lib/normalize';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

/** Find a person within a scope, or create one. False splits beat false merges. */
async function upsertPerson(name: string): Promise<{ id: number; created: boolean }> {
  const db = getDb();
  const norm = normalizePersonName(name);
  const found = await withRetry(() => db.select({ id: people.id }).from(people)
    .where(eq(people.normalizedName, norm)).limit(1));
  if (found.length) return { id: found[0].id, created: false };
  const [p] = await withRetry(() => db.insert(people).values({ name, normalizedName: norm })
    .returning({ id: people.id }));
  return { id: p.id, created: true };
}

async function doFunds(limit: number, dry: boolean) {
  const db = getDb();
  const counts = { funds_tried: 0, funds_ok: 0, funds_zero: 0, people_created: 0, people_matched: 0, affiliations_created: 0 };
  const list = FUNDS.filter((f) => f.scrape).slice(0, limit || undefined);

  for (const fund of list) {
    counts.funds_tried++;
    const origin = new URL(fund.portfolioUrl).origin;
    let best: Awaited<ReturnType<typeof scrapeTeamPage>> | null = null;
    let bestUrl = '';
    for (const path of TEAM_PATHS) {
      const r = await scrapeTeamPage(origin + path);
      if (r.ok && r.people.length > (best?.people.length ?? 0)) { best = r; bestUrl = origin + path; }
      if ((best?.people.length ?? 0) >= 8) break;   // good enough; stop probing
      await new Promise((s) => setTimeout(s, 200));
    }

    const n = best?.people.length ?? 0;
    if (!dry) {
      const health = {
        source: `team:${fund.name}`, sourceType: 'team_page',
        lastRunAt: new Date(), lastSuccessAt: n ? new Date() : undefined,
        lastCount: n, status: n ? 'ok' : 'zero_volume',
        note: bestUrl || 'no team page found',
      };
      const ex = await withRetry(() => db.select({ id: sourceHealth.id }).from(sourceHealth)
        .where(eq(sourceHealth.source, health.source)).limit(1));
      if (ex.length) await withRetry(() => db.update(sourceHealth).set(health).where(eq(sourceHealth.id, ex[0].id)));
      else await withRetry(() => db.insert(sourceHealth).values(health));
    }

    if (!n || !best) { counts.funds_zero++; console.log(`  ⚠ ${fund.name}: no people`); continue; }
    counts.funds_ok++;
    console.log(`  ✓ ${fund.name}: ${n} people [${bestUrl.replace(origin, '')}]`);
    if (dry) continue;

    // The fund's organization row.
    const orgNorm = normalizeOrgName(fund.name);
    const fo = await withRetry(() => db.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.normalizedName, orgNorm)).limit(1));
    const orgId = fo.length ? fo[0].id : (await withRetry(() => db.insert(organizations)
      .values({ name: fund.name, normalizedName: orgNorm, orgType: 'vc', sgPresence: fund.sgLinked ?? false })
      .returning({ id: organizations.id })))[0].id;

    for (const person of best.people) {
      const { id: personId, created } = await upsertPerson(person.name);
      created ? counts.people_created++ : counts.people_matched++;
      const role = person.role === 'partner' ? 'partner' : person.role === 'exec' ? 'principal' : person.role;
      const dupe = await withRetry(() => db.select({ id: affiliations.id }).from(affiliations)
        .where(and(eq(affiliations.personId, personId), eq(affiliations.orgId, orgId), eq(affiliations.role, role)))
        .limit(1));
      if (!dupe.length) {
        await withRetry(() => db.insert(affiliations).values({
          personId, orgId, role,
          source: 'fund_team_page',
          sourceUrl: bestUrl,          // the independent evidence §5.1 requires
        }));
        counts.affiliations_created++;
      }
    }
  }
  return counts;
}

async function doCompanies(limit: number, dry: boolean) {
  const db = getDb();
  const counts = { tried: 0, sites_ok: 0, sites_zero: 0, found_by_search: 0, people_created: 0, people_matched: 0, roles_created: 0 };

  /**
   * Companies with a website and no people, strongest signal first.
   *
   * Without an order a limited run picks arbitrarily, and the companies that
   * matter are the ones surfacing in the digest — a warm path is only worth
   * having for a company somebody is about to approach.
   *
   * The signal is the whole ordering. It used to break ties toward the seed
   * list, which pushed every discovered company behind 112 others on a limited
   * run — the companies with the freshest triggers waited longest for the
   * people that make a warm path possible.
   */
  const targets: any = await getSql()`
    select c.id, c.name, c.website,
           coalesce((select max(greatest(cs.expansion, cs.partnership))
                       from company_signals cs where cs.company_id = c.id), 0) as signal
    from companies c
    where c.website is not null
      and coalesce(c.discovered_via, '') <> 'portfolio'
      and coalesce(c.scope_status, 'unknown') <> 'out_of_scope'
      and not exists (select 1 from roles r where r.company_id = c.id)
    order by signal desc, c.name
    limit ${limit || 40}`;

  console.log(`${targets.length} companies with a website and no people, strongest signal first`);
  for (const c of targets) {
    counts.tried++;
    const domain = normalizeDomain(c.website);
    if (!domain) continue;
    let best: Awaited<ReturnType<typeof scrapeTeamPage>> | null = null;
    let bestUrl = '';
    for (const path of TEAM_PATHS.slice(0, 5)) {
      const r = await scrapeTeamPage(`https://${domain}${path}`);
      if (r.ok && r.people.length > (best?.people.length ?? 0)) { best = r; bestUrl = `https://${domain}${path}`; }
      if ((best?.people.length ?? 0) >= 5) break;
      await new Promise((s) => setTimeout(s, 150));
    }

    // The path guesses miss a company that puts its people somewhere else.
    // Search finds the page it actually published, at one request.
    if (!(best?.people.length)) {
      const found = await findTeamPageUrl(domain, c.name, search);
      if (found) {
        const r = await scrapeTeamPage(found);
        if (r.ok && r.people.length) { best = r; bestUrl = found; counts.found_by_search++; }
      }
    }
    const n = best?.people.length ?? 0;
    if (!n || !best) { counts.sites_zero++; continue; }
    counts.sites_ok++;
    console.log(`  ✓ ${c.name}: ${n} people [${bestUrl}]`);
    if (dry) continue;

    for (const person of best.people) {
      const { id: personId, created } = await upsertPerson(person.name);
      created ? counts.people_created++ : counts.people_matched++;
      const today = new Date().toISOString().slice(0, 10);
      const dupe = await withRetry(() => db.select({ id: roles.id }).from(roles)
        .where(and(eq(roles.personId, personId), eq(roles.companyId, c.id), eq(roles.role, person.role)))
        .limit(1));
      if (!dupe.length) {
        await withRetry(() => db.insert(roles).values({
          personId, companyId: c.id, role: person.role, roleRaw: person.roleRaw,
          source: 'company_site', sourceUrl: bestUrl,
          firstSeen: today, lastSeen: today,
        }));
        counts.roles_created++;
      }
    }
  }
  return counts;
}

(async () => {
  const db = getDb();
  const dry = flag('dry');
  const limit = Number(arg('limit', '0'));
  const mode = flag('companies') ? 'companies' : 'funds';

  const [run] = await db.insert(runs).values({ stage: `people_${mode}` }).returning();
  const counts = mode === 'funds' ? await doFunds(limit, dry) : await doCompanies(limit, dry);
  if (!dry) await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));

  console.log(`\n=== PEOPLE INGESTION (${mode}) ===`);
  console.table(counts);
})();
