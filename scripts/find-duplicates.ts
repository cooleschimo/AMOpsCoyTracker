/**
 * Surface entity-resolution candidates for human review. Brief §6.
 *
 * This NEVER merges. It reports candidates ranked by confidence; /admin/merge
 * is where a person decides. Pairs already decided in entity_merges are hidden
 * so the same question is not asked twice.
 *
 * Usage: npx tsx scripts/find-duplicates.ts [--type company|person|org] [--min 0.5]
 */
import '../lib/loadenv';
import { getDb } from '../lib/db';
import { companies, people, organizations, roles, entityMerges } from '../lib/schema';
import { companyCandidates, personCandidates, orgCandidates, type Candidate } from '../lib/resolve';
import { eq } from 'drizzle-orm';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

(async () => {
  const db = getDb();
  const type = arg('type', 'all')!;
  const min = Number(arg('min', '0.5'));

  const decided = await db.select().from(entityMerges);
  const isDecided = (t: string, a: number, b: number) =>
    decided.some((d) => d.entityType === t &&
      ((d.keptId === a && d.mergedId === b) || (d.keptId === b && d.mergedId === a)));

  const show = (label: string, list: Candidate[], t: string) => {
    const fresh = list.filter((c) => c.score >= min && !isDecided(t, c.leftId, c.rightId));
    console.log(`\n${'='.repeat(76)}\n${label}: ${fresh.length} candidates (score >= ${min})\n${'='.repeat(76)}`);
    for (const c of fresh.slice(0, 40)) {
      console.log(`\n  [${c.score.toFixed(2)}] #${c.leftId} "${c.leftName}"`);
      console.log(`         vs #${c.rightId} "${c.rightName}"`);
      console.log(`         signals: ${c.signals.join(', ')}`);
      if (c.sharedContext) console.log(`         shared: ${c.sharedContext}`);
      if (c.caution) console.log(`         ⚠ ${c.caution}`);
    }
    return fresh.length;
  };

  const counts: Record<string, number> = {};

  if (type === 'all' || type === 'company') {
    const rows = await db.select({
      id: companies.id, name: companies.name, normalizedName: companies.normalizedName,
      website: companies.website, cik: companies.cik, aliases: companies.aliases,
    }).from(companies);
    counts.companies = show('COMPANIES', companyCandidates(rows), 'company');
  }

  if (type === 'all' || type === 'person') {
    const rs = await db.select({
      personId: roles.personId, companyId: roles.companyId, companyName: companies.name,
    }).from(roles).leftJoin(companies, eq(companies.id, roles.companyId));
    const byPerson = new Map<number, { ids: number[]; names: string[] }>();
    for (const r of rs) {
      if (r.personId == null) continue;
      if (!byPerson.has(r.personId)) byPerson.set(r.personId, { ids: [], names: [] });
      const e = byPerson.get(r.personId)!;
      if (r.companyId != null && !e.ids.includes(r.companyId)) {
        e.ids.push(r.companyId);
        if (r.companyName) e.names.push(r.companyName);
      }
    }
    const prows = await db.select({ id: people.id, name: people.name, normalizedName: people.normalizedName }).from(people);
    counts.people = show('PEOPLE', personCandidates(prows.map((p) => ({
      ...p,
      companyIds: byPerson.get(p.id)?.ids ?? [],
      companyNames: byPerson.get(p.id)?.names ?? [],
    }))), 'person');
  }

  if (type === 'all' || type === 'org') {
    const rows = await db.select({ id: organizations.id, name: organizations.name, normalizedName: organizations.normalizedName })
      .from(organizations);
    counts.organizations = show('ORGANIZATIONS', orgCandidates(rows), 'organization');
  }

  console.log('\n');
  console.table(counts);
  console.log('Nothing was merged. Review at /admin/merge.');
})();
