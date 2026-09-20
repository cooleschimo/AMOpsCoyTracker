/**
 * Step 8 — Google News RSS per company + press wire RSS into `items`.
 * Brief §5.5. The fetcher lives in lib/news-sources.ts; this script writes.
 *
 * Scope of the company-directed feed: Google News is queried per company for
 * every company still a candidate, whatever route found it. It is a *why now*
 * trigger, not a discovery route — the query is a company name you must
 * already have. Discovery comes from Form D, portfolio
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
import { eq, inArray, sql } from 'drizzle-orm';
import { getDb, withRetry } from '../lib/db';
import { companies, items, runs, sourceHealth } from '../lib/schema';
import {
  WIRE_SOURCES, googleNewsUrl, fetchFeed, type FeedItem,
} from '../lib/news-sources';
import { canonicalizeUrl, splitGoogleTitle } from '../lib/news-ingest';
import { trackedCompanies } from '../lib/scope';
import { STAGES } from '../lib/stages';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Delay between Google News queries.
 *
 * Google soft-blocks a caller that asks steadily for too long. Measured on the
 * runner: the first 136 queries at 1.5s apart were served, then 503 for the
 * next eight hundred, then service resumed — a rolling throttle rather than a
 * daily cap. 1.5s is about forty requests a minute; four seconds is fifteen,
 * which is the side of that line worth being on.
 */
const NEWS_DELAY_MS = 4000;

/**
 * How many nights it takes to check every company once.
 *
 * Asking about all eleven hundred every night was both the thing that tripped
 * the throttle and largely wasted: a Google News feed carries a backlog, so a
 * company visited on Thursday still yields Tuesday's story. What a cycle costs
 * is time-to-first-sight — up to three days rather than one — and what it buys
 * is a stage that finishes inside its budget without being refused.
 */
const COHORT_DAYS = 3;

/**
 * A company joins the rotation once it has been here a while.
 *
 * A company discovered last night is the one most likely to have news worth
 * reading, and making it wait two days for its first look would undo the point
 * of discovering it. Recent arrivals are queried every night until they settle.
 */
const COHORT_GRACE_DAYS = 7;

/**
 * How many companies fit in the stage's budget, at the delay we query them.
 *
 * The delay and the timeout are set in two files and drifted apart the moment
 * one of them moved: at four seconds a 1,190-company list needs 79 minutes and
 * the stage is given 40, so it is killed halfway through and the wire loop
 * after it never runs at all. The cohort was meant to prevent that and cannot,
 * because the grace clause has no ceiling under it — a busy discovery night
 * makes most of the list fresh and the split stops bounding anything.
 *
 * So the ceiling is computed from the two numbers that decide it rather than
 * chosen. `LEAVE_FOR_WIRES` is what the rest of the stage needs once the
 * company loop is done; the rest divides by what a query costs, counting the
 * request alongside the sleep.
 */
const LEAVE_FOR_WIRES_MS = 5 * 60_000;
const PER_QUERY_MS = NEWS_DELAY_MS + 500;

function cohortCeiling(): number {
  const stage = STAGES.find((s) => s.script === 'ingest-news.ts');
  const budgetMs = (stage?.timeoutMin ?? 40) * 60_000;
  return Math.max(50, Math.floor((budgetMs - LEAVE_FOR_WIRES_MS) / PER_QUERY_MS));
}

/**
 * Consecutive failures that mean the door has closed.
 *
 * A blocked run used to spend ninety minutes discovering the same 503 eight
 * hundred times, which is what pushed the stage past its timeout and turned a
 * working night red. Twenty in a row is far more than a flaky feed produces and
 * unmistakable when the block is real.
 */
const BLOCK_AFTER_CONSECUTIVE_ERRORS = 20;

/** Record a source-health row, so a feed returning zero is visible rather than silent. */
async function markHealth(
  db: ReturnType<typeof getDb>,
  source: string, sourceType: string, count: number, error: string | null,
  reached = false,
) {
  const now = new Date();
  /*
   * `down` means the source could not be read. A feed that answered and parsed
   * to nothing is `zero_volume` — the note still says what happened, but the
   * fix is a selector rather than a URL, and two sector feeds sat at `down` for
   * weeks reading as outages when nothing was unreachable.
   */
  const status = error && !reached ? 'down' : count === 0 ? 'zero_volume' : 'ok';
  await withRetry(() => db.insert(sourceHealth).values({
    source, sourceType, lastRunAt: now,
    // Reaching the source IS the success this column records; whether it
    // parsed to anything is what lastCount and status say.
    lastSuccessAt: error && !reached ? undefined : now,
    lastCount: count, status, note: error,
  }).onConflictDoUpdate({
    target: sourceHealth.source,
    set: {
      lastRunAt: now, lastCount: count, status, note: error, sourceType,
      ...(error && !reached ? {} : { lastSuccessAt: now }),
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
    companies_tracked: 0,
    companies_in_cohort: 0,
    /** Due tonight but past what the stage's budget covers; first in line tomorrow. */
    companies_over_ceiling: 0,
    companies_queried: 0,
    company_feed_errors: 0,
    blocked_early: 0,
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
      /**
       * Everything the pipeline is actually watching, on one rule for every
       * company regardless of how it arrived.
       *
       * How a company entered the database says nothing about whether this
       * week's news about it is worth having. Targeting used to branch on
       * origin — hand-imported companies were searched unconditionally, Form D
       * ones only once assessed in scope — which meant identical uncertainty
       * was treated differently by provenance: 64 Form D companies went
       * unsearched at 'unknown' while imported ones at 'unknown' were searched,
       * and one imported company kept being searched after the assessment had
       * ruled it out of scope.
       *
       * The question a target list answers is whether the company is still a
       * candidate, so scope is the only thing it asks. An out-of-scope company
       * is dropped, which is what stops the list growing without limit, and a
       * portfolio company is not a target in its own right — it is a holding of
       * a fund the graph tracks.
       */
      const targets = await db.select({
        id: companies.id, name: companies.name, aliases: companies.aliases,
        // Read by lib/ambiguous.ts to narrow the query for a name that is also
        // an ordinary word.
        website: companies.website, hqCity: companies.hqCity, sectors: companies.sectors,
        // Read by the cohort rule: a recent arrival skips the rotation.
        createdAt: companies.createdAt,
      }).from(companies)
        .where(trackedCompanies(companies))
        .orderBy(companies.id);

      /*
       * Tonight's share of the rotation.
       *
       * The cohort is the company id modulo the cycle length, against the day
       * number since the epoch — so the split is fixed, every company falls in
       * exactly one cohort, and no state has to be carried between runs. A
       * company that arrived within the grace period is queried regardless,
       * since its first look is the one worth having promptly.
       *
       * --limit and --cohort-all both bypass it, for a manual run that wants
       * the whole list.
       */
      counts.companies_tracked = targets.length;
      const today = Math.floor(Date.now() / 86_400_000);
      const graceMs = COHORT_GRACE_DAYS * 86_400_000;
      const everyone = limit > 0 || flag('cohort-all');
      const isFresh = (c: typeof targets[number]) => c.createdAt instanceof Date
        && Date.now() - c.createdAt.getTime() < graceMs;
      const picked = everyone ? targets : targets.filter(
        (c) => isFresh(c) || c.id % COHORT_DAYS === today % COHORT_DAYS);

      /*
       * Fresh first, then the night's third of the list.
       *
       * The ceiling can cut this short, and what it cuts matters: a company
       * discovered last night is the one most likely to be carrying the story
       * worth reading, while a rotation company missed tonight comes round
       * again in three. Sorting before the slice means the ceiling drops the
       * cheaper half.
       */
      const ceiling = cohortCeiling();
      const ordered = everyone ? picked
        : [...picked].sort((a, b) => Number(isFresh(b)) - Number(isFresh(a)));
      const due = everyone ? ordered : ordered.slice(0, ceiling);
      counts.companies_in_cohort = due.length;
      counts.companies_over_ceiling = ordered.length - due.length;
      if (due.length < ordered.length) {
        console.log(`${ordered.length} due tonight, ${ceiling} fit the ${
          STAGES.find((s) => s.script === 'ingest-news.ts')?.timeoutMin ?? 40}m budget `
          + `at ${NEWS_DELAY_MS}ms — ${ordered.length - due.length} wait for tomorrow`);
      }

      const list = limit ? due.slice(0, limit) : due;
      console.log(`Google News: ${targets.length} tracked, ${list.length} due tonight`
        + `${everyone ? ' (whole list)' : ` (1 night in ${COHORT_DAYS}, plus arrivals under ${COHORT_GRACE_DAYS}d)`}`);

      /*
       * Stop when the door has closed.
       *
       * Every query after a block costs its full timeout and returns nothing,
       * so continuing is not persistence, it is the stage spending its budget
       * to learn the same fact repeatedly. The companies not reached keep their
       * place in the rotation and come round again tomorrow.
       */
      let consecutiveErrors = 0;
      let blocked = false;

      for (const [idx, c] of list.entries()) {
        if (blocked) { counts.blocked_early++; continue; }
        const url = googleNewsUrl(c);
        const { items: feed, error } = await fetchFeed(url);
        counts.companies_queried++;

        if (error && feed.length === 0) {
          counts.company_feed_errors++;
          consecutiveErrors++;
          console.warn(`  [${idx + 1}/${list.length}] ${c.name}: ${error}`);
          if (consecutiveErrors >= BLOCK_AFTER_CONSECUTIVE_ERRORS) {
            blocked = true;
            console.warn(`\n  ${consecutiveErrors} consecutive failures — treating Google News as blocked`);
            console.warn(`  ${list.length - idx - 1} companies left unqueried; they keep their turn tomorrow.`);
          }
        } else {
          consecutiveErrors = 0;
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

      /*
       * One health row for the channel as a whole.
       *
       * A block says something different from a high error rate — it means the
       * rest of the cohort was never asked — so it is named rather than left to
       * be inferred from the ratio.
       */
      await markHealth(
        db, 'google_news_company', 'news', counts.company_items_fetched,
        blocked
          ? `blocked after ${counts.companies_queried} queries; ${counts.blocked_early} companies not reached`
          : counts.company_feed_errors
            ? `${counts.company_feed_errors}/${counts.companies_queried} company queries failed`
            : null,
      );
    }

    // ---- Press wires -------------------------------------------------------
    if (!companiesOnly) {
      for (const src of WIRE_SOURCES) {
        if (!src.enabled) {
          // Disabled sources are marked down every run, so they stay visible.
          console.log(`  ${src.name}: disabled — ${src.note ?? 'disabled in lib/news-sources.ts'}`);
          await markHealth(db, src.id, 'wire', 0, src.note ?? 'disabled');
          continue;
        }
        const { items: feed, error, reached } = await fetchFeed(src.url);
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
        await markHealth(db, src.id, 'wire', feed.length, error, reached);
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
