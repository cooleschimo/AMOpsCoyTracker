/**
 * Form D ingestion. Brief §5.1, build step 3.
 *
 * Writes companies + people + roles + sec_filings, every edge carrying source
 * and source_url.
 *
 * ENFORCED HERE:
 *  - Discovery checks excluded_companies (name + aliases) and TAGS rather than
 *    adds. Without it we re-import exited companies from stale references.
 *  - A Form D director is an ASSOCIATION, not a fund relationship: we write
 *    roles (person->company) and NEVER affiliations (person->fund).
 *  - Amounts land in sec_filings WITH security_type and are never written to
 *    companies.total_raised.
 *  - Entity "persons" (fund LLCs filing as promoter) do not become people rows.
 *  - Nothing is deleted. Re-seen roles update last_seen.
 *
 * Usage:
 *   npx tsx scripts/ingest-formd.ts --days 3 [--all-states] [--limit 50] [--dry]
 */
import '../lib/loadenv';
import { eq, sql, and } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { companies, people, roles, secFilings, excludedCompanies, runs, sourceHealth } from '../lib/schema';
import {
  fetchDailyIndex, fetchFiling, mapRole, TARGET_STATES, regionForState, refineCaRegion,
  type FormDFiling,
} from '../lib/edgar';
import { normalizeCompanyName, normalizePersonName } from '../lib/normalize';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const db = getDb();
  const days = Number(arg('days', '3'));
  const limit = Number(arg('limit', '0'));
  const allStates = flag('all-states');
  const dry = flag('dry');

  const counts = {
    index_entries: 0, in_scope_state: 0, filings_fetched: 0, fetch_failed: 0,
    excluded_hits: 0, companies_created: 0, companies_matched: 0,
    people_created: 0, people_matched: 0, entity_persons_skipped: 0,
    roles_created: 0, roles_refreshed: 0, filings_recorded: 0,
  };
  const excludedHits: string[] = [];
  const created: Array<{ company: string; state: string | null; people: string[]; url: string }> = [];

  const [run] = await db.insert(runs).values({ stage: 'formd' }).returning();

  // Guard list, loaded once. Discovery must TAG rather than add.
  const guard = await db.select().from(excludedCompanies);
  const guardIndex = new Map<string, { name: string; reason: string }>();
  for (const g of guard) {
    guardIndex.set(g.normalizedName, { name: g.name, reason: g.reason });
    for (const a of g.aliases ?? []) guardIndex.set(normalizeCompanyName(a), { name: g.name, reason: g.reason });
  }

  const filings: FormDFiling[] = [];
  for (let back = 1; back <= days; back++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - back);
    const idx = await fetchDailyIndex(d);
    counts.index_entries += idx.length;

    for (const e of idx) {
      if (limit && filings.length >= limit) break;
      const f = await fetchFiling(e.cik, e.accession);
      if (!f) { counts.fetch_failed++; continue; }
      counts.filings_fetched++;
      const st = f.stateOrCountry;
      if (!allStates && (!st || !TARGET_STATES.has(st))) continue;
      counts.in_scope_state++;
      filings.push(f);
    }
    if (limit && filings.length >= limit) break;
  }

  for (const f of filings) {
    const norm = normalizeCompanyName(f.entityName);

    // GUARD: tag, don't add.
    const hit = guardIndex.get(norm);
    if (hit) {
      counts.excluded_hits++;
      excludedHits.push(`${f.entityName} -> excluded as "${hit.name}" (${hit.reason})`);
      continue;
    }

    if (dry) continue;

    // Company resolution: CIK first (strongest), then normalized name.
    let companyId: number;
    const byCik = f.cik
      ? await db.select({ id: companies.id }).from(companies).where(eq(companies.cik, f.cik)).limit(1)
      : [];
    const byName = byCik.length ? [] :
      await db.select({ id: companies.id }).from(companies).where(eq(companies.normalizedName, norm)).limit(1);

    if (byCik.length) { companyId = byCik[0].id; counts.companies_matched++; }
    else if (byName.length) {
      companyId = byName[0].id; counts.companies_matched++;
      await db.update(companies).set({ cik: f.cik }).where(eq(companies.id, companyId));
    } else {
      const region = f.stateOrCountry === 'CA' ? refineCaRegion(f.city) : regionForState(f.stateOrCountry);
      const [ins] = await db.insert(companies).values({
        name: f.entityName,
        normalizedName: norm,
        // Sector is UNKNOWN from a Form D. Empty array, not a guess — the
        // company-level assessment fills this in later.
        sectors: [],
        hqCity: f.city, hqState: f.stateOrCountry, hqRegion: region,
        cik: f.cik,
        foundedYear: f.yearOfInc ? Number(f.yearOfInc) || null : null,
        accountStatus: 'unknown',        // tri-state; nothing is asserted
        accountStatusSource: 'seed',
        discoveredVia: 'form_d',
        description: f.industryGroup ? `Form D industry group: ${f.industryGroup}` : null,
      }).returning({ id: companies.id });
      companyId = ins.id;
      counts.companies_created++;
    }

    // sec_filings: amount stored WITH security type, never as total_raised.
    if (f.filedAt) {
      const dupe = await db.select({ id: secFilings.id }).from(secFilings)
        .where(and(eq(secFilings.companyId, companyId), eq(secFilings.formType, f.formType), eq(secFilings.filedAt, f.filedAt)))
        .limit(1);
      if (!dupe.length) {
        await db.insert(secFilings).values({
          companyId, formType: f.formType, filedAt: f.filedAt,
          amount: f.totalAmountSold !== null ? String(f.totalAmountSold) : null,
          securityType: f.securityType,
          accessionNumber: f.accession,
          url: f.url,
        });
        counts.filings_recorded++;
      }
    }

    const madePeople: string[] = [];
    for (const p of f.relatedPersons) {
      // Entities filing as promoter are NOT people.
      if (p.isLikelyEntity) { counts.entity_persons_skipped++; continue; }

      const pnorm = normalizePersonName(p.name);
      if (!pnorm) continue;

      // Match within company context first: two different Michael Chens at two
      // companies must NOT merge (brief §6).
      const existingHere = await db.select({ id: people.id }).from(people)
        .innerJoin(roles, eq(roles.personId, people.id))
        .where(and(eq(people.normalizedName, pnorm), eq(roles.companyId, companyId)))
        .limit(1);

      let personId: number;
      if (existingHere.length) { personId = existingHere[0].id; counts.people_matched++; }
      else {
        const [np] = await db.insert(people).values({ name: p.name, normalizedName: pnorm })
          .returning({ id: people.id });
        personId = np.id;
        counts.people_created++;
        madePeople.push(`${p.name} [${p.relationships.join('/')}]`);
      }

      const today = new Date().toISOString().slice(0, 10);
      for (const rel of (p.relationships.length ? p.relationships : ['Executive Officer'])) {
        const role = mapRole(rel);
        const existingRole = await db.select({ id: roles.id }).from(roles)
          .where(and(eq(roles.personId, personId), eq(roles.companyId, companyId), eq(roles.role, role)))
          .limit(1);
        if (existingRole.length) {
          // NEVER deleted; refresh last_seen only.
          await db.update(roles).set({ lastSeen: today }).where(eq(roles.id, existingRole[0].id));
          counts.roles_refreshed++;
        } else {
          await db.insert(roles).values({
            personId, companyId, role, roleRaw: rel,
            source: 'form_d',
            sourceUrl: f.url,          // every edge carries its source URL
            firstSeen: f.filedAt || today,
            lastSeen: today,
          });
          counts.roles_created++;
        }
      }
    }
    if (madePeople.length) {
      created.push({ company: f.entityName, state: f.stateOrCountry, people: madePeople, url: f.url });
    }
  }

  if (!dry) {
    await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
    const health = {
      source: 'sec_form_d', sourceType: 'edgar',
      lastRunAt: new Date(), lastSuccessAt: new Date(),
      lastCount: counts.filings_fetched,
      status: counts.filings_fetched > 0 ? 'ok' : 'zero_volume',
    };
    const ex = await db.select({ id: sourceHealth.id }).from(sourceHealth)
      .where(eq(sourceHealth.source, 'sec_form_d')).limit(1);
    if (ex.length) await db.update(sourceHealth).set(health).where(eq(sourceHealth.id, ex[0].id));
    else await db.insert(sourceHealth).values(health);
  }

  console.log('\n=== FORM D INGESTION ===');
  console.table(counts);
  if (excludedHits.length) {
    console.log('\n--- guard table hits (tagged, NOT added) ---');
    excludedHits.forEach((h) => console.log('  ' + h));
  }
  if (created.length) {
    console.log(`\n--- companies with named people (${created.length}) ---`);
    for (const c of created.slice(0, 25)) {
      console.log(`\n  ${c.company} (${c.state})`);
      c.people.forEach((p) => console.log(`    - ${p}`));
      console.log(`    source: ${c.url}`);
    }
  }
}

main().catch((e) => { console.error('FORM D INGEST FAILED:', e); process.exit(1); });
