/**
 * Step 9 — filter, cluster, score. Brief §7.
 *
 * The cascade runs the cheap deterministic stages first (brief §7):
 *   1. canonicalise + exact dedupe   (done at ingest; re-checked here)
 *   2. domain blocklist
 *   3. pattern drop (listicles, stock tips)
 *   4. company match — name or alias in title/snippet for company-scoped feeds
 *   5. recency — drop older than 10 days
 *   6. near-duplicate clustering — only the cluster heads get scored
 *   7. LLM scoring of heads, batched
 *
 * Every stage sets status + dropped_reason and keeps the row. The dropped set is
 * the training data and cannot be rebuilt later (schema.ts, §15).
 *
 * Per-stage counts go to runs.counts. Brief §7: "If stage 4 drops 90%, the alias
 * list is wrong and you need to see that immediately." RATIONALE §15.4 says the
 * same thing about the whole cascade. These counts are the instrument.
 *
 * Batch anchoring is a live failure mode: a batch of entirely unrecognised items
 * makes the model answer 'unknown' for all of them, including ones it scores
 * correctly when they sit alongside familiar names. lib/rubric.ts carries an
 * explicit independence instruction; this script additionally interleaves items
 * across batches so a single company's noise cannot fill one batch, and logs any
 * batch that returns a single uniform score so the effect stays visible.
 *
 * Usage: npx tsx scripts/filter-score.ts [--limit N] [--batch 12] [--dry] [--filter-only]
 */
import '../lib/loadenv';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, withRetry } from '../lib/db';
import { companies, items, runs, scores } from '../lib/schema';
import { blockedDomain, blockedSourceName, junkPattern } from '../lib/blocklist';
import { clusterItems, type Clusterable } from '../lib/cluster';
import { callJson } from '../lib/llm';
import { Budget } from '../lib/budget';
import { env } from '../lib/env';
import {
  ITEM_RUBRIC_SYSTEM, RUBRIC_VERSION, buildScoringPrompt, isSignalType,
  type ItemForScoring,
} from '../lib/rubric';
import { isSector } from '../lib/scope';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const RECENCY_DAYS = 10;

/**
 * --recluster re-runs ONLY stage 6 over items that already passed the filter,
 * for when the clustering rule changes. It does not re-fetch or re-filter, and
 * it never resurrects a dropped item — only 'kept' and 'duplicate' rows are
 * reconsidered, since those are exactly the ones clustering decided between.
 */

/**
 * --rescore scores EXISTING cluster heads under the current RUBRIC_VERSION,
 * skipping the filter entirely.
 *
 * `scores` is unique on (item_id, rubric_version), so this ADDS rows rather
 * than replacing them: the old version's judgments survive, which is the whole
 * point of versioning the rubric (brief §7 — "you need both to know whether a
 * change helped"). Items already scored under the CURRENT version are skipped,
 * so the run is resumable after a budget halt.
 */

type Row = {
  id: number; title: string; snippet: string | null; canonicalUrl: string;
  source: string; sourceType: string; publishedAt: Date | null;
  companyId: number | null; status: string;
};

type ScoreOut = {
  n: number; score: number; momentum?: number; signal_type: string; sectors: string[];
  region: string; expansion_language: boolean; why: string | string[];
};

(async () => {
  const db = getDb();
  const batchSize = Number(arg('batch', '12'));
  const limit = Number(arg('limit', '0'));
  const via = arg('via');
  const dry = flag('dry');
  const filterOnly = flag('filter-only');

  const [run] = await db.insert(runs).values({ stage: 'filter_score' }).returning();

  // Per-stage drop counts. This object is the deliverable of the filter half.
  const counts: Record<string, number> = {
    input: 0,
    dropped_blocked_domain: 0,
    dropped_blocked_source: 0,
    dropped_junk_pattern: 0,
    dropped_company_mismatch: 0,
    dropped_stale: 0,
    dropped_no_date: 0,
    survived_filters: 0,
    context_set_aside: 0,
    clusters: 0,
    cluster_members_absorbed: 0,
    heads_to_score: 0,
    batches: 0,
    batches_failed: 0,
    scored: 0,
    score_3: 0, score_2: 0, score_1: 0, score_0: 0,
    momentum_3: 0, momentum_2: 0, momentum_1: 0, momentum_0: 0, momentum_missing: 0,
    uniform_batches: 0,
  };

  const rescore = flag('rescore');
  const recluster = flag('recluster');

  try {
    // Only items not yet processed. Re-running is safe: scored items keep their
    // status and are not re-filtered.
    const pending = rescore ? [] : await db.select({
      id: items.id, title: items.title, snippet: items.snippet,
      canonicalUrl: items.canonicalUrl, source: items.source,
      sourceType: items.sourceType, publishedAt: items.publishedAt,
      companyId: items.companyId, status: items.status,
    }).from(items)
      .where(and(
        eq(items.status, 'fetched'),
        // --via narrows to items belonging to companies found a particular way,
        // so a newly discovered set can be brought current without re-running
        // the whole backlog.
        via
          ? sql`exists (select 1 from companies c
                        where c.id = ${items.companyId} and c.discovered_via = ${via})`
          : sql`true`,
      ))
      .orderBy(items.id);

    const input: Row[] = limit ? pending.slice(0, limit) : pending;
    counts.input = input.length;
    console.log(`Filtering ${input.length} items with status 'fetched'\n`);

    // Company names + aliases, for stage 4.
    const comps = await db.select({
      id: companies.id, name: companies.name, aliases: companies.aliases,
      sectors: companies.sectors,
    }).from(companies);
    const nameById = new Map(comps.map((c) => [c.id, c.name]));
    const sectorsById = new Map(comps.map((c) => [c.id, c.sectors ?? []]));
    /**
     * Fold accents before comparing. A masthead writes "Daré Bioscience" where
     * the company record says "Dare Bioscience", and an exact compare reads
     * that as a different company — four of this company's own announcements
     * were dropped as mismatches before the fold.
     */
    const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    const termsById = new Map<number, RegExp[]>();
    /*
     * Whole words, not substrings.
     *
     * `hay.includes('sierra')` is true of "Sierra Club", "Sierra Nevada" and
     * "Sierra Leone", so Sierra the AI company owned a ski consignment sale, a
     * seaweed story and a weather forecast; Harvey owned an arrest in Ohio.
     * 271 kept items in a thirty-day window belonged to a company their
     * headline never named, and every one of them reached the scorer as
     * evidence.
     *
     * A boundary either side is what the substring test was reaching for.
     *
     * Punctuation inside a name is collapsed to whitespace on both sides before
     * matching, because an outlet does not spell a name the way its owner
     * registered it: "d-Matrix" is written "D Matrix", "Daré Bioscience" loses
     * its accent. Comparing the collapsed forms costs nothing and recovers 190
     * items that were dropped over a hyphen.
     */
    const loose = (t: string) => fold(t).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    for (const c of comps) {
      const terms = [c.name, ...(c.aliases ?? [])]
        .filter(Boolean)
        .map(fold)
        // Strip legal suffixes so "Acme, Inc." matches a headline saying "Acme".
        .map((t) => t.replace(/[,.]?\s*(inc|corp|corporation|llc|ltd|limited|co|pbc)\.?$/i, '').trim())
        .map(loose)
        .filter((t) => t.length >= 3);
      // Each space in the term matches any run of punctuation or whitespace in
      // the text, so "d matrix" finds "D-Matrix", "D Matrix" and "d.matrix".
      termsById.set(c.id, [...new Set(terms)].map(
        (t) => new RegExp(`\\b${t.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z0-9]+')}\\b`),
      ));
    }

    const drops: Array<{ id: number; reason: string }> = [];
    const contextItems: number[] = [];
    let survivors: Row[] = [];

    if (recluster) {
      const prev = await db.select({
        id: items.id, title: items.title, snippet: items.snippet,
        canonicalUrl: items.canonicalUrl, source: items.source,
        sourceType: items.sourceType, publishedAt: items.publishedAt,
        companyId: items.companyId, status: items.status,
      }).from(items)
        .where(inArray(items.status, ['kept', 'duplicate']))
        .orderBy(items.id);
      survivors = limit ? prev.slice(0, limit) : prev;
      // Attach the signal type from the previous scoring pass: clustering uses
      // it to tell one funding round from a product launch at the same company.
      const prior = await db.select({ itemId: scores.itemId, signalType: scores.signalType })
        .from(scores).where(eq(scores.rubricVersion, RUBRIC_VERSION));
      const sigById = new Map(prior.map((p2) => [p2.itemId, p2.signalType]));
      for (const s2 of survivors) (s2 as Clusterable).signalType = sigById.get(s2.id) ?? null;
      counts.input = survivors.length;
      counts.survived_filters = survivors.length;
      console.log(`RECLUSTER: ${survivors.length} previously-kept items (${sigById.size} with a prior signal type)\n`);
    } else if (rescore) {
      // Heads kept by a previous filter run that have no score under the
      // CURRENT rubric version yet.
      const heads = await db.select({
        id: items.id, title: items.title, snippet: items.snippet,
        canonicalUrl: items.canonicalUrl, source: items.source,
        sourceType: items.sourceType, publishedAt: items.publishedAt,
        companyId: items.companyId, status: items.status,
      }).from(items)
        .where(and(
          eq(items.status, 'kept'),
          sql`not exists (select 1 from ${scores} sc where sc.item_id = ${items.id} and sc.rubric_version = ${RUBRIC_VERSION})`,
        ))
        .orderBy(items.id);
      survivors = limit ? heads.slice(0, limit) : heads;
      counts.input = survivors.length;
      counts.survived_filters = survivors.length;
      console.log(`RESCORE under ${RUBRIC_VERSION}: ${survivors.length} heads without a score at this version\n`);
    } else {
    const cutoff = new Date(Date.now() - RECENCY_DAYS * 86400_000);

    for (const it of input) {
      // --- stage 2: domain blocklist ---
      // Domain and publisher name both. Google News wraps every link on
      // news.google.com, so the domain check alone never fires for news items —
      // the publisher only exists in items.source. See lib/blocklist.ts.
      const bd = blockedDomain(it.canonicalUrl);
      if (bd) { drops.push({ id: it.id, reason: `blocked_domain:${bd}` }); counts.dropped_blocked_domain++; continue; }
      const bs = blockedSourceName(it.source);
      if (bs) { drops.push({ id: it.id, reason: `blocked_source:${bs}` }); counts.dropped_blocked_source++; continue; }

      // --- stage 3: pattern drop ---
      const jp = junkPattern(it.title);
      if (jp) { drops.push({ id: it.id, reason: `junk_pattern:${jp}` }); counts.dropped_junk_pattern++; continue; }

      // --- stage 4: company match (company-scoped feeds only) ---
      // ATS items are synthetic and carry the company by construction, so they
      // are exempt: their title is generated from the company name.
      if (it.companyId !== null && it.sourceType !== 'ats') {
        const terms = termsById.get(it.companyId) ?? [];
        const hay = loose(`${it.title} ${it.snippet ?? ''}`);
        if (terms.length && !terms.some((re) => re.test(hay))) {
          drops.push({ id: it.id, reason: 'company_mismatch' });
          counts.dropped_company_mismatch++;
          continue;
        }
      } else if (it.companyId === null && it.sourceType !== 'context') {
        // Untargeted wire item with no company resolved. Brief §7 stage 4
        // requires a company match for company-scoped feeds; a wire item that
        // names nobody we track is dropped here, and step 16 mines it later.
        drops.push({ id: it.id, reason: 'no_company_match' });
        counts.dropped_company_mismatch++;
        continue;
      }

      // --- stage 5: recency ---
      // ATS items have no publication date — a posting is live, not published
      // — so the recency check exempts them.
      if (it.sourceType !== 'ats') {
        if (!it.publishedAt) { drops.push({ id: it.id, reason: 'no_published_date' }); counts.dropped_no_date++; continue; }
        if (it.publishedAt < cutoff) { drops.push({ id: it.id, reason: `older_than_${RECENCY_DAYS}d` }); counts.dropped_stale++; continue; }
      }

      /**
       * A context item names no company by design — a tariff change or a
       * Singapore budget line is read by score-companies as the environment a
       * company is acting in. It is set aside here rather than scored: it has
       * no company to attach to and never belongs in the digest as an item.
       */
      if (it.sourceType === 'context') {
        contextItems.push(it.id);
        counts.context_set_aside++;
        continue;
      }

      survivors.push(it);
    }
    counts.survived_filters = survivors.length;
    }

    // --- stage 6: cluster ---
    const clusters = (rescore && !recluster)
      ? new Map(survivors.map((s2) => [s2.id, [s2.id]]))
      : clusterItems(survivors as Clusterable[]);
    counts.clusters = clusters.size;
    const headIds = new Set(clusters.keys());
    counts.heads_to_score = headIds.size;
    counts.cluster_members_absorbed = survivors.length - headIds.size;

    console.log('per-stage drop counts:');
    for (const [k, v] of Object.entries(counts)) {
      if (k.startsWith('dropped_') || k === 'input' || k === 'survived_filters') {
        const pct = counts.input ? ((v / counts.input) * 100).toFixed(1) : '0.0';
        console.log(`  ${k.padEnd(28)} ${String(v).padStart(6)}  ${pct}%`);
      }
    }
    console.log(`  ${'clusters'.padEnd(28)} ${String(counts.clusters).padStart(6)}`);
    console.log(`  ${'absorbed_as_duplicates'.padEnd(28)} ${String(counts.cluster_members_absorbed).padStart(6)}`);
    console.log(`  ${'heads_to_score'.padEnd(28)} ${String(counts.heads_to_score).padStart(6)}\n`);

    // --- persist filter results ---
    if (!dry && (!rescore || recluster)) {
      // Dropped items: status 'dropped' + reason, and the row stays.
      const byReason = new Map<string, number[]>();
      for (const d of drops) {
        const arr = byReason.get(d.reason);
        if (arr) arr.push(d.id); else byReason.set(d.reason, [d.id]);
      }
      for (const [reason, ids] of byReason) {
        for (let i = 0; i < ids.length; i += 500) {
          await withRetry(() => db.update(items)
            .set({ status: 'dropped', droppedReason: reason })
            .where(inArray(items.id, ids.slice(i, i + 500))));
        }
      }
      // Cluster members: keep, mark as duplicates of their head.
      for (const [head, members] of clusters) {
        const dupes = members.filter((m) => m !== head);
        if (!dupes.length) continue;
        for (let i = 0; i < dupes.length; i += 500) {
          await withRetry(() => db.update(items)
            .set({ status: 'duplicate', droppedReason: 'cluster_member', clusterId: head })
            .where(inArray(items.id, dupes.slice(i, i + 500))));
        }
      }
      // Context items: read by score-companies as the environment, so they are
      // marked processed rather than left at 'fetched' where a later run would
      // pick them up again.
      for (let i = 0; i < contextItems.length; i += 500) {
        await withRetry(() => db.update(items)
          .set({ status: 'context' })
          .where(inArray(items.id, contextItems.slice(i, i + 500))));
      }
      // Heads: kept, pointing at themselves.
      const heads = [...headIds];
      for (let i = 0; i < heads.length; i += 500) {
        await withRetry(() => db.update(items)
          .set({ status: 'kept', clusterId: sql`${items.id}` })
          .where(inArray(items.id, heads.slice(i, i + 500))));
      }
    }

    if (filterOnly) {
      await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
      console.log('FILTER ONLY — no scoring run');
      return;
    }

    // --- stage 7: score the heads -----------------------------------------
    const headRows = survivors.filter((s) => headIds.has(s.id));

    /**
     * Anti-anchoring. Items arrive grouped by company because the feed is
     * queried per company, so a straight slice is 12 items about one company —
     * exactly the uniform batch that drives the model to a single 'unknown'
     * verdict for the whole batch. Interleaving by company keeps every batch
     * mixed.
     */
    const byCompany = new Map<number | null, Row[]>();
    for (const r of headRows) {
      const arr = byCompany.get(r.companyId);
      if (arr) arr.push(r); else byCompany.set(r.companyId, [r]);
    }
    const queues = [...byCompany.values()];
    const interleaved: Row[] = [];
    let pulled = true;
    while (pulled) {
      pulled = false;
      for (const q of queues) {
        const next = q.shift();
        if (next) { interleaved.push(next); pulled = true; }
      }
    }

    const budget = new Budget();
    console.log(`Scoring ${interleaved.length} cluster heads in batches of ${batchSize}...\n`);

    for (let i = 0; i < interleaved.length; i += batchSize) {
      if (budget.halted) {
        console.warn(`\nBudget halted: ${budget.haltReason}`);
        console.warn('Remaining heads keep status \'kept\' and will be scored on the next run.');
        break;
      }
      const batch = interleaved.slice(i, i + batchSize);
      const forScoring: ItemForScoring[] = batch.map((b, k) => ({
        n: k + 1,
        title: b.title,
        snippet: b.snippet,
        source: b.source,
        sourceType: b.sourceType,
        companyName: b.companyId !== null ? nameById.get(b.companyId) ?? null : null,
        companySectors: b.companyId !== null ? sectorsById.get(b.companyId) ?? [] : [],
        publishedAt: b.publishedAt,
      }));

      counts.batches++;
      const res = await callJson<{ scores: ScoreOut[] }>({
        system: ITEM_RUBRIC_SYSTEM,
        user: buildScoringPrompt(forScoring),
        model: env.groqModelScoring(),
        budget,
        temperature: 0.1,
      });

      if (!res.ok || !res.data?.scores) {
        // A malformed response costs one batch, not the run (brief §3).
        counts.batches_failed++;
        console.warn(`  batch ${counts.batches}: FAILED — ${res.error}`);
        continue;
      }

      const out = res.data.scores;
      // Batch-anchoring canary: five or more items collapsing to a single
      // distinct score is the shape of the anchoring failure, so it gets logged
      // where it will be seen.
      const distinct = new Set(out.map((s) => s.score));
      if (batch.length >= 5 && distinct.size === 1) {
        counts.uniform_batches++;
        console.warn(`  batch ${counts.batches}: UNIFORM SCORE ${[...distinct][0]} across ${out.length} items — possible batch anchoring, inspect`);
      }

      const rows: Array<typeof scores.$inferInsert> = [];
      for (const s of out) {
        const item = batch[s.n - 1];
        if (!item) continue;
        const score = Math.max(0, Math.min(3, Math.round(Number(s.score))));
        if (!Number.isFinite(score)) continue;
        rows.push({
          itemId: item.id,
          score,
          signalType: isSignalType(s.signal_type) ? s.signal_type : 'other',
          sectors: Array.isArray(s.sectors) ? s.sectors.filter((x) => typeof x === 'string' && isSector(x)) : [],
          region: typeof s.region === 'string' ? s.region : null,
          expansionLanguage: Boolean(s.expansion_language),
          // Momentum is optional in the response: a model that omits it leaves
          // null rather than 0, because "not judged" and "no momentum" are
          // different facts and the dashboard ranks on this.
          momentum: Number.isFinite(Number(s.momentum))
            ? Math.max(0, Math.min(3, Math.round(Number(s.momentum))))
            : null,
          // Stored as ' · '-joined text so the column stays a string, and split
          // back into points at render. Older rows are single points, which
          // renders correctly as a one-item list.
          why: (Array.isArray(s.why) ? s.why.filter((w) => typeof w === 'string' && w.trim()).join(' · ') : String(s.why ?? ''))
            .slice(0, 600) || 'no rationale returned',
          rubricVersion: RUBRIC_VERSION,
          model: res.model,
          fewshotUsed: env.fewshotEnabled(),
        });
        counts.scored++;
        counts[`score_${score}`]++;
        const m = rows[rows.length - 1].momentum;
        if (m === null || m === undefined) counts.momentum_missing++;
        else counts[`momentum_${m}`]++;
      }

      if (!dry && rows.length) {
        await withRetry(() => db.insert(scores).values(rows)
          .onConflictDoNothing({ target: [scores.itemId, scores.rubricVersion] }));
      }
      console.log(`  batch ${counts.batches}: ${rows.length} scored (${counts.scored}/${interleaved.length})`);
    }

    Object.assign(counts, { tokens_in: budget.tokensIn, tokens_out: budget.tokensOut });
    await db.update(runs).set({
      finishedAt: new Date(), counts,
      tokensIn: budget.tokensIn, tokensOut: budget.tokensOut,
      error: budget.halted ? `halted: ${budget.haltReason}` : null,
    }).where(eq(runs.id, run.id));

    console.log('\ncounts:', JSON.stringify(counts, null, 2));
  } catch (e) {
    await db.update(runs)
      .set({ finishedAt: new Date(), counts, error: (e as Error).message })
      .where(eq(runs.id, run.id));
    throw e;
  }
})();
