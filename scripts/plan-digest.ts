/**
 * Apply the §7a placement matrix to scored items and show the resulting digest
 * plan. Brief §7a, §10.
 *
 * This is the SELECTION stage, not the render — it decides what goes in and in
 * what order. Step 11 turns the plan into Outlook-safe HTML.
 *
 * Read-only by default: it prints the plan and writes nothing. Pass --save to
 * record it as a `digests` row (status 'draft'), which is what the approval
 * flow in step 11 picks up. Nothing sends from here (§11: nothing sends without
 * approval).
 *
 * Usage: npx tsx scripts/plan-digest.ts [--save] [--rubric item-v3]
 */
import '../lib/loadenv';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { digests, runs } from '../lib/schema';
import { RUBRIC_VERSION } from '../lib/rubric';
import {
  planDigest, coverageLine, SECTIONS, type PlacementInput, type Section,
} from '../lib/placement';
import type { Band } from '../lib/company-rubric';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const SECTION_TITLES: Record<Section, string> = {
  worth_a_conversation: 'WORTH A CONVERSATION',
  track: 'TRACK',
  expansion_signals: 'EXPANSION SIGNALS',
  new_on_the_radar: 'NEW ON THE RADAR',
  context: 'CONTEXT',
  exploration: 'EXPLORATION',
  watchlist: 'WATCHLIST (not featured)',
  omitted: 'OMITTED',
};

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const rubric = arg('rubric', RUBRIC_VERSION)!;
  const save = flag('save');

  /**
   * One row per SCORED CLUSTER HEAD, with the company assessment joined on.
   * The assessment is LEFT joined on purpose: an unassessed company is a real
   * state (§7a treats unknown priority as its own column), not a row to drop.
   *
   * Only the LATEST assessment per company is used — they are refreshed
   * monthly, and an old judgment should not outrank a current one.
   */
  const rows: any = await sqlc`
    select
      i.id                as item_id,
      i.company_id        as company_id,
      coalesce(c.name, '(unmatched)') as company_name,
      i.title, i.snippet, i.url, i.source, i.source_type, i.published_at,
      s.score, s.signal_type, s.sectors, s.why, s.expansion_language,
      ca.target_priority, ca.singapore_fit, ca.potential_contribution, ca.confidence,
      (select count(*)::int from items d where d.cluster_id = i.id) as cluster_size
    from scores s
    join items i on i.id = s.item_id and i.status = 'kept'
    left join companies c on c.id = i.company_id
    left join lateral (
      select * from company_assessments a
      where a.company_id = i.company_id
      order by a.assessed_at desc limit 1
    ) ca on true
    where s.rubric_version = ${rubric}
    order by s.score desc, i.id`;

  if (!rows.length) {
    console.log(`No scored items at rubric_version '${rubric}'.`);
    return;
  }

  const input: PlacementInput[] = rows.map((r: any) => ({
    itemId: r.item_id,
    companyId: r.company_id,
    companyName: r.company_name,
    score: Number(r.score),
    signalType: r.signal_type,
    sourceType: r.source_type,
    targetPriority: (r.target_priority ?? null) as Band | null,
    singaporeFit: (r.singapore_fit ?? null) as Band | null,
    publishedAt: r.published_at ? new Date(r.published_at) : null,
    clusterSize: Number(r.cluster_size) || 1,
  }));

  const plan = planDigest(input);
  const byId = new Map(rows.map((r: any) => [r.item_id, r]));

  // Coverage line (§10). "monitored/processed", never "screened".
  const mon: any = await sqlc`select count(*)::int n from companies where discovered_via in ('seed','form_d')`;
  const proc: any = await sqlc`select count(*)::int n from items`;

  console.log(coverageLine(mon[0].n, proc[0].n, plan.counts.placed));
  console.log('='.repeat(78));

  const show: Section[] = ['worth_a_conversation', 'track', 'expansion_signals', 'new_on_the_radar', 'context'];
  for (const sec of show) {
    const items = plan.sections[sec];
    if (!items.length) continue;
    console.log(`\n${SECTION_TITLES[sec]}  (${items.length})`);
    for (const it of items) {
      const r: any = byId.get(it.itemId);
      const prio = it.targetPriority ?? 'unassessed';
      console.log(`\n  ${it.companyName} — ${r.title.slice(0, 92)}`);
      console.log(`    Why now: ${r.why}`);
      console.log(`    Why EDB: priority ${prio} · SG fit ${it.singaporeFit ?? 'unassessed'} · contribution ${r.potential_contribution ?? 'unassessed'} (${r.confidence ?? 'n/a'} confidence)`);
      console.log(`    Signal: ${it.signalType} · score ${it.score} · ${it.clusterSize > 1 ? `${it.clusterSize} outlets` : 'single source'} · ${r.source}`);
    }
  }

  if (plan.exploration) {
    const r: any = byId.get(plan.exploration.itemId);
    console.log(`\n${SECTION_TITLES.exploration}  (1) — probing a signal type the ranking otherwise cut`);
    console.log(`\n  ${plan.exploration.companyName} — ${r.title.slice(0, 92)}`);
    console.log(`    Why now: ${r.why}`);
    console.log(`    Signal: ${plan.exploration.signalType} · score ${plan.exploration.score}`);
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log('watchlist (strategically relevant, no why-now this week):', plan.sections.watchlist.length);
  console.log('counts:', JSON.stringify(plan.counts));

  if (save) {
    const featured = show.flatMap((s) => plan.sections[s]).map((i) => i.itemId);
    const ids = plan.exploration ? [...featured, plan.exploration.itemId] : featured;
    // Week starting Monday, so re-running mid-week updates the same digest row.
    const now = new Date();
    const day = (now.getUTCDay() + 6) % 7;
    const weekOf = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day))
      .toISOString().slice(0, 10);

    const [run] = await db.insert(runs).values({ stage: 'plan_digest' }).returning();
    await withRetry(() => db.insert(digests).values({
      weekOf, itemIds: ids, status: 'draft', testMode: true,
    }).onConflictDoUpdate({
      target: digests.weekOf,
      set: { itemIds: ids, status: 'draft' },
    }));
    await db.update(runs).set({ finishedAt: new Date(), counts: plan.counts }).where(eq(runs.id, run.id));
    console.log(`\nsaved as digests row for week ${weekOf} (status 'draft', ${ids.length} items)`);
  } else {
    console.log('\n(read-only — pass --save to record this as a draft digest)');
  }
})();
