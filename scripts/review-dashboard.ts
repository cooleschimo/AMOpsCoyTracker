/**
 * Check the finished dashboard set before anyone reads it. Brief §7b.
 *
 * Runs after placement, over the companies that actually earned a slot, and
 * asks the one question no earlier stage can: are these really distinct
 * companies with evidence that holds up. See lib/company-review.ts for what it
 * looks for and why those four defects.
 *
 * Nothing here edits a company. A verdict is a proposal recorded in
 * `company_reviews`: 'duplicate' names a merge target for a person to confirm,
 * and the two verdicts that mean "there is no company here" set
 * hide_from_dashboard so the slot is not wasted while it waits. A merge run on a
 * model's say-so would silently destroy the row it was wrong about.
 *
 * One call for the whole set, not batches — two rows are only visibly the same
 * company when they sit beside each other.
 *
 * Usage: npx tsx scripts/review-dashboard.ts [--week YYYY-MM-DD] [--dry]
 */
import '../lib/loadenv';
import { eq } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { companyReviews, runs } from '../lib/schema';
import { callJson } from '../lib/llm';
import { openBudget } from '../lib/budget-store';
import { getWeeklyDigest } from '../lib/dashboard-data';
import {
  COMPANY_REVIEW_SYSTEM, COMPANY_REVIEW_VERSION, HIDING_VERDICTS,
  buildReviewPrompt, isReviewVerdict, type ReviewInput,
} from '../lib/company-review';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

type Out = {
  reviews?: Array<{
    id?: number; verdict?: string; duplicate_of?: number | null;
    suggested_name?: string | null; reason?: string | null;
  }>;
};

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const week = arg('week');
  const dry = flag('dry');

  /**
   * The placed set, read through the same function the dashboard renders from,
   * so the review sees exactly what a reader would. Querying company_signals
   * directly would review companies that placement had already left out.
   */
  // withInternal: this reads whoWeKnow and monitoring, which are empty
  // without it — the review would then pass over exactly the companies a
  // person had marked.
  const digest: any = await getWeeklyDigest(undefined, week, { withInternal: true });
  const seen = new Set<number>();
  const placed: ReviewInput[] = [];
  for (const list of [digest.worthAConversation, digest.newOnTheRadar,
                      digest.whoWeKnow, digest.monitoring] as any[][]) {
    for (const c of list ?? []) {
      if (seen.has(c.companyId)) continue;
      seen.add(c.companyId);
      placed.push({
        id: c.companyId,
        name: c.name,
        sectors: c.sectors ?? [],
        hq: c.hq && c.hq !== 'Unknown' ? c.hq : null,
        description: c.oneLiner ?? null,
        why: (c.whyNow ?? []).map((p: any) => p.text).join(' · ') || null,
        headline: c.trigger?.headline ?? null,
        itemCount: c.clusterSize ?? 0,
      });
    }
  }

  console.log(`${placed.length} companies on the dashboard${week ? ` (week of ${week})` : ''}\n`);
  if (!placed.length) return;

  const weekOf = week
    ?? (await sqlc`select max(week_of)::date w from company_signals
                   where signal_version = 'signal-v8'`)[0]?.w;

  const [run] = await db.insert(runs).values({ stage: 'review_dashboard' }).returning();
  const budget = await openBudget();
  const counts: Record<string, number> = {
    considered: placed.length, ok: 0, malformed_name: 0, duplicate: 0,
    weak_evidence: 0, not_a_company: 0, hidden: 0, unmatched: 0, failed: 0,
  };

  try {
    const res = await callJson<Out>({
      system: COMPANY_REVIEW_SYSTEM,
      user: buildReviewPrompt(placed),
      budget,
      temperature: 0.1,
    });

    if (!res.ok || !res.data?.reviews) {
      counts.failed++;
      console.warn(`FAILED: ${res.error ?? 'no reviews returned'}`);
    } else {
      const byId = new Map(placed.map((p) => [p.id, p]));
      for (const r of res.data.reviews) {
        const c = typeof r.id === 'number' ? byId.get(r.id) : undefined;
        if (!c) { counts.unmatched++; continue; }

        const verdict = isReviewVerdict(String(r.verdict)) ? String(r.verdict) : 'ok';
        counts[verdict] = (counts[verdict] ?? 0) + 1;

        // A duplicate target has to be in the same set, or the merge it
        // proposes points at a company nobody reviewed.
        const dupOf = typeof r.duplicate_of === 'number' && byId.has(r.duplicate_of)
          && r.duplicate_of !== c.id ? r.duplicate_of : null;
        const hide = HIDING_VERDICTS.includes(verdict as never);
        if (hide) counts.hidden++;

        if (verdict !== 'ok') {
          const tgt = dupOf ? ` -> #${dupOf} ${byId.get(dupOf)?.name}` : '';
          console.log(`  ${verdict.padEnd(15)} ${c.name.slice(0, 34).padEnd(36)}${tgt}`);
          if (r.reason) console.log(`  ${''.padEnd(15)}   ${String(r.reason).slice(0, 96)}`);
          if (r.suggested_name) console.log(`  ${''.padEnd(15)}   suggested name: ${r.suggested_name}`);
        }

        if (!dry) {
          await withRetry(() => db.insert(companyReviews).values({
            companyId: c.id, weekOf, verdict,
            duplicateOfId: dupOf,
            suggestedName: r.suggested_name?.trim() || null,
            reason: r.reason?.trim() || null,
            hideFromDashboard: hide,
            rubricVersion: COMPANY_REVIEW_VERSION,
            model: res.model,
          }).onConflictDoUpdate({
            target: [companyReviews.companyId, companyReviews.weekOf, companyReviews.rubricVersion],
            set: {
              verdict, duplicateOfId: dupOf,
              suggestedName: r.suggested_name?.trim() || null,
              reason: r.reason?.trim() || null,
              hideFromDashboard: hide, reviewedAt: new Date(), model: res.model,
            },
          }));
        }
      }
    }
  } finally {
    await budget.done();
    await db.update(runs).set({
      finishedAt: new Date(), counts,
      tokensIn: budget.tokensIn, tokensOut: budget.tokensOut,
    }).where(eq(runs.id, run.id));
  }

  console.log(`\ncounts: ${JSON.stringify(counts)}`);
  if (counts.duplicate) {
    console.log(`\n${counts.duplicate} proposed merge${counts.duplicate === 1 ? '' : 's'} — review at /admin/review before merging.`);
  }
  if (dry) console.log('DRY RUN — nothing written');
})();
