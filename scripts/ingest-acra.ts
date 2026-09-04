/**
 * ACRA resolution -> sg_links. Brief §5.3, build step 6.
 *
 * Answers the two questions §5.3 names: does this company already have a
 * Singapore entity, and do its investors?
 *
 * Matching is company-level. ACRA publishes officer counts rather than officer
 * names, so there is nothing to match a person against; anything person-level
 * here would be noise dressed as signal.
 *
 * A registration is not operational presence, so every sg_link records the ACRA
 * entity status and incorporation date, and companies.sg_entity is set true only
 * for a confirmed live entity — a struck-off shell leaves it null. Probable
 * matches stay flagged probable.
 *
 * Usage: npx tsx scripts/ingest-acra.ts [--limit N] [--dry] [--all]
 */
import '../lib/loadenv';
import { eq, and, sql, isNotNull } from 'drizzle-orm';
import { getDb, withRetry } from '../lib/db';
import { trackedCompanies } from '../lib/scope';
import { companies, organizations, sgLinks, runs, sourceHealth } from '../lib/schema';
import { lookupCompany, isLiveStatus } from '../lib/acra';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

(async () => {
  const db = getDb();
  const dry = flag('dry');
  const limit = Number(arg('limit', '0'));

  // Every company still a candidate, on the same rule the rest of the pipeline
  // uses — how one arrived says nothing about whether it holds a Singapore
  // entity. --all covers portfolio companies too, which is thousands of calls
  // against a courtesy service; the default is capped instead.
  const targets = await withRetry(() => db.select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(flag('all') ? sql`true` : trackedCompanies(companies))
    .limit(limit || 250));

  console.log(`${targets.length} companies to resolve against ACRA`);
  const [run] = await db.insert(runs).values({ stage: 'acra' }).returning();

  const counts = {
    checked: 0, with_entity: 0, none: 0, ambiguous_skipped: 0,
    links_created: 0, confirmed: 0, probable: 0,
    live_entities: 0, struck_off_only: 0,
  };
  const found: Array<{ company: string; uen: string; entity: string; status: string; inc: string | null; match: string }> = [];

  for (const c of targets) {
    counts.checked++;
    const matches = await lookupCompany(c.name);
    if (!matches.length) { counts.none++; continue; }
    counts.with_entity++;

    const live = matches.filter((m) => isLiveStatus(m.status));
    if (live.length) counts.live_entities++; else counts.struck_off_only++;

    // The best match drives the company-level fields; every match becomes a link.
    const best = matches[0];
    found.push({ company: c.name, uen: best.uen, entity: best.name, status: best.status, inc: best.incorporatedOn, match: best.match });

    if (dry) continue;

    for (const m of matches.slice(0, 5)) {
      const detail = `ACRA ${m.uen} — ${m.name} (${m.status}${m.incorporatedOn ? `, incorporated ${m.incorporatedOn}` : ''})`;
      const dupe = await withRetry(() => db.select({ id: sgLinks.id }).from(sgLinks)
        .where(sql`${sgLinks.subjectType}='company' AND ${sgLinks.subjectId}=${c.id} AND ${sgLinks.detail}=${detail}`)
        .limit(1));
      if (dupe.length) continue;
      await withRetry(() => db.insert(sgLinks).values({
        subjectType: 'company', subjectId: c.id,
        linkType: 'acra_entity',
        matchStatus: m.match,
        detail,
        sourceUrl: 'https://data.gov.sg/collections/2/view',
      }));
      counts.links_created++;
      if (m.match === 'confirmed') counts.confirmed++; else counts.probable++;
    }

    // Only a live, confirmed entity sets sg_entity. A struck-off shell and a
    // probable name match each fall short of it, and holding that line is the
    // whole point of §5.3.
    const decisive = matches.find((m) => m.match === 'confirmed' && isLiveStatus(m.status));
    await withRetry(() => db.update(companies).set({
      sgEntity: decisive ? true : null,
      sgEntityUen: decisive?.uen ?? null,
      sgMatchStatus: decisive ? 'confirmed' : matches.some((m) => m.match === 'probable') ? 'probable' : 'none',
      sgEntityStatus: best.status,
      sgIncorporated: decisive?.incorporatedOn ?? null,
    }).where(eq(companies.id, c.id)));
  }

  if (!dry) {
    await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
    const health = {
      source: 'acra', sourceType: 'acra',
      lastRunAt: new Date(), lastSuccessAt: counts.checked ? new Date() : undefined,
      lastCount: counts.with_entity,
      status: counts.checked ? 'ok' : 'zero_volume',
      note: `${counts.with_entity}/${counts.checked} companies have an ACRA entity`,
    };
    const ex = await withRetry(() => db.select({ id: sourceHealth.id }).from(sourceHealth)
      .where(eq(sourceHealth.source, 'acra')).limit(1));
    if (ex.length) await withRetry(() => db.update(sourceHealth).set(health).where(eq(sourceHealth.id, ex[0].id)));
    else await withRetry(() => db.insert(sourceHealth).values(health));
  }

  console.log('\n=== ACRA RESOLUTION ===');
  console.table(counts);
  if (found.length) {
    console.log('\n--- companies with a Singapore entity ---');
    for (const f of found) {
      console.log(`  ${f.company}`);
      console.log(`    ${f.match} · ${f.uen} · ${f.entity}`);
      console.log(`    status: ${f.status}${f.inc ? ` · incorporated ${f.inc}` : ''}`);
    }
  }
})();
