/**
 * Load people and their roles from a hand-checked CSV.
 *
 * No free source gives named people for arbitrary private companies. Team-page
 * scraping reaches the companies that publish one and misses the rest, and the
 * seed list is mostly the rest — which leaves the warm paths §8 rates highest
 * with nothing to stand on.
 *
 * DESIGN_RATIONALE §14 sets the boundary this sits on: a person with a valid
 * seat reads a licensed source and records the facts, and the pipeline loads
 * what they recorded. No vendor credentials live here and no vendor API is
 * called; this reads a CSV.
 *
 * Every row carries its source and as_of. A role without provenance is an
 * assertion nobody can check, and a title ages.
 *
 * CSV columns: person_name, company_name, title, seniority, start_date,
 *              linkedin, email, profile_url, source, as_of
 *
 * Usage: npx tsx scripts/load-people.ts [--file data/people_cbi.csv] [--dry]
 */
import '../lib/loadenv';
import { and, eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { getDb, getSql, withRetry } from '../lib/db';
import { people, roles, runs } from '../lib/schema';
import { parseCsv } from '../lib/csv';
import { normalizeCompanyName, normalizePersonName } from '../lib/normalize';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

/** Map a vendor title to the role vocabulary the graph already uses. */
function roleOf(title: string, seniority: string): string {
  const t = `${title} ${seniority}`.toLowerCase();
  if (/founder/.test(t)) return 'founder';
  if (/chief executive|\bceo\b/.test(t)) return 'ceo';
  if (/partner|principal|investor/.test(t)) return 'partner';
  if (/board|director of the board|chairman|chairwoman/.test(t)) return 'director';
  if (/chief|c-level|cxo|president|\bvp\b|vice president|head of/.test(t)) return 'exec';
  return 'exec';
}

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const file = arg('file', 'data/people_cbi.csv')!;
  const dry = flag('dry');

  const rows = parseCsv(readFileSync(file, 'utf8'));
  console.log(`${rows.length} rows in ${file}`);

  const counts = {
    rows: 0, rejected: 0, company_unmatched: 0,
    people_created: 0, people_matched: 0, roles_created: 0, roles_existing: 0,
  };

  const [run] = await db.insert(runs).values({ stage: 'load_people' }).returning();

  for (const r of rows as any[]) {
    counts.rows++;
    const personName = (r.person_name ?? '').trim();
    const companyName = (r.company_name ?? '').trim();
    const title = (r.title ?? '').trim();
    const source = (r.source ?? '').trim();
    const asOf = (r.as_of ?? '').trim();

    if (!personName || !companyName || !title || !source || !asOf) {
      counts.rejected++;
      continue;
    }

    // Only companies the graph already holds. A row for a company we do not
    // track is not an error — the vendor returns every current role a person
    // has, including board seats elsewhere.
    const [co]: any = await sqlc`
      select id, name from companies where normalized_name = ${normalizeCompanyName(companyName)} limit 1`;
    if (!co) { counts.company_unmatched++; continue; }

    /**
     * Match a person within company context first (§6). Two different people
     * with one name at two companies must not merge: a duplicate person is
     * untidy, a wrongly merged one invents a warm path.
     */
    const norm = normalizePersonName(personName);
    const [existing]: any = await sqlc`
      select p.id from people p
      join roles rr on rr.person_id = p.id and rr.company_id = ${co.id}
      where p.normalized_name = ${norm} limit 1`;

    let personId: number;
    if (existing) {
      personId = existing.id;
      counts.people_matched++;
    } else {
      if (dry) { counts.people_created++; continue; }
      const [created] = await withRetry(() => db.insert(people).values({
        name: personName,
        normalizedName: norm,
        title,
        profileUrl: (r.linkedin ?? '').trim()
          ? `https://${String(r.linkedin).trim().replace(/^https?:\/\//, '')}`
          : (r.profile_url ?? '').trim() || null,
        contactEmail: (r.email ?? '').trim() || null,
        contactSourceUrl: (r.profile_url ?? '').trim() || null,
        contactFoundAt: (r.email ?? '').trim() ? new Date() : null,
        bioSource: source,
        bioStatus: 'reported',
      }).returning({ id: people.id }));
      personId = created.id;
      counts.people_created++;
    }

    const role = roleOf(title, r.seniority ?? '');
    const [dupe]: any = await sqlc`
      select id from roles where person_id = ${personId} and company_id = ${co.id} and role = ${role} limit 1`;
    if (dupe) { counts.roles_existing++; continue; }

    if (!dry) {
      await withRetry(() => db.insert(roles).values({
        personId, companyId: co.id, role, roleRaw: title,
        source, sourceUrl: (r.profile_url ?? '').trim() || null,
        firstSeen: (r.start_date ?? '').trim() || null,
        lastSeen: asOf,
      }).onConflictDoNothing());
    }
    counts.roles_created++;
    console.log(`  ${personName} — ${title} at ${co.name}`);
  }

  await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
  console.log('\ncounts:', JSON.stringify(counts, null, 2));
  if (dry) console.log('DRY RUN — nothing written');
})();
