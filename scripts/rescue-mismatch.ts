/**
 * Recover items the company-name filter dropped that are about the company
 * after all. lib/mismatch.ts explains why this is worth a model call.
 *
 * Only expansion-shaped headlines from the current window are considered, so
 * the cost is bounded and the recall is aimed at the signal that matters most.
 * A restored item is marked so the decision stays auditable: `rescued_mismatch`
 * in dropped_reason says a model put it back and why, which is not the same
 * evidence grade as a headline that named the company itself.
 *
 * Run after filter-score and before score-companies — a restored item has to be
 * `kept` in time for the company scoring to read it.
 *
 * Usage: npx tsx scripts/rescue-mismatch.ts [--days 10] [--batch 12] [--limit N] [--dry]
 */
import '../lib/loadenv';
import { eq, inArray } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { items, runs } from '../lib/schema';
import { openBudget } from '../lib/budget-store';
import { EXPANSION_RE, adjudicate, type MismatchCandidate } from '../lib/mismatch';
import { pool, batched, workersFromArgs } from '../lib/pool';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const days = Number(arg('days', '10'));
  const batchSize = Number(arg('batch', '12'));
  const limit = Number(arg('limit', '0'));
  const dry = flag('dry');
  const workers = workersFromArgs();

  /**
   * Dropped as a mismatch, recent, and not already adjudicated. A company-
   * directed feed only: a wire item that names nobody has no candidate company
   * to be about, so there is nothing to decide.
   */
  const rows: any = await sqlc`
    select i.id, i.title, i.source, i.company_id, c.name as company_name, c.description
    from items i
    join companies c on c.id = i.company_id
    where i.status = 'dropped'
      and i.dropped_reason = 'company_mismatch'
      and coalesce(i.published_at, i.fetched_at) > now() - make_interval(days => ${days})
    order by i.id desc`;

  const candidates: MismatchCandidate[] = rows
    .filter((r: any) => EXPANSION_RE.test(r.title))
    .map((r: any) => ({
      itemId: r.id, companyId: r.company_id, companyName: r.company_name,
      title: r.title, source: r.source, description: r.description,
    }));

  const list = limit ? candidates.slice(0, limit) : candidates;
  console.log(`${rows.length} mismatched items in the last ${days} days`);
  console.log(`${list.length} carry expansion vocabulary and are worth adjudicating\n`);
  if (!list.length) return;

  const [run] = await db.insert(runs).values({ stage: 'rescue_mismatch' }).returning();
  const budget = await openBudget();
  const counts = {
    considered: list.length, batches: 0, verdicts: 0,
    restored: 0, confirmed_drop: 0, failed_batches: 0,
  };
  const restored: Array<{ company: string; title: string; why: string }> = [];

  try {
    const runBatch = async (batch: any[]) => {
      counts.batches++;

      const { verdicts, error } = await adjudicate(batch, budget);
      if (error) { counts.failed_batches++; console.warn(`  batch ${counts.batches}: ${error}`); return; }
      counts.verdicts += verdicts.length;

      const byId = new Map(batch.map((b) => [b.itemId, b]));
      const keep = verdicts.filter((v) => v.about);
      counts.confirmed_drop += verdicts.length - keep.length;

      for (const v of keep) {
        const c = byId.get(v.itemId)!;
        restored.push({ company: c.companyName, title: c.title, why: v.why });
        console.log(`  RESTORE [${c.companyName}] ${c.title.slice(0, 62)}\n           ${v.why}`);
      }

      if (!dry && keep.length) {
        // Kept, and pointing at itself as its own cluster head — it was never
        // clustered, having left the pipeline before that stage.
        await withRetry(() => db.update(items)
          .set({ status: 'kept', droppedReason: 'rescued_mismatch', clusterId: undefined })
          .where(inArray(items.id, keep.map((v) => v.itemId))));
        for (const v of keep) {
          await withRetry(() => db.update(items)
            .set({ clusterId: v.itemId }).where(eq(items.id, v.itemId)));
        }
        counts.restored += keep.length;
      } else if (dry) {
        counts.restored += keep.length;
      }
    };

    await pool(batched(list, batchSize), workers, runBatch, () => {
      if (!budget.halted) return false;
      console.warn(`\nBudget halted: ${budget.haltReason}`);
      return true;
    });
  } finally {
    await budget.done();
    await db.update(runs).set({
      finishedAt: new Date(), counts,
      tokensIn: budget.tokensIn, tokensOut: budget.tokensOut,
      error: budget.halted ? `halted: ${budget.haltReason}` : null,
    }).where(eq(runs.id, run.id));
  }

  console.log(`\n${restored.length} restored, ${counts.confirmed_drop} confirmed as not about the company`);
  console.log('counts:', JSON.stringify(counts));
  if (dry) console.log('DRY RUN — nothing written');
})();
