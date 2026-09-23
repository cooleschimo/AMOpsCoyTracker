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
import { CONTEXT_SOURCES, fetchFeed, fetchScraped } from '../lib/news-sources';
import { NEWSLETTERS, fetchNewsletter } from '../lib/newsletters';
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
    sources: 0, source_errors: 0, stale_sources: 0,
    fetched: 0, inserted: 0, duplicates: 0, unusable: 0,
  };

  /**
   * Newsletters are read alongside the feeds, into the same table.
   *
   * A newsletter's landing page is a list of other people's articles, so each
   * story is stored with the PUBLISHER's url — the source credited is whoever
   * wrote it, and the newsletter is only how we came to see it. That also means
   * a story we already have from its own feed dedupes against it rather than
   * arriving twice.
   */
  const newsletterRows: any[] = [];
  for (const nl of NEWSLETTERS) {
    if (only && nl.id !== only) continue;
    if (!nl.enabled) {
      await markHealth(db, nl.id, 'newsletter', 0, nl.note ?? 'disabled');
      continue;
    }
    const { stories, error } = await fetchNewsletter(nl);
    counts.sources++;
    if (error && !stories.length) counts.source_errors++;
    console.log(`  ${nl.name}: ${stories.length} stories${error ? ` (${error})` : ''}`);
    await markHealth(db, nl.id, 'newsletter', stories.length, error ?? undefined);

    for (const st of stories) {
      const canonical = canonicalizeUrl(st.url ?? '');
      if (!canonical || !st.title.trim()) { counts.unusable++; continue; }
      newsletterRows.push({
        url: st.url!,
        canonicalUrl: canonical,
        title: st.title,
        snippet: null,
        // The publisher, read off the link, not the newsletter that carried it.
        source: hostOf(st.url!) ?? nl.name,
        sourceType: 'context',
        publishedAt: null,
        companyId: null,
        contextKind: 'trade',
        sectors: nl.sectors.length ? nl.sectors : null,
        status: 'fetched',
        runId: run.id,
      });
    }
  }
  counts.fetched += newsletterRows.length;
  if (!dry && newsletterRows.length) await insertItems(db, newsletterRows, counts);

  try {
    for (const src of CONTEXT_SOURCES) {
      if (only && src.id !== only) continue;
      if (!src.enabled) {
        await markHealth(db, src.id, src.kind, 0, src.note ?? 'disabled');
        continue;
      }

      // A source that declares a scraper reads its page; the rest read a feed.
      // Both return the same shape, so everything downstream is unchanged.
      const { items: feed, error, reached, blocked } = src.scrape
        ? await fetchScraped(src.url, src.scrape)
        : await fetchFeed(src.url);
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

      if (!dry && rows.length) await insertItems(db, rows, counts);

      await markHealth(db, src.id, src.kind, feed.length, error, null, reached, blocked);
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
/** Insert a batch, deduped on canonical url within the batch and against the table. */
async function insertItems(db: any, rows: any[], counts: Record<string, number>) {
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    if (seen.has(r.canonicalUrl)) return false;
    seen.add(r.canonicalUrl); return true;
  });
  let insertedHere = 0;
  for (let i = 0; i < unique.length; i += 200) {
    const ins: any[] = await withRetry(() => db.insert(items).values(unique.slice(i, i + 200))
      .onConflictDoNothing({ target: items.canonicalUrl })
      .returning({ id: items.id }));
    insertedHere += ins.length;
  }
  counts.inserted += insertedHere;
  counts.duplicates += rows.length - insertedHere;
}

/** The publisher, read off the link. */
function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

/**
 * How long a feed may go without publishing before it is treated as abandoned.
 *
 * A dead feed does not 404. StrictlyVC has served a valid 200 with fifty items
 * since April 2020, and SemiAnalysis since September 2025 — a check that reads
 * only the status code passes both of them forever, and the pipeline quietly
 * ingests six-year-old news as though it were this week's.
 */
const STALE_DAYS = 30;

async function markHealth(
  db: ReturnType<typeof getDb>,
  source: string, kind: string, count: number, error: string | null | undefined,
  newest?: Date | null, reached = false, blocked = false,
) {
  const now = new Date();
  const ageDays = newest ? Math.floor((now.getTime() - newest.getTime()) / 86400_000) : null;
  const stale = ageDays !== null && ageDays > STALE_DAYS;
  // A source that answered and parsed to nothing is not down: the host is
  // reachable and the selector is what missed. Two sector feeds read as
  // outages for weeks on that conflation.
  const status = blocked ? 'blocked'
    : error && !reached ? 'down'
    : count === 0 ? 'zero_volume'
    : stale ? 'stale'
    : 'ok';
  if (stale) {
    console.warn(`  ${source}: STALE — newest item is ${ageDays} days old, not ingesting`);
  }
  await withRetry(() => db.insert(sourceHealth).values({
    source, sourceType: `context:${kind}`, lastRunAt: now,
    lastSuccessAt: error && !reached ? undefined : now,
    lastCount: count, status,
    note: error ?? (stale ? `newest item is ${ageDays} days old` : null),
  }).onConflictDoUpdate({
    target: sourceHealth.source,
    set: {
      lastRunAt: now, lastCount: count, status,
      note: error ?? (stale ? `newest item is ${ageDays} days old` : null),
      sourceType: `context:${kind}`,
      ...(error ? {} : { lastSuccessAt: now }),
    },
  }));
}
