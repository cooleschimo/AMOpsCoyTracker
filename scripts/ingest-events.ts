/**
 * Conference exhibitor and speaker lists into `events` and `event_participants`.
 * Brief §5.4, §12 step 17.
 *
 * This is the only source in the pipeline that produces a fact about the
 * future. Everything else records a decision already taken; an exhibitor list
 * says where a company will be, six weeks before it is there, which is what
 * turns the digest's static events calendar into something an RD can act on.
 *
 * The rows land in `event_participants` and are read back by `lib/paths.ts` as
 * `kind: 'event'` — a possible path, ranked next to a shared investor or a
 * shared board seat. Like every other path it stays an association until an RD
 * reviews it: a company having a stand at a show EDB also attends is an
 * opportunity to introduce ourselves, not an introduction.
 *
 * Matching is deliberately one-directional, and it happens BEFORE the model
 * rather than after. A directory is mostly names with no bearing on FDI — three
 * thousand exhibitors at SEMICON West are largely equipment suppliers and
 * distributors — so the company index picks out the lines naming a company we
 * monitor, and only those are read. A stand is not a reason to create a
 * company: it says the company exists, which we knew, and nothing about whether
 * it is in scope. A person is created, because a person only ever arrives
 * attached to a company already matched.
 *
 * Usage:
 *   npx tsx scripts/ingest-events.ts [--limit N] [--only <event name>] [--dry]
 *     --all   read every configured show, not only those inside the window
 */
import '../lib/loadenv';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { events, eventParticipants, people, companies, runs, sourceHealth } from '../lib/schema';
import { Budget } from '../lib/budget';
import { normalizeCompanyName, normalizePersonName } from '../lib/normalize';
import {
  CONFERENCES, fetchDirectory, robotsAllows, editionDates, extractParticipants, yearFromUrl,
  linesNamingKnownCompanies,
  withinPlanningWindow, type Conference, type ExtractedParticipant,
} from '../lib/events';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

/**
 * The companies worth looking for, by normalised name.
 *
 * This is the same population the dashboard counts as monitored — everything
 * except bulk portfolio-scraped names and out-of-scope. Portfolio scraping
 * fills the graph with thousands of companies that are never fetched for news
 * or scored, and an event row against one of those would surface a path for a
 * company nothing else in the tool has an opinion about.
 *
 * Wider than the companies scored this week, deliberately. Scoring moves with
 * the news and a company quiet this week may lead the digest next; an exhibitor
 * list read six weeks out would otherwise miss it for the sake of a gap that
 * closes on its own.
 *
 * Loaded once and used as a filter over the directory, so the cost is one query
 * rather than one per name.
 */
async function companyIndex(): Promise<Map<string, { id: number; name: string }>> {
  const rows: any = await getSql()`
    select id, name, normalized_name, aliases
    from companies
    where coalesce(discovered_via, '') <> 'portfolio'
      and coalesce(scope_status, 'unknown') <> 'out_of_scope'`;
  const index = new Map<string, { id: number; name: string }>();
  for (const r of rows) {
    const entry = { id: Number(r.id), name: String(r.name) };
    const norm = r.normalized_name ?? normalizeCompanyName(r.name);
    if (norm && !index.has(norm)) index.set(norm, entry);
    // Trade shows write a company as it brands itself rather than as it files,
    // so the alias list is what matches "a16z" or "AMAT" to the legal name.
    for (const a of (r.aliases ?? []) as string[]) {
      const an = normalizeCompanyName(a);
      if (an && !index.has(an)) index.set(an, entry);
    }
  }
  return index;
}

/** Find a person by normalised name, or create one. False splits beat false merges. */
async function upsertPerson(name: string): Promise<{ id: number; created: boolean }> {
  const db = getDb();
  const norm = normalizePersonName(name);
  const found = await withRetry(() => db.select({ id: people.id }).from(people)
    .where(eq(people.normalizedName, norm)).limit(1));
  if (found.length) return { id: found[0].id, created: false };
  const [p] = await withRetry(() => db.insert(people).values({ name, normalizedName: norm })
    .returning({ id: people.id }));
  return { id: p.id, created: true };
}

/**
 * The event row for this edition.
 *
 * An edition is a name and a start date together: SEMICON West 2026 is a
 * different event from SEMICON West 2025, and its exhibitor list is a different
 * list. Matching on name alone would fold every year into one row and leave
 * last year's exhibitors looking like this year's.
 */
async function upsertEvent(
  conf: Conference, dates: { startsOn: string; endsOn: string } | null,
): Promise<{ id: number; created: boolean }> {
  const db = getDb();
  const existing = await withRetry(() => db.select({ id: events.id }).from(events)
    .where(dates
      ? and(eq(events.name, conf.name), eq(events.startsOn, dates.startsOn))
      : and(eq(events.name, conf.name), isNull(events.startsOn)))
    .limit(1));
  if (existing.length) return { id: existing[0].id, created: false };
  const [e] = await withRetry(() => db.insert(events).values({
    name: conf.name,
    startsOn: dates?.startsOn ?? null,
    endsOn: dates?.endsOn ?? null,
    city: conf.city,
    url: conf.listUrl,
    sectors: conf.sectors,
  }).returning({ id: events.id }));
  return { id: e.id, created: true };
}

async function recordHealth(source: string, count: number, note: string) {
  const db = getDb();
  const health = {
    source, sourceType: 'event_listing',
    lastRunAt: new Date(), lastSuccessAt: count ? new Date() : undefined,
    lastCount: count, status: count ? 'ok' : 'zero_volume', note: note.slice(0, 300),
  };
  const ex = await withRetry(() => db.select({ id: sourceHealth.id }).from(sourceHealth)
    .where(eq(sourceHealth.source, source)).limit(1));
  if (ex.length) await withRetry(() => db.update(sourceHealth).set(health).where(eq(sourceHealth.id, ex[0].id)));
  else await withRetry(() => db.insert(sourceHealth).values(health));
}

(async () => {
  const db = getDb();
  const dry = flag('dry');
  const all = flag('all');
  const limit = Number(arg('limit', '0'));
  const only = arg('only');

  let list = CONFERENCES.filter((c) => c.scrape);
  if (only) list = list.filter((c) => c.name.toLowerCase().includes(only.toLowerCase()));
  if (limit) list = list.slice(0, limit);

  console.log(`${list.length} scrapable conference listings\n`);
  if (!list.length) return;

  const index = await companyIndex();
  console.log(`${index.size} company names and aliases to match against\n`);

  const [run] = await db.insert(runs).values({ stage: 'events' }).returning();
  const budget = new Budget();
  const counts = {
    conferences: list.length, fetched: 0, blocked_by_robots: 0, fetch_failed: 0,
    dated: 0, outside_window: 0, lines_read: 0, lines_sent: 0,
    chunks: 0, failed_chunks: 0, truncated_lists: 0,
    extracted: 0, matched: 0, unmatched: 0,
    events_created: 0, participants_created: 0, people_created: 0,
  };

  try {
    for (const conf of list) {
      if (budget.halted) { console.warn(`\nBudget halted: ${budget.haltReason}`); break; }

      const robots = await robotsAllows(conf.listUrl);
      if (!robots.allowed) {
        counts.blocked_by_robots++;
        console.log(`  ⚠ ${conf.name}: ${robots.note}`);
        if (!dry) await recordHealth(`event:${conf.name}`, 0, robots.note);
        continue;
      }

      const page = await fetchDirectory(conf.listUrl);
      if (!page.ok || !page.lines.length) {
        counts.fetch_failed++;
        console.log(`  ⚠ ${conf.name}: ${page.error ?? 'no content'}`);
        if (!dry) await recordHealth(`event:${conf.name}`, 0, page.error ?? 'no content');
        continue;
      }
      counts.fetched++;

      const dates = editionDates(page.lines, { yearHint: yearFromUrl(page.url) });
      if (dates) counts.dated++;
      if (!all && !withinPlanningWindow(dates?.startsOn ?? null)) {
        counts.outside_window++;
        console.log(`  – ${conf.name}: ${dates?.startsOn} is outside the planning window`);
        if (!dry) await recordHealth(`event:${conf.name}`, 0, `edition ${dates?.startsOn} outside window`);
        continue;
      }

      /*
       * The model only reads the lines that name a company we monitor.
       *
       * Reading the whole directory spent its budget on names nothing in the
       * tool would ever ask about: ATxSG returned four hundred and twenty
       * companies of which nine were tracked, and the other four hundred and
       * eleven were extracted, matched, missed and discarded. The index knows
       * which lines can matter before a call is made.
       */
      const candidates = linesNamingKnownCompanies(page.lines, index);
      counts.lines_read += page.lines.length;
      counts.lines_sent += candidates.lines.length;
      if (!candidates.lines.length) {
        console.log(`  – ${conf.name}: ${page.lines.length} lines, none naming a monitored company`);
        if (!dry) await recordHealth(`event:${conf.name}`, 0,
          `${page.lines.length} lines, no monitored company named`);
        continue;
      }

      const { participants, chunks, failedChunks, truncated } = await extractParticipants(
        candidates.lines, { name: conf.name, kind: conf.kind }, { budget },
      );
      counts.chunks += chunks;
      counts.failed_chunks += failedChunks;
      counts.extracted += participants.length;
      if (truncated) {
        counts.truncated_lists++;
        console.log(`    (read ${chunks * 120} of ${candidates.lines.length} candidate lines; the rest wait for the next run)`);
      }

      /*
       * The prefilter chose the lines; this decides whose row it is. They can
       * disagree — a line selected because it names a tracked company may also
       * name its parent or a co-exhibitor, and the model says which one the
       * entry is actually about. The name it returns is what gets resolved.
       */
      const matched = participants
        .map((p) => ({ p, hit: index.get(normalizeCompanyName(p.company)) }))
        .filter((x): x is { p: ExtractedParticipant; hit: { id: number; name: string } } => !!x.hit);
      counts.matched += matched.length;
      counts.unmatched += participants.length - matched.length;

      console.log(`  ✓ ${conf.name}${dates ? ` (${dates.startsOn})` : ''}: `
        + `${page.lines.length} lines, ${candidates.lines.length} naming a monitored company, `
        + `${matched.length} confirmed`);
      for (const { p, hit } of matched) {
        console.log(`      ${hit.name}${p.person ? ` — ${p.person}` : ''} (${p.participation})`);
      }

      if (!dry) await recordHealth(`event:${conf.name}`, matched.length,
        `${candidates.lines.length} of ${page.lines.length} lines named a monitored company, at ${page.url}`);
      if (dry || !matched.length) continue;

      const { id: eventId, created } = await upsertEvent(conf, dates);
      if (created) counts.events_created++;

      for (const { p, hit } of matched) {
        let personId: number | null = null;
        if (p.person) {
          const person = await upsertPerson(p.person);
          personId = person.id;
          if (person.created) counts.people_created++;
        }

        // A null person_id does not compare equal in a unique index, so the
        // duplicate check is done here rather than left to the constraint.
        const dupe = await withRetry(() => db.select({ id: eventParticipants.id })
          .from(eventParticipants)
          .where(and(
            eq(eventParticipants.eventId, eventId),
            eq(eventParticipants.companyId, hit.id),
            personId === null ? isNull(eventParticipants.personId) : eq(eventParticipants.personId, personId),
            eq(eventParticipants.participation, p.participation),
          )).limit(1));
        if (dupe.length) continue;

        await withRetry(() => db.insert(eventParticipants).values({
          eventId, companyId: hit.id, personId,
          participation: p.participation,
          source: 'event_listing',
          sourceUrl: page.url,
        }));
        counts.participants_created++;
      }
    }
  } finally {
    if (!dry) {
      await db.update(runs).set({
        finishedAt: new Date(), counts,
        tokensIn: budget.tokensIn, tokensOut: budget.tokensOut,
        error: budget.halted ? `halted: ${budget.haltReason}` : null,
      }).where(eq(runs.id, run.id));
    }
  }

  console.log('\n=== EVENT INGESTION ===');
  console.table(counts);
  if (dry) console.log('DRY RUN — nothing written');
})();
