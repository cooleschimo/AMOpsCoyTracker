/**
 * Company-to-company edges from news. Brief §4, §12 step 16.
 *
 * `lib/paths.ts` has treated `company_edges` as a warm path since it was
 * written, and the table was empty — so an acquisition or a partnership, the
 * two relationships an RD can actually open a conversation with, never
 * produced a path. This fills it.
 *
 * The extraction rules live in lib/company-edges.ts. What this adds is the
 * half that needs the database: which headlines to read, how a name becomes a
 * company id, and the write.
 *
 * Usage: npx tsx scripts/ingest-edges.ts [--limit N] [--dry]
 */
import '../lib/loadenv';
import { eq, sql as dsql } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { companyEdges, runs } from '../lib/schema';
import { canonicalEdge, extractEdges, type EdgeCandidate } from '../lib/company-edges';
import { normalizeCompanyName } from '../lib/normalize';
import { Budget } from '../lib/budget';
import { pool, batched, workersFromArgs } from '../lib/pool';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

/** Batch size matches the rest of the pipeline: small enough that one bad response is cheap. */
const BATCH = 12;

(async () => {
  const dry = flag('dry');
  const workers = workersFromArgs();
  const limit = Number(arg('limit', '600'));
  const db = getDb();
  const sqlc = getSql();

  /*
   * Only headlines that name a second company can carry an edge, and the
   * cheapest filter for that is the item's own company plus another known name
   * appearing in the title. Reading every kept item would spend the allowance
   * on thousands of headlines about one company doing something alone.
   */
  const known: any = await withRetry(() => sqlc`
    select id, name, normalized_name from companies where normalized_name is not null`);
  const byNorm = new Map<string, number>(
    known.map((k: any) => [k.normalized_name as string, Number(k.id)]),
  );

  const rows: any = await withRetry(() => sqlc`
    select i.id, i.title, i.snippet, i.url, i.published_at, i.company_id
    from items i
    where i.status = 'kept' and i.company_id is not null and i.title is not null
      and not exists (select 1 from company_edges e where e.source_url = i.url)
    order by i.published_at desc nulls last
    limit ${limit}`);

  /*
   * A headline qualifies when it names a company other than the one the item
   * is filed under. Matched on word boundaries: a substring test makes "Meta"
   * match "Metabolic" and fills the table with edges nobody stated.
   */
  const candidates: Array<EdgeCandidate & { companyId: number }> = [];
  for (const r of rows) {
    const title = String(r.title);
    const hay = ` ${title.toLowerCase()} `;
    let other = false;
    for (const k of known) {
      const id = Number(k.id);
      if (id === Number(r.company_id)) continue;
      const name = String(k.name).toLowerCase();
      if (name.length < 4) continue;
      const re = new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
      if (re.test(hay)) { other = true; break; }
    }
    if (!other) continue;
    candidates.push({
      itemId: Number(r.id), title, snippet: r.snippet, url: String(r.url),
      publishedAt: r.published_at ? String(r.published_at) : null,
      companyId: Number(r.company_id),
    });
  }

  console.log(`${rows.length} items read, ${candidates.length} name a second company we track`);

  const [run] = await db.insert(runs).values({ stage: 'ingest_edges' }).returning();
  const budget = new Budget();
  const counts = {
    items_read: rows.length,
    candidates: candidates.length,
    batches: 0,
    failed_batches: 0,
    extracted: 0,
    unresolved_name: 0,
    self_edge: 0,
    written: 0,
  };

  const runBatch = async (batch: typeof candidates) => {
    counts.batches++;
    const { edges, failed } = await extractEdges(batch, { budget });
    if (failed) { counts.failed_batches++; return; }
    counts.extracted += edges.length;

    for (const e of edges) {
      const item = batch[e.n - 1];
      if (!item) continue;
      const a = byNorm.get(normalizeCompanyName(e.from));
      const b = byNorm.get(normalizeCompanyName(e.to));
      // Both sides must already be in the graph: an edge to a company nothing
      // else tracks leads nowhere, which is what it means not to be a path.
      if (!a || !b) { counts.unresolved_name++; continue; }

      const canon = canonicalEdge(a, b, e.relation);
      if (!canon) { counts.self_edge++; continue; }

      console.log(`  ${e.from} --${e.relation}--> ${e.to}${e.why ? `  (${e.why})` : ''}`);
      if (dry) { counts.written++; continue; }

      await withRetry(() => db.insert(companyEdges).values({
        ...canon,
        relation: e.relation,
        announcedDate: item.publishedAt ? item.publishedAt.slice(0, 10) : null,
        source: 'news',
        sourceUrl: item.url,
      }).onConflictDoNothing({
        target: [companyEdges.fromCompanyId, companyEdges.toCompanyId, companyEdges.relation],
      }));
      counts.written++;
    }
  };

  await pool(batched(candidates, BATCH), workers, runBatch, () => budget.halted);

  await db.update(runs).set({
    finishedAt: new Date(), counts,
    tokensIn: budget.tokensIn, tokensOut: budget.tokensOut,
  }).where(eq(runs.id, run.id));

  console.log(`\ncounts: ${JSON.stringify(counts)}`);
  if (dry) console.log('DRY RUN — nothing written');
})();
