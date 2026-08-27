/**
 * Context: what is happening around companies rather than to them.
 *
 * A tariff change, an export-control rule, a Singapore budget commitment or a
 * sector-wide funding wave changes what EDB can credibly offer and whether a
 * company is reachable at all, without naming any company. These land with no
 * company_id, a context_kind and the sectors they bear on, and feed the company
 * assessment alongside a company's own activity.
 *
 * Usage: npx tsx scripts/ingest-context.ts [--dry] [--only <source_id>]
 */
import '../lib/loadenv';
import { eq } from 'drizzle-orm';
import { getDb, withRetry } from '../lib/db';
import { items, runs, sourceHealth } from '../lib/schema';
import { CONTEXT_SOURCES, fetchFeed } from '../lib/news-sources';
import { canonicalizeUrl, splitGoogleTitle } from '../lib/news-ingest';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = getDb();
  const dry = flag('dry');
  const only = arg('only');

  const [run] = await db.insert(runs).values({ stage: 'ingest_context' }).returning();
  const counts: Record<string, number> = {
    sources: 0, source_errors: 0, fetched: 0, inserted: 0, duplicates: 0, unusable: 0,
  };

  try {
    for (const src of CONTEXT_SOURCES) {
      if (only && src.id !== only) continue;
      if (!src.enabled) {
        await markHealth(db, src.id, src.kind, 0, src.note ?? 'disabled');
        continue;
      }

      const { items: feed, error } = await fetchFeed(src.url);
      counts.sources++;
      if (error && !feed.length) counts.source_errors++;
      console.log(`  ${src.name}: ${feed.length} items${error ? ` (${error})` : ''}`);

      const rows = [];
      for (const fi of feed) {
        const canonical = canonicalizeUrl(fi.link);
        if (!canonical || !fi.title?.trim()) { counts.unusable++; continue; }
        // Google News embeds the publication in the title; the Federal Register
        // does not, so only split where a suffix is actually there.
        const { title, source: titleSource } = splitGoogleTitle(fi.title);
        rows.push({
          url: fi.link,
          canonicalUrl: canonical,
          title: title || fi.title.trim(),
          snippet: fi.snippet,
          source: fi.source ?? titleSource ?? src.name,
          sourceType: 'context',
          publishedAt: fi.publishedAt,
          companyId: null,
          contextKind: src.kind,
          sectors: src.sectors.length ? src.sectors : null,
          status: 'fetched',
          runId: run.id,
        });
      }
      counts.fetched += rows.length;

      if (!dry && rows.length) {
        const seen = new Set<string>();
        const unique = rows.filter((r) => {
          if (seen.has(r.canonicalUrl)) return false;
          seen.add(r.canonicalUrl); return true;
        });
        let insertedHere = 0;
        for (let i = 0; i < unique.length; i += 200) {
          const ins = await withRetry(() => db.insert(items).values(unique.slice(i, i + 200))
            .onConflictDoNothing({ target: items.canonicalUrl })
            .returning({ id: items.id }));
          insertedHere += ins.length;
        }
        counts.inserted += insertedHere;
        counts.duplicates += rows.length - insertedHere;
      }

      await markHealth(db, src.id, src.kind, feed.length, error);
      await sleep(1200);
    }

    await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
    console.log('\ncounts:', JSON.stringify(counts, null, 2));
    if (dry) console.log('DRY RUN — nothing written');
  } catch (e) {
    await db.update(runs)
      .set({ finishedAt: new Date(), counts, error: (e as Error).message })
      .where(eq(runs.id, run.id));
    throw e;
  }
})();

/** A source returning zero is a health event, not a silent skip. */
async function markHealth(
  db: ReturnType<typeof getDb>,
  source: string, kind: string, count: number, error: string | null | undefined,
) {
  const now = new Date();
  const status = error ? 'down' : count === 0 ? 'zero_volume' : 'ok';
  await withRetry(() => db.insert(sourceHealth).values({
    source, sourceType: `context:${kind}`, lastRunAt: now,
    lastSuccessAt: error ? undefined : now,
    lastCount: count, status, note: error ?? null,
  }).onConflictDoUpdate({
    target: sourceHealth.source,
    set: {
      lastRunAt: now, lastCount: count, status, note: error ?? null,
      sourceType: `context:${kind}`,
      ...(error ? {} : { lastSuccessAt: now }),
    },
  }));
}
