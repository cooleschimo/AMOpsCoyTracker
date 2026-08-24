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
 *
 * --with-signals targets companies that have a SCORED ITEM at 2 or better and
 * no assessment yet. This is the set the digest actually needs: brief §7a
 * places items by a MATRIX of the item score and the company assessment, and
 * without the second axis a large raise at an out-of-scope company outranks
 * silence at a strategically important one — the exact failure §7a exists to
 * prevent. The default targeting (Form D discoveries with no sectors) never
 * reaches the seed watchlist, so before this flag 1 of 56 companies with a
 * live signal had an assessment.
 */
import '../lib/loadenv';
import { eq, sql, and, isNull, or } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { companies, companyAssessments, runs } from '../lib/schema';
import { callJson } from '../lib/llm';
import { Budget } from '../lib/budget';
import { env } from '../lib/env';
import {
  COMPANY_ASSESSMENT_SYSTEM, COMPANY_RUBRIC_VERSION, buildAssessmentPrompt, isBand,
} from '../lib/company-rubric';
import { isSector } from '../lib/scope';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

type Assessment = {
  name: string; sectors: string[];
  target_priority: string; singapore_fit: string;
  potential_contribution: string; confidence: string; rationale: string;
};

(async () => {
  const db = getDb();
  const batchSize = Number(arg('batch', '11'));
  const limit = Number(arg('limit', '0'));
  const dry = flag('dry');
  const force = flag('force');

  const withSignals = flag('with-signals');

  // Default target: in-scope Form D discoveries with no sectors yet — the
  // genuinely ambiguous set left after the EDGAR industry mapping.
  // --with-signals: any company holding a scored item at 2+ and no assessment.
  const pending = withSignals
    ? await db.select({
        id: companies.id, name: companies.name, hqState: companies.hqState,
        website: companies.website, description: companies.description,
      }).from(companies)
        .where(and(
          sql`exists (select 1 from scores sc join items it on it.id = sc.item_id
                      where it.company_id = ${companies.id} and sc.score >= 2)`,
          force ? sql`true` : sql`not exists (select 1 from company_assessments ca
                      where ca.company_id = ${companies.id})`,
        ))
    : await db.select({
        id: companies.id, name: companies.name, hqState: companies.hqState,
        website: companies.website, description: companies.description,
      }).from(companies)
        .where(and(
          eq(companies.discoveredVia, 'form_d'),
          eq(companies.scopeStatus, 'in_scope'),
          force ? sql`true` : or(isNull(companies.sectors), sql`array_length(${companies.sectors}, 1) is null`),
        ));

  const targets = limit ? pending.slice(0, limit) : pending;
  console.log(`${targets.length} companies pending assessment (batch size ${batchSize})`);
  if (!targets.length) return;

  const [run] = await db.insert(runs).values({ stage: 'assess' }).returning();
  const budget = new Budget();
  const counts = { batches: 0, batches_failed: 0, assessed: 0, sector_assigned: 0, no_sector: 0, unmatched: 0 };
  const results: Array<Assessment & { id: number }> = [];

  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    const user = buildAssessmentPrompt(batch.map((c) => ({
      name: c.name,
      industry: (c.description ?? '').replace('Form D industry group: ', '') || null,
      state: c.hqState, website: c.website,
    })));

    counts.batches++;
    console.log(`  batch ${counts.batches}: ${batch.length} companies...`);

    const res = await callJson<{ assessments: Assessment[] }>({
      system: COMPANY_ASSESSMENT_SYSTEM,
      user,
      model: env.groqModelScoring(),
      budget,
      temperature: 0.1,
    });

    if (!res.ok || !res.data?.assessments) {
      // Logged and skipped; the run continues.
      counts.batches_failed++;
      console.warn(`    FAILED: ${res.error}`);
      continue;
    }

    for (const a of res.data.assessments) {
      // Match back by name; the model is told to echo it exactly.
      const target = batch.find((c) => c.name === a.name)
        ?? batch.find((c) => c.name.toLowerCase() === String(a.name ?? '').toLowerCase());
      if (!target) { counts.unmatched++; continue; }

      const sectors = Array.isArray(a.sectors) ? a.sectors.filter(isSector) : [];
      const bands = {
        targetPriority: isBand(a.target_priority) ? a.target_priority : 'unknown',
        singaporeFit: isBand(a.singapore_fit) ? a.singapore_fit : 'unknown',
        potentialContribution: isBand(a.potential_contribution) ? a.potential_contribution : 'unknown',
        confidence: isBand(a.confidence) ? a.confidence : 'low',
      };

      results.push({ ...a, id: target.id, sectors });
      counts.assessed++;
      if (sectors.length) counts.sector_assigned++; else counts.no_sector++;

      if (!dry) {
        await db.insert(companyAssessments).values({
          companyId: target.id, ...bands,
          rationale: a.rationale ?? null,
          model: res.model, rubricVersion: COMPANY_RUBRIC_VERSION,
        });
        // Sectors are written only when the model found some. An empty result
        // means "not in scope", which scope_status is what records; a real
        // classification keeps its value rather than being replaced by silence.
        if (sectors.length) {
          await db.update(companies).set({ sectors }).where(eq(companies.id, target.id));
        } else {
          await db.update(companies)
            .set({ scopeStatus: 'out_of_scope', scopeReason: `assessment ${COMPANY_RUBRIC_VERSION}: no in-scope sector` })
            .where(eq(companies.id, target.id));
        }
      }
    }
  }

  if (!dry) {
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
    console.log(`    sectors      : ${r.sectors.length ? r.sectors.join(', ') : '(none - out of scope)'}`);
    console.log(`    priority     : ${r.target_priority}   sg_fit: ${r.singapore_fit}   contribution: ${r.potential_contribution}`);
    console.log(`    confidence   : ${r.confidence}`);
    console.log(`    rationale    : ${r.rationale}`);
  }
})();
