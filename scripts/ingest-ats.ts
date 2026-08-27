/**
 * Step 9 — ATS job boards (Greenhouse, Lever, Ashby). Brief §5.5, RATIONALE §4.
 *
 * Two jobs in one script:
 *   1. Discover which ATS a company uses, by probing candidate slugs. The
 *      result is cached on companies.ats_type/ats_slug so later runs skip the
 *      probing entirely. A Lever 404 is a definite "not using Lever", so a
 *      company that resolves nowhere is recorded and not retried aggressively.
 *   2. Snapshot the board and emit the aggregated hiring item per §5.5.
 *
 * The volume trigger applies all three of the brief's conditions together: 25%
 * WoW growth, >=5 new postings, and a base of >=20. The rule lives in
 * lib/ats.ts:volumeTriggerFires so it is testable in isolation.
 *
 * The trigger needs a baseline, so on a company's first run this stores the
 * snapshot and emits only the location/title items, which need no history; the
 * volume trigger goes live from the next run. A base of zero is not 25% growth,
 * and treating it as such would fabricate the exact signal the absolute floor
 * exists to prevent.
 *
 * Usage: npx tsx scripts/ingest-ats.ts [--limit N] [--dry] [--probe-only] [--rediscover]
 */
import '../lib/loadenv';
import { and, desc, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import { getDb, withRetry } from '../lib/db';
import { companies, items, jobPostings, jobSnapshots, runs, sgLinks, sourceHealth } from '../lib/schema';
import {
  ATS_TYPES, APAC_TITLE_RE, candidateSlugs, discoverFromCareersPage, fetchAts,
  isApacLocation, isNonUsLocation,
  volumeTriggerFires, type AtsJob, type AtsType,
} from '../lib/ats';
import { canonicalizeUrl } from '../lib/news-ingest';
import {
  buildHiringSnippet, buildHiringTitle, hiringItemIsMaterial, summarisePostings, type PostingLite,
} from '../lib/job-signal';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Politeness delay between ATS probes. No documented limit; these are free endpoints. */
const PROBE_DELAY_MS = 350;

(async () => {
  const db = getDb();
  const limit = Number(arg('limit', '0'));
  const dry = flag('dry');
  const probeOnly = flag('probe-only');
  const rediscover = flag('rediscover');

  const [run] = await db.insert(runs).values({ stage: 'ingest_ats' }).returning();
  const counts = {
    companies_considered: 0,
    probes_attempted: 0,
    ats_resolved: 0,
    ats_via_careers_page: 0,
    ats_not_found: 0,
    probe_errors: 0,
    boards_fetched: 0,
    jobs_seen: 0,
    non_us_jobs: 0,
    apac_jobs: 0,
    snapshots_written: 0,
    items_apac_hiring: 0,
    items_nonus_hiring: 0,
    items_volume: 0,
    sg_entities_found: 0,
    hiring_below_materiality: 0,
    volume_trigger_no_baseline: 0,
    items_inserted: 0,
  };

  try {
    // Same target set as step 8: seed list + assessed Form D discoveries.
    const targets = await db.select({
      id: companies.id, name: companies.name, website: companies.website,
      atsType: companies.atsType, atsSlug: companies.atsSlug,
    }).from(companies)
      .where(or(
        eq(companies.discoveredVia, 'seed'),
        and(eq(companies.discoveredVia, 'form_d'), eq(companies.scopeStatus, 'in_scope')),
      ))
      .orderBy(companies.id);

    const list = limit ? targets.slice(0, limit) : targets;
    counts.companies_considered = list.length;
    console.log(`ATS: ${list.length} companies\n`);

    for (const [idx, c] of list.entries()) {
      let atsType = c.atsType as AtsType | null;
      let atsSlug = c.atsSlug;

      // ---- 1. Discover the board, unless already cached -------------------
      if (!atsType || !atsSlug || rediscover) {
        const slugs = candidateSlugs(c.name, c.website);
        let found = false;
        outer:
        for (const slug of slugs) {
          for (const type of ATS_TYPES) {
            counts.probes_attempted++;
            const res = await fetchAts(type, slug);
            await sleep(PROBE_DELAY_MS);
            if (res.ok && res.jobs.length > 0) {
              atsType = type; atsSlug = slug; found = true;
              counts.ats_resolved++;
              console.log(`  [${idx + 1}/${list.length}] ${c.name}: ${type}/${slug} (${res.jobs.length} jobs)`);
              if (!dry) {
                await withRetry(() => db.update(companies)
                  .set({ atsType: type, atsSlug: slug })
                  .where(eq(companies.id, c.id)));
              }
              break outer;
            }
            if (!res.ok && res.reason === 'error') counts.probe_errors++;
          }
        }

        // Probing guesses the slug from the name, which misses whenever the
        // board is filed under something else. The company's own careers page
        // states where it posts, so it settles what guessing cannot.
        if (!found && c.website) {
          const via = await discoverFromCareersPage(c.website);
          if (via) {
            atsType = via.type; atsSlug = via.slug; found = true;
            counts.ats_resolved++;
            counts.ats_via_careers_page++;
            console.log(`  [${idx + 1}/${list.length}] ${c.name}: ${via.type}/${via.slug} (via careers page)`);
            if (!dry) {
              await withRetry(() => db.update(companies)
                .set({ atsType: via.type, atsSlug: via.slug })
                .where(eq(companies.id, c.id)));
            }
          }
        }
        if (!found) {
          counts.ats_not_found++;
          continue;
        }
      }
      if (!atsType || !atsSlug) continue;

      // ---- 2. Fetch the board ---------------------------------------------
      if (probeOnly) continue;
      const res = await fetchAts(atsType, atsSlug);
      await sleep(PROBE_DELAY_MS);
      if (!res.ok) {
        // A board that was resolving and now fails is a source-health event.
        console.warn(`  ${c.name}: board fetch failed (${res.detail})`);
        continue;
      }
      counts.boards_fetched++;
      const jobs = res.jobs;
      counts.jobs_seen += jobs.length;

      const enriched = jobs.map((j) => ({
        ...j,
        nonUs: isNonUsLocation(j.location),
        apac: isApacLocation(j.location) || APAC_TITLE_RE.test(j.title),
      }));
      const nonUs = enriched.filter((j) => j.nonUs);
      const apac = enriched.filter((j) => j.apac);
      counts.non_us_jobs += nonUs.length;
      counts.apac_jobs += apac.length;

      // ---- 3. Prior snapshot, for the volume trigger -----------------------
      const [prev] = await db.select({ total: jobSnapshots.totalJobs })
        .from(jobSnapshots)
        .where(eq(jobSnapshots.companyId, c.id))
        .orderBy(desc(jobSnapshots.snapshotAt))
        .limit(1);
      const prevCount = prev ? prev.total : null;

      // ---- 4. Write the snapshot and the postings --------------------------
      if (!dry) {
        await withRetry(() => db.insert(jobSnapshots).values({
          companyId: c.id, atsType, atsSlug,
          totalJobs: jobs.length, nonUsJobs: nonUs.length, apacJobs: apac.length,
          runId: run.id,
        }));
        counts.snapshots_written++;

        // Postings are upserted: last_seen moves, first_seen is preserved.
        // Postings persist like roles do — a job that was open is a fact about
        // the company even after it leaves the board.
        const rows = enriched
          .filter((j) => j.externalId && j.url)
          .map((j) => ({
            companyId: c.id, externalId: j.externalId, atsType: atsType!,
            title: j.title, location: j.location, url: j.url,
            postedAt: j.postedAt, isNonUs: j.nonUs, isApac: j.apac,
          }));
        for (let i = 0; i < rows.length; i += 200) {
          await withRetry(() => db.insert(jobPostings).values(rows.slice(i, i + 200))
            .onConflictDoUpdate({
              target: [jobPostings.companyId, jobPostings.atsType, jobPostings.externalId],
              set: { lastSeen: new Date(), title: sql`excluded.title`, location: sql`excluded.location` },
            }));
        }
      }

      // ---- 5. ONE aggregated hiring item per company -----------------------
      // Brief §5.5: at most one items row per company per run, carrying an
      // aggregated insight about the company's hiring trend. Boards run large
      // enough (231 open roles at Databricks alone) that per-posting rows would
      // turn every job listing into a candidate digest line, and a batch of
      // near-identical postings is the uniform batch that breaks independent
      // scoring (§7). Individual postings stay in job_postings with their URLs
      // so every claim remains checkable.
      const lite: PostingLite[] = enriched.map((j) => ({
        title: j.title, location: j.location,
        department: j.department, content: j.content,
        isNonUs: j.nonUs, isApac: j.apac, url: j.url,
      }));
      const pattern = summarisePostings(lite);

      type Synthetic = { title: string; url: string; snippet: string; kind: 'hiring' | 'volume' };
      const synthetic: Synthetic[] = [];
      // boards.greenhouse.io is the legacy host and 301s to
      // job-boards.greenhouse.io. Both resolve today, but linking through a
      // deprecated redirect puts the digest link at the mercy of Greenhouse
      // retiring it (§15: an edge without a working source_url is worthless).
      const boardHost = atsType === 'greenhouse' ? 'job-boards.greenhouse.io'
        : atsType === 'lever' ? 'jobs.lever.co' : 'jobs.ashbyhq.com';
      const boardUrl = `https://${boardHost}/${atsSlug}`;

      // Emit only when there is international hiring worth describing. A company
      // hiring purely in the US has no expansion signal, and a digest line
      // saying so is noise. The materiality floor mirrors §5.5's floor on the
      // volume trigger: a single overseas role is a data point rather than a
      // decision window, and scoring treats "1 open APAC role" as a top-band
      // signal if it is allowed through. Non-material patterns stay in
      // job_postings and the snapshot.
      if (pattern.nonUs > 0 && hiringItemIsMaterial(pattern)) {
        // Each week's aggregate is its own fact, so it needs a canonical URL
        // that distinguishes it from the plain board URL and from last week's
        // row. The week key goes in a query param: canonicalizeUrl strips the
        // hash, which is what makes exact dedupe work, but preserves params.
        const weekKey = new Date().toISOString().slice(0, 10);
        synthetic.push({
          kind: 'hiring',
          title: buildHiringTitle(c.name, pattern),
          url: `${boardUrl}?hiring_week=${weekKey}`,
          snippet: buildHiringSnippet(c.name, pattern),
        });
        if (pattern.apac > 0) counts.items_apac_hiring++;
        else counts.items_nonus_hiring++;
      } else if (pattern.nonUs > 0) {
        counts.hiring_below_materiality++;
      }

      // A Singapore entity named in a posting corroborates sg_links from a
      // source independent of ACRA, and costs nothing extra. §5.3: a
      // registration is not operational presence, so these stay 'probable'
      // until ACRA confirms status and incorporation date.
      if (!dry && pattern.sgEntities.length) {
        for (const name of pattern.sgEntities) {
          await withRetry(() => db.insert(sgLinks).values({
            subjectType: 'company', subjectId: c.id, linkType: 'entity_named_in_job_posting',
            matchStatus: 'probable',
            detail: `Singapore entity name "${name}" appears in ${c.name} job postings on ${atsType}. NOT ACRA-verified: no UEN, status or incorporation date.`,
            sourceUrl: boardUrl,
          }));
          counts.sg_entities_found++;
        }
      }

      // Rule C: the volume trigger. Needs a baseline; see the header note.
      if (prevCount === null) {
        counts.volume_trigger_no_baseline++;
      } else if (volumeTriggerFires(prevCount, jobs.length)) {
        const delta = jobs.length - prevCount;
        synthetic.push({
          kind: 'volume',
          title: `${c.name} job postings up ${Math.round((delta / prevCount) * 100)}% week over week (${prevCount} → ${jobs.length})`,
          url: boardUrl,
          snippet: `Hiring volume at ${c.name} rose from ${prevCount} to ${jobs.length} open roles (+${delta}) week over week. ${pattern.apac} of the current roles are APAC or international.`,
        });
        counts.items_volume++;
      }

      if (!dry && synthetic.length) {
        const rows = synthetic.map((sy) => {
          const canonical = canonicalizeUrl(sy.url);
          return canonical ? {
            url: sy.url, canonicalUrl: canonical, title: sy.title, snippet: sy.snippet,
            source: `${atsType} job board`, sourceType: 'ats',
            publishedAt: null, companyId: c.id, status: 'fetched', runId: run.id,
          } : null;
        }).filter((r): r is NonNullable<typeof r> => r !== null);

        const seen = new Set<string>();
        const unique = rows.filter((r) => {
          if (seen.has(r.canonicalUrl)) return false;
          seen.add(r.canonicalUrl); return true;
        });
        for (let i = 0; i < unique.length; i += 200) {
          const ins = await withRetry(() => db.insert(items).values(unique.slice(i, i + 200))
            .onConflictDoNothing({ target: items.canonicalUrl })
            .returning({ id: items.id }));
          counts.items_inserted += ins.length;
        }
      }

      if (synthetic.length) {
        console.log(`  [${idx + 1}/${list.length}] ${c.name}: ${jobs.length} jobs, ${nonUs.length} non-US, ${apac.length} APAC → ${synthetic.length} items`);
      }
    }

    // Channel-level source health.
    if (!dry) {
      const now = new Date();
      await withRetry(() => db.insert(sourceHealth).values({
        source: 'ats_boards', sourceType: 'ats', lastRunAt: now, lastSuccessAt: now,
        lastCount: counts.jobs_seen,
        status: counts.boards_fetched ? 'ok' : 'zero_volume',
        note: `${counts.boards_fetched} boards; ${counts.ats_not_found} companies with no board found`,
      }).onConflictDoUpdate({
        target: sourceHealth.source,
        set: {
          lastRunAt: now, lastSuccessAt: now, lastCount: counts.jobs_seen,
          status: counts.boards_fetched ? 'ok' : 'zero_volume',
          note: `${counts.boards_fetched} boards; ${counts.ats_not_found} companies with no board found`,
        },
      }));
    }

    await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
    console.log('\ncounts:', JSON.stringify(counts, null, 2));
    if (counts.volume_trigger_no_baseline > 0) {
      console.log(`\nNOTE: ${counts.volume_trigger_no_baseline} companies had no prior snapshot, so the`);
      console.log('volume trigger could not fire. It goes live on the next run. This is by design:');
      console.log('a base of zero is not 25% growth (brief §5.5 absolute floor).');
    }
    if (dry) console.log('DRY RUN — nothing written');
  } catch (e) {
    await db.update(runs)
      .set({ finishedAt: new Date(), counts, error: (e as Error).message })
      .where(eq(runs.id, run.id));
    throw e;
  }
})();
