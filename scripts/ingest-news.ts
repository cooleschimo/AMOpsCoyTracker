/**
 * Step 8 — Google News RSS per company + press wire RSS into `items`.
 * Brief §5.5. The fetcher lives in lib/news-sources.ts; this script writes.
 *
 * Scope of the company-directed feed: Google News is queried per company for the
 * seed watchlist plus the Form D discoveries that passed the company-level
 * assessment. It is a *why now* trigger, not a discovery route — the query is a
 * company name you must already have. Discovery comes from Form D, portfolio
 * pages, ACRA and ATS boards (brief §5.1-§5.4). The 2,595 portfolio companies
 * carry scope_status 'in_scope' as a default rather than as an assessment
 * verdict, so querying them would flood the step 9 drop counts with unassessed
 * noise — exactly the misreading RATIONALE §15.4 warns about.
 *
 * Wire feeds are untargeted by design. A wire item naming a company we do not
 * track lands with company_id null and the step 9 company-match stage drops it;
 * turning those into discoveries is step 16.
 *
 * Everything fetched is kept (schema.ts) and lands with status 'fetched'; step 9
 * is what sets status + dropped_reason.
 *
 * Usage: npx tsx scripts/ingest-news.ts [--limit N] [--dry] [--wires-only] [--companies-only]
 */
import '../lib/loadenv';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb, withRetry } from '../lib/db';
import { companies, items, runs, sourceHealth } from '../lib/schema';
import {
  WIRE_SOURCES, googleNewsUrl, fetchFeed, type FeedItem,
} from '../lib/news-sources';
import { canonicalizeUrl, splitGoogleTitle } from '../lib/news-ingest';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Politeness delay between Google News queries. No documented limit; this is courtesy. */
const NEWS_DELAY_MS = 1500;

/** Record a source-health row, so a feed returning zero is visible rather than silent. */
async function markHealth(
  db: ReturnType<typeof getDb>,
  source: string, sourceType: string, count: number, error: string | null,
) {
  const now = new Date();
  const status = error ? 'down' : count === 0 ? 'zero_volume' : 'ok';
  await withRetry(() => db.insert(sourceHealth).values({
    source, sourceType, lastRunAt: now,
    lastSuccessAt: error ? undefined : now,
    lastCount: count, status, note: error,
  }).onConflictDoUpdate({
    target: sourceHealth.source,
    set: {
      lastRunAt: now, lastCount: count, status, note: error, sourceType,
      ...(error ? {} : { lastSuccessAt: now }),
    },
  }));
}

type PendingItem = {
  url: string; canonicalUrl: string; title: string; snippet: string | null;
  source: string; sourceType: string; publishedAt: Date | null;
  companyId: number | null; status: string; runId: number;
};

/** Build an items row from a feed entry, or null if structurally unusable. */
function toItem(
  fi: FeedItem, opts: { sourceType: string; fallbackSource: string; companyId: number | null; runId: number },
): PendingItem | null {
  const canonical = canonicalizeUrl(fi.link);
  if (!canonical || !fi.title?.trim()) return null;

  // Google News embeds the publication in the title; prefer it over <source>.
  const { title, source: titleSource } = opts.sourceType === 'news'
    ? splitGoogleTitle(fi.title)
    : { title: fi.title.trim(), source: null };
  if (!title) return null;

  return {
    url: fi.link,
    canonicalUrl: canonical,
    title,
    snippet: fi.snippet,
    source: fi.source ?? titleSource ?? opts.fallbackSource,
    sourceType: opts.sourceType,
    publishedAt: fi.publishedAt,
    companyId: opts.companyId,
    status: 'fetched',
    runId: opts.runId,
  };
}

/**
 * Insert items, ignoring rows whose canonical_url already exists.
 * canonical_url is unique, so re-running the stage is idempotent: a headline
 * seen last week stays a single row, and an item step 9 already dropped is not
 * resurrected as a fresh 'fetched' one.
 */
async function insertItems(db: ReturnType<typeof getDb>, rows: PendingItem[]): Promise<number> {
  if (!rows.length) return 0;
  // Deduplicate within the batch too: one company can return the same wrapper
  // twice, and ON CONFLICT cannot fire twice for the same row in one statement.
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    if (seen.has(r.canonicalUrl)) return false;
    seen.add(r.canonicalUrl);
    return true;
  });

  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const res = await withRetry(() => db.insert(items).values(chunk)
      .onConflictDoNothing({ target: items.canonicalUrl })
      .returning({ id: items.id }));
    inserted += res.length;
  }
  return inserted;
}

(async () => {
  const db = getDb();
  const limit = Number(arg('limit', '0'));
  const dry = flag('dry');
  const wiresOnly = flag('wires-only');
  const companiesOnly = flag('companies-only');

  const [run] = await db.insert(runs).values({ stage: 'ingest_news' }).returning();
  const counts = {
    companies_queried: 0,
    company_feed_errors: 0,
    company_items_fetched: 0,
    wires_queried: 0,
    wire_errors: 0,
    wire_items_fetched: 0,
    unusable_rows: 0,
    inserted: 0,
    duplicates_skipped: 0,
  };

  try {
    // ---- Company-directed Google News -------------------------------------
    if (!wiresOnly) {
      // Seed watchlist + Form D discoveries that passed the company assessment.
      const targets = await db.select({
        id: companies.id, name: companies.name, aliases: companies.aliases,
      }).from(companies)
        .where(or(
          eq(companies.discoveredVia, 'seed'),
          and(eq(companies.discoveredVia, 'form_d'), eq(companies.scopeStatus, 'in_scope')),
        ))
        .orderBy(companies.id);

      const list = limit ? targets.slice(0, limit) : targets;
      console.log(`Google News: ${list.length} companies (seed + assessed Form D)`);

      for (const [idx, c] of list.entries()) {
        const url = googleNewsUrl(c.name);
        const { items: feed, error } = await fetchFeed(url);
        counts.companies_queried++;

        if (error && feed.length === 0) {
          counts.company_feed_errors++;
          console.warn(`  [${idx + 1}/${list.length}] ${c.name}: ${error}`);
        } else {
          console.log(`  [${idx + 1}/${list.length}] ${c.name}: ${feed.length} items`);
        }

        const rows: PendingItem[] = [];
        for (const fi of feed) {
          const row = toItem(fi, {
            sourceType: 'news', fallbackSource: 'Google News',
            companyId: c.id, runId: run.id,
          });
          if (row) rows.push(row); else counts.unusable_rows++;
        }
        counts.company_items_fetched += rows.length;

        if (!dry) {
          const n = await insertItems(db, rows);
          counts.inserted += n;
          counts.duplicates_skipped += rows.length - n;
        }

        await sleep(NEWS_DELAY_MS);
      }

      // One health row for the channel as a whole, plus the error rate.
      await markHealth(
        db, 'google_news_company', 'news', counts.company_items_fetched,
        counts.company_feed_errors
          ? `${counts.company_feed_errors}/${counts.companies_queried} company queries failed`
          : null,
      );
    }

    // ---- Press wires -------------------------------------------------------
    if (!companiesOnly) {
      for (const src of WIRE_SOURCES) {
        if (!src.enabled) {
          // Disabled sources are marked down every run, so they stay visible.
          console.log(`  ${src.name}: disabled — ${src.note ?? 'see BLOCKERS.md'}`);
          await markHealth(db, src.id, 'wire', 0, src.note ?? 'disabled');
          continue;
        }
        const { items: feed, error } = await fetchFeed(src.url);
        counts.wires_queried++;
        if (error && feed.length === 0) counts.wire_errors++;
        console.log(`  ${src.name}: ${feed.length} items${error ? ` (${error})` : ''}`);

        const rows: PendingItem[] = [];
        for (const fi of feed) {
          // Wire items are untargeted, so company_id stays null. Step 9's
          // company-match stage drops them; step 16 is what mines them.
          const row = toItem(fi, {
            sourceType: 'wire', fallbackSource: src.name,
            companyId: null, runId: run.id,
          });
          if (row) rows.push(row); else counts.unusable_rows++;
        }
        counts.wire_items_fetched += rows.length;

        if (!dry) {
          const n = await insertItems(db, rows);
          counts.inserted += n;
          counts.duplicates_skipped += rows.length - n;
        }
        await markHealth(db, src.id, 'wire', feed.length, error);
      }
    }

    await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
    console.log('\ncounts:', JSON.stringify(counts, null, 2));
    if (dry) console.log('DRY RUN — nothing written to items');
  } catch (e) {
    await db.update(runs)
      .set({ finishedAt: new Date(), counts, error: (e as Error).message })
      .where(eq(runs.id, run.id));
    throw e;
  }
})();
