/**
 * Company-level assessment. Brief §7a.
 *
 * Batches 10-15 companies per call (brief §7). The Groq free tier allows 8,000
 * tokens per minute, so the batch size is capped to stay under that with the
 * system prompt included.
 *
 * A malformed response costs one batch, not the run: lib/llm.ts returns null
 * rather than throwing, and the failed batch is logged and skipped.
 *
 * Usage: npx tsx scripts/assess-companies.ts [--limit N] [--batch 12] [--dry] [--force]
 *        npx tsx scripts/assess-companies.ts --with-signals
 *        npx tsx scripts/assess-companies.ts --stale
 *
 * --with-signals targets companies that have a SCORED ITEM at 2 or better and
 * no assessment yet. This is the set the digest actually needs: brief §7a
 * places items by a MATRIX of the item score and the company assessment, and
 * without the second axis a large raise at an out-of-scope company outranks
 * silence at a strategically important one — the exact failure §7a exists to
 * prevent. The default targeting (Form D discoveries with no sectors) never
 * reaches the hand-imported companies, so before this flag 1 of 56 companies
 * with a live signal had an assessment.
 */
import '../lib/loadenv';
import { eq, sql, and, isNull, or } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { companies, companyAssessments, runs } from '../lib/schema';
import { callJson } from '../lib/llm';
import { openBudget } from '../lib/budget-store';
import { env } from '../lib/env';
import {
  COMPANY_ASSESSMENT_SYSTEM, COMPANY_RUBRIC_VERSION, buildAssessmentPrompt, isBand,
} from '../lib/company-rubric';
import { isUsState } from '../lib/scope';
import { CONTRIBUTION_DRIVERS } from '../lib/company-rubric';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

/** The states hq_region treats as West Coast, for ordering the queue. */
const WEST_COAST_STATES = new Set(['CA', 'WA', 'OR', 'NV', 'AZ', 'CO', 'UT', 'ID', 'NM']);

/**
 * The shape the assessment must return.
 *
 * Without it the call described its shape in the prompt and hoped, which is
 * what emptied the last four runs — 4 of 4 batches failing and nothing
 * assessed. Groq's JSON mode requires every property in `required`, so the
 * optional fields are nullable strings rather than absent ones.
 */
const str = { type: ['string', 'null'] } as const;
const ASSESSMENT_SCHEMA = {
  type: 'object',
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          sectors: { type: 'array', items: { type: 'string' } },
          target_priority: { type: 'string' },
          singapore_fit: { type: 'string' },
          potential_contribution: { type: 'string' },
          contribution_drivers: { type: 'array', items: { type: 'string' } },
          apac_footprint: str, apac_footprint_detail: str,
          prior_expansions: str, prior_expansions_detail: str,
          financial_health: str, financial_health_detail: str,
          confidence: { type: 'string' },
          rationale: { type: 'string' },
          revision_note: str,
          priority_reason: str, singapore_fit_reason: str,
          contribution_reason: str, confidence_reason: str,
        },
        required: [
          'name', 'sectors', 'target_priority', 'singapore_fit', 'potential_contribution',
          'contribution_drivers', 'apac_footprint', 'apac_footprint_detail',
          'prior_expansions', 'prior_expansions_detail', 'financial_health',
          'financial_health_detail', 'confidence', 'rationale', 'revision_note',
          'priority_reason', 'singapore_fit_reason', 'contribution_reason', 'confidence_reason',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['assessments'],
  additionalProperties: false,
} as const;

type Assessment = {
  name: string; sectors: string[];
  target_priority: string; singapore_fit: string;
  potential_contribution: string; contribution_drivers?: string[];
  apac_footprint?: string; apac_footprint_detail?: string;
  prior_expansions?: string; prior_expansions_detail?: string;
  financial_health?: string; financial_health_detail?: string;
  confidence: string; rationale: string; revision_note?: string;
  priority_reason?: string; singapore_fit_reason?: string;
  contribution_reason?: string; confidence_reason?: string;
};

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const batchSize = Number(arg('batch', '11'));
  // Well below the twenty-two keys in the chain: workers share one chain walked
  // in the same order, so more of them queue rather than spread.
  const concurrency = Math.max(1, Number(arg('workers', '4')));
  const limit = Number(arg('limit', '0'));
  const dry = flag('dry');
  const force = flag('force');

  const withSignals = flag('with-signals');
  const stale = flag('stale');

  /**
   * Default target: any company with activity this window and no assessment at
   * the current rubric version.
   *
   * It used to be in-scope Form D discoveries with no sectors yet, which had
   * two consequences neither of them intended. Seed companies were never
   * eligible at all — nine of them reached the digest unassessed, which put
   * them in "new on the radar" as though the tool had judged them marginal when
   * it had simply never looked. And once classify-sectors.ts took over sector
   * classification, "no sectors yet" became false for everything, so no company
   * could ever be re-assessed.
   *
   * --with-signals narrows to companies holding a scored item at 2+.
   */
  /*
   * --stale: companies judged BEFORE the evidence arrived.
   *
   * An assessment is skipped once one exists at the current rubric version, so
   * a company assessed from a bare name stays at that judgment even after
   * enrich-websites and classify-sectors give it a website and a sector. That
   * is the ordinary case when enrichment and assessment run out of order: the
   * answer is not wrong so much as made from less than was available.
   *
   * --force would re-assess every company; this re-assesses only the ones whose
   * evidence changed after they were judged.
   */
  const pending = stale
    ? await db.select({
        id: companies.id, name: companies.name, hqState: companies.hqState,
        website: companies.website, description: companies.description,
      }).from(companies)
        .where(and(
          sql`coalesce(${companies.scopeStatus}, 'unknown') <> 'out_of_scope'`,
          sql`(${companies.website} is not null or cardinality(coalesce(${companies.sectors}, '{}')) > 0)`,
          sql`exists (select 1 from company_assessments ca
                      where ca.company_id = ${companies.id}
                        and ca.rubric_version = ${COMPANY_RUBRIC_VERSION}
                        and ca.confidence = 'low')`,
        ))
    : withSignals
    ? await db.select({
        id: companies.id, name: companies.name, hqState: companies.hqState,
        website: companies.website, description: companies.description,
      }).from(companies)
        .where(and(
          sql`exists (select 1 from scores sc join items it on it.id = sc.item_id
                      where it.company_id = ${companies.id} and sc.score >= 2)`,
          // Not assessed AT THE CURRENT RUBRIC VERSION. company_assessments is
          // queried by version, so re-assessing under a new version preserves
          // the old judgments and both are available to tell whether a change
          // helped — the same contract as scores.rubric_version.
          force ? sql`true` : sql`not exists (select 1 from company_assessments ca
                      where ca.company_id = ${companies.id}
                        and ca.rubric_version = ${COMPANY_RUBRIC_VERSION})`,
        ))
    : await db.select({
        id: companies.id, name: companies.name, hqState: companies.hqState,
        website: companies.website, description: companies.description,
      }).from(companies)
        .where(and(
          // Confidently out of scope stays out; 'unknown' is not a judgment.
          sql`coalesce(${companies.scopeStatus}, 'unknown') <> 'out_of_scope'`,
          sql`exists (select 1 from company_signals cs
                      where cs.company_id = ${companies.id}
                        and cs.week_of > current_date - 60)`,
          force ? sql`true` : sql`not exists (select 1 from company_assessments ca
                      where ca.company_id = ${companies.id}
                        and ca.rubric_version = ${COMPANY_RUBRIC_VERSION})`,
        ));

  /**
   * US companies first, West Coast before the rest.
   *
   * Discovery reads every source, so it finds Japanese, German and Chinese
   * companies alongside American ones. Most of those will never be an EDB
   * target, and assessment is the expensive step: the daily LLM allowance runs
   * out partway through most runs, and whichever companies are at the end of
   * the queue simply do not get judged that day.
   *
   * Ordering by geography decides who that is. A foreign company doing
   * something in the US is still discovered, still scored, and still assessed —
   * just after the companies more likely to matter.
   */
  const geoRank = (c: { hqState: string | null }) => {
    const st = (c.hqState ?? '').trim();
    if (!isUsState(st)) return 2;
    return WEST_COAST_STATES.has(st) ? 0 : 1;
  };
  const ordered = [...pending].sort((a, b) => geoRank(a) - geoRank(b));

  const targets = limit ? ordered.slice(0, limit) : ordered;
  const byGeo = targets.reduce((acc, c) => { acc[geoRank(c)]++; return acc; }, [0, 0, 0]);
  console.log(`${targets.length} companies pending assessment (batch size ${batchSize})`);
  console.log(`  ${byGeo[0]} West Coast, ${byGeo[1]} rest of US, ${byGeo[2]} international\n`);
  if (!targets.length) return;

  const [run] = await db.insert(runs).values({ stage: 'assess' }).returning();
  const budget = await openBudget();
  const counts = { batches: 0, batches_failed: 0, assessed: 0, sector_assigned: 0, no_sector: 0, unmatched: 0, vanished: 0 };
  const results: Array<Assessment & { id: number }> = [];

  try {

    /*
     * Batches run several at a time.
     *
     * Every limit is per KEY — lib/llm.ts throttles per key for the same reason —
     * so twenty-two keys carry twenty-two separate RPM allowances, and running
     * one batch at a time left twenty-one of them idle. A run that took three
     * hours was waiting on rate limits it was not actually hitting.
     *
     * Kept well below the key count. Each worker walks the same chain in the same
     * order, so more workers than keys would have them queueing behind the first
     * few rather than spreading out, and a burst large enough to trip a provider
     * costs more than it saves.
     */
    const batches: typeof targets[] = [];
    for (let i = 0; i < targets.length; i += batchSize) batches.push(targets.slice(i, i + batchSize));

    const runBatch = async (batch: typeof targets) => {
      // The standing judgment and what has been learned since. Each run revises
      // rather than replaces, so a band moves on accumulated evidence and a quiet
      // week leaves it where it was.
      const priors = new Map<number, any>();
      const evidence = new Map<number, string[]>();
      for (const c of batch) {
        const [p]: any = await sqlc`
          select target_priority, singapore_fit, potential_contribution,
                 apac_footprint, prior_expansions, financial_health,
                 confidence, rationale, assessed_at
          from company_assessments where company_id = ${c.id}
          order by assessed_at desc limit 1`;
        if (p) priors.set(c.id, p);

        const sig: any = await sqlc`
          select why, expansion, momentum, partnership, week_of
          from company_signals where company_id = ${c.id}
          order by week_of desc limit 4`;
        const jobs: any = await sqlc`
          select total_jobs, non_us_jobs, apac_jobs, snapshot_at
          from job_snapshots where company_id = ${c.id}
          order by snapshot_at desc limit 1`;

        const ev: string[] = [];
        for (const x of sig) {
          ev.push(`week of ${x.week_of}: expansion ${x.expansion}, momentum ${x.momentum}, partnership ${x.partnership} — ${String(x.why).split(' · ').join('; ')}`);
        }
        if (jobs[0]) {
          ev.push(`hiring: ${jobs[0].total_jobs} open roles, ${jobs[0].non_us_jobs} outside the US, ${jobs[0].apac_jobs} in APAC`);
        }
        if (ev.length) evidence.set(c.id, ev);
      }

      const user = buildAssessmentPrompt(batch.map((c) => ({
        name: c.name,
        industry: (c.description ?? '').replace('Form D industry group: ', '') || null,
        state: c.hqState, website: c.website,
        prior: priors.get(c.id) ? {
          targetPriority: priors.get(c.id).target_priority,
          singaporeFit: priors.get(c.id).singapore_fit,
          potentialContribution: priors.get(c.id).potential_contribution,
          apacFootprint: priors.get(c.id).apac_footprint,
          priorExpansions: priors.get(c.id).prior_expansions,
          financialHealth: priors.get(c.id).financial_health,
          confidence: priors.get(c.id).confidence,
          rationale: priors.get(c.id).rationale,
          assessedAt: priors.get(c.id).assessed_at ? new Date(priors.get(c.id).assessed_at) : null,
        } : null,
        evidence: evidence.get(c.id) ?? [],
      })));

      // Numbered by completion, not by position: with several workers the order
      // is not the order the batches were taken in, and a number that implies one
      // is worse than a count.
      counts.batches++;
      console.log(`  batch ${counts.batches}/${batches.length}: ${batch.length} companies...`);

      const res = await callJson<{ assessments: Assessment[] }>({
        system: COMPANY_ASSESSMENT_SYSTEM,
        user,
        model: env.groqModelScoring(),
        budget,
        temperature: 0.1,
        schema: ASSESSMENT_SCHEMA,
      });

      if (!res.ok || !res.data?.assessments) {
        /*
         * Ask for less before giving up.
         *
         * Eleven assessments in one reply is about 21,000 output tokens, which
         * is where gpt-oss stops mid-object: the JSON is unparseable because
         * the model ran out of room, not because it misunderstood. Skipping
         * cost eighteen companies in one night and left them for the next run
         * to hit the same ceiling with the same batch size.
         *
         * Halving and re-asking is the one retry that changes the question.
         * Each half goes through this same path, so a batch that is still too
         * large splits again, down to a single company — and one company that
         * genuinely cannot be parsed is skipped alone rather than taking ten
         * others with it.
         */
        if (batch.length > 1) {
          const mid = Math.ceil(batch.length / 2);
          console.warn(`    ${res.error} — splitting ${batch.length} into ${mid} + ${batch.length - mid}`);
          await runBatch(batch.slice(0, mid));
          await runBatch(batch.slice(mid));
          return;
        }
        // Logged and skipped; the other workers carry on.
        counts.batches_failed++;
        console.warn(`    FAILED: ${res.error}`);
        return;
      }

      for (const a of res.data.assessments) {
        // Match back by name; the model is told to echo it exactly.
        const target = batch.find((c) => c.name === a.name)
          ?? batch.find((c) => c.name.toLowerCase() === String(a.name ?? '').toLowerCase());
        if (!target) { counts.unmatched++; continue; }

        // Scope only. Sectors are classified by scripts/classify-sectors.ts
        // against lib/subsectors.ts; an assessment that also wrote them would
        // overwrite that taxonomy with whatever this prompt happened to return.
        const inScope = (a as any).in_scope === true;
        const bands = {
          targetPriority: isBand(a.target_priority) ? a.target_priority : 'unknown',
          singaporeFit: isBand(a.singapore_fit) ? a.singapore_fit : 'unknown',
          potentialContribution: isBand(a.potential_contribution) ? a.potential_contribution : 'unknown',
          // 'none' is a finding for footprint, distinct from 'unknown'.
          apacFootprint: (isBand(a.apac_footprint) || a.apac_footprint === 'none') ? a.apac_footprint : 'unknown',
          apacFootprintDetail: (a.apac_footprint_detail ?? '').slice(0, 200) || null,
          priorExpansions: isBand(a.prior_expansions) ? a.prior_expansions : 'unknown',
          priorExpansionsDetail: (a.prior_expansions_detail ?? '').slice(0, 200) || null,
          financialHealth: isBand(a.financial_health) ? a.financial_health : 'unknown',
          financialHealthDetail: (a.financial_health_detail ?? '').slice(0, 200) || null,
          revisionNote: (a.revision_note ?? '').slice(0, 300) || null,
          // Which dimensions drive the band. Constrained to the known set so the
          // stats page can count them; anything else the model invents is dropped.
          contributionDrivers: Array.isArray(a.contribution_drivers)
            ? a.contribution_drivers
                .filter((d): d is string => typeof d === 'string')
                .filter((d) => CONTRIBUTION_DRIVERS.includes(d as never))
                .slice(0, 2)
            : [],
          confidence: isBand(a.confidence) ? a.confidence : 'low',
        };

        results.push({ ...a, id: target.id, sectors: [] });
        counts.assessed++;
        if (inScope) counts.sector_assigned++; else counts.no_sector++;

        if (!dry) {
          /*
           * Retried: Neon's HTTP endpoint drops a connection under load, and an
           * unretried write ended a run at batch nine, losing every company after
           * it. A dropped connection is not a reason to abandon the batch.
           *
           * A vanished company is not either. The target list is read once at
           * startup and the run takes hours, so a merge or a cleanup elsewhere
           * can delete a row this batch is still holding — the foreign key then
           * fails the insert and, unguarded, killed the whole stage seventeen
           * batches in. The company is gone; there is nothing to assess and
           * nothing to fix, so it is counted and stepped over.
           */
          try {
            await withRetry(() => db.insert(companyAssessments).values({
              companyId: target.id, ...bands,
              rationale: a.rationale ?? null,
              priorityReason: a.priority_reason ?? null,
              singaporeFitReason: a.singapore_fit_reason ?? null,
              contributionReason: a.contribution_reason ?? null,
              confidenceReason: a.confidence_reason ?? null,
              model: res.model, rubricVersion: COMPANY_RUBRIC_VERSION,
            }));
          } catch (e) {
            const msg = (e as Error).message ?? '';
            if (!/foreign key|companies_id_fk/i.test(msg)) throw e;
            counts.vanished++;
            counts.assessed--;
            console.warn(`    ${target.name} was deleted mid-run; skipped`);
            continue;
          }
          // Out of scope is recorded; in scope leaves scope_status alone, since
          // the sector itself is not this script's to write.
          if (!inScope) {
            await withRetry(() => db.update(companies)
              .set({ scopeStatus: 'out_of_scope', scopeReason: `assessment ${COMPANY_RUBRIC_VERSION}: not in scope` })
              .where(eq(companies.id, target.id)));
          }
        }
      }
    };

    /*
     * A fixed pool: each worker takes the next batch as it frees up, so a slow
     * batch does not hold the others behind it the way a chunked split would.
     */
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      for (;;) {
        const mine = batches[next++];
        if (!mine) return;
        if (budget.halted) return;
        await runBatch(mine);
      }
    }));

  } finally {
    // The health check reads an unfinished row as a stage still going, so the
    // row has to be closed even when the stage dies partway. A dry run opens a
    // row like any other and has to close it too.
    await budget.done();
    await db.update(runs).set({
      finishedAt: new Date(), counts,
      tokensIn: budget.tokensIn, tokensOut: budget.tokensOut,
      error: budget.halted ? budget.haltReason : null,
    }).where(eq(runs.id, run.id));
  }

  console.log('\n=== ASSESSMENT ===');
  console.table(counts);
  console.log(`tokens: ${budget.tokensIn} in / ${budget.tokensOut} out · requests ${budget.requests}` +
    (budget.halted ? ` · HALTED: ${budget.haltReason}` : ''));

  console.log('\n--- results ---');
  for (const r of results) {
    console.log(`\n  ${r.name}`);
    console.log(`    in scope     : ${(r as any).in_scope === true ? 'yes' : 'no'}`);
    console.log(`    priority     : ${r.target_priority}   sg_fit: ${r.singapore_fit}   contribution: ${r.potential_contribution}`);
    console.log(`    confidence   : ${r.confidence}`);
    console.log(`    rationale    : ${r.rationale}`);
    // Print the per-band reasons too: they are what the dashboard shows on the
    // band itself, so a dry run has to make them checkable.
    if (r.priority_reason) console.log(`    why priority : ${r.priority_reason}`);
    if (r.singapore_fit_reason) console.log(`    why sg_fit   : ${r.singapore_fit_reason}`);
    if (r.contribution_reason) console.log(`    why contrib  : ${r.contribution_reason}`);
    if (r.confidence_reason) console.log(`    why confid.  : ${r.confidence_reason}`);
  }
})();
