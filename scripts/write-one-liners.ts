/**
 * Writes the one-line description shown under a company name on the dashboard.
 *
 * Targets the companies that actually appear there — those holding a signal in
 * the current week — rather than every company in the table. The line is only
 * read on a card, so generating it for the 617 tracked companies would spend
 * the daily LLM allowance on rows nobody will look at.
 *
 * Companies that already have a line are skipped. What a company does does not
 * change week to week, so this is written once and left alone; --force re-runs
 * a company whose line came out badly.
 *
 * A malformed response costs one batch, not the run: lib/llm.ts returns null
 * rather than throwing, and the failed batch is logged and skipped.
 *
 * Usage: npx tsx scripts/write-one-liners.ts [--limit N] [--batch 12] [--dry] [--force]
 *        npx tsx scripts/write-one-liners.ts --all   (every tracked company)
 */
import '../lib/loadenv';
import { getDb, getSql, withRetry } from '../lib/db';
import { companies, runs } from '../lib/schema';
import { eq } from 'drizzle-orm';
import { callJson } from '../lib/llm';
import { Budget } from '../lib/budget';
import { env } from '../lib/env';
import {
  ONE_LINER_SYSTEM, buildOneLinerPrompt, cleanOneLiner, type OneLinerInput,
} from '../lib/one-liner';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

/**
 * Required by Groq's JSON mode, which needs every property listed in
 * `required`. `line` is nullable because abstention is a real answer.
 */
const LINES_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          line: { type: ['string', 'null'] },
        },
        required: ['name', 'line'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
} as const;

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const batchSize = Number(arg('batch', '12'));
  const limit = Number(arg('limit', '0'));
  const dry = flag('dry');
  const force = flag('force');
  const all = flag('all');

  /*
   * The dashboard's own set: a signal in the most recent week, and not the
   * portfolio or anything ruled out of scope. Ordered so companies with the
   * most evidence go first — if the allowance runs out, it runs out on the
   * companies the model was least likely to describe anyway.
   *
   * Written out rather than assembled from fragments: the Neon HTTP driver
   * parameterises every interpolation, so a nested tagged template arrives at
   * Postgres as a bound value where SQL was meant and the statement does not
   * parse. The two flags are booleans known here, so the branch belongs here.
   */
  const onlyMissing = !force;
  const pending: any = all
    ? onlyMissing
      ? await sqlc`
          select c.id, c.name, c.sectors, c.description, c.website
            from companies c
           where coalesce(c.discovered_via,'') <> 'portfolio'
             and coalesce(c.scope_status,'unknown') <> 'out_of_scope'
             and (c.one_liner is null or length(trim(c.one_liner)) = 0)
           order by length(coalesce(c.description,'')) desc`
      : await sqlc`
          select c.id, c.name, c.sectors, c.description, c.website
            from companies c
           where coalesce(c.discovered_via,'') <> 'portfolio'
             and coalesce(c.scope_status,'unknown') <> 'out_of_scope'
           order by length(coalesce(c.description,'')) desc`
    : onlyMissing
      ? await sqlc`
          select c.id, c.name, c.sectors, c.description, c.website
            from companies c
           where exists (
                   select 1 from company_signals cs
                    where cs.company_id = c.id
                      and cs.week_of = (select max(week_of) from company_signals))
             and coalesce(c.discovered_via,'') <> 'portfolio'
             and coalesce(c.scope_status,'unknown') <> 'out_of_scope'
             and (c.one_liner is null or length(trim(c.one_liner)) = 0)
           order by length(coalesce(c.description,'')) desc`
      : await sqlc`
          select c.id, c.name, c.sectors, c.description, c.website
            from companies c
           where exists (
                   select 1 from company_signals cs
                    where cs.company_id = c.id
                      and cs.week_of = (select max(week_of) from company_signals))
             and coalesce(c.discovered_via,'') <> 'portfolio'
             and coalesce(c.scope_status,'unknown') <> 'out_of_scope'
           order by length(coalesce(c.description,'')) desc`;
  const targets = limit ? pending.slice(0, limit) : pending;

  console.log(`${targets.length} companies need a one-liner (batch size ${batchSize})`);
  if (!targets.length) return;

  const [run] = await db.insert(runs).values({ stage: 'one_liners' }).returning();
  const budget = new Budget();
  const counts = { batches: 0, batches_failed: 0, written: 0, abstained: 0, unmatched: 0 };

  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);

    // The headline that surfaced each company. Context for what the company is,
    // not a description of it — the prompt says so, because a model given only
    // a funding headline will otherwise describe the funding.
    const inputs: OneLinerInput[] = [];
    for (const c of batch) {
      const heads: any = await sqlc`
        select i.title from company_signals cs
          join items i on i.id = cs.representative_item_id
         where cs.company_id = ${c.id}
         order by cs.week_of desc limit 2`;
      inputs.push({
        name: String(c.name),
        sectors: Array.isArray(c.sectors) ? (c.sectors as string[]) : [],
        description: c.description ?? null,
        website: c.website ?? null,
        headlines: heads.map((h: any) => String(h.title ?? '')).filter(Boolean),
      });
    }

    counts.batches++;
    console.log(`  batch ${counts.batches}: ${batch.length} companies...`);

    const res = await callJson<{ lines: Array<{ name: string; line: string | null }> }>({
      system: ONE_LINER_SYSTEM,
      user: buildOneLinerPrompt(inputs),
      model: env.groqModelScoring(),
      budget,
      temperature: 0.1,
      schema: LINES_SCHEMA,
    });

    if (!res.ok || !res.data?.lines) {
      counts.batches_failed++;
      console.warn(`    FAILED: ${res.error}`);
      continue;
    }

    for (const r of res.data.lines) {
      // Matched back by name; the model is told to echo it exactly.
      const target = batch.find((c: any) => c.name === r.name)
        ?? batch.find((c: any) => String(c.name).toLowerCase() === String(r.name ?? '').toLowerCase());
      if (!target) { counts.unmatched++; continue; }

      const line = cleanOneLiner(r.line);
      if (!line) {
        // Abstention is the designed answer when the evidence is about another
        // entity. Left null so the card shows nothing rather than a guess.
        counts.abstained++;
        continue;
      }

      console.log(`    ${target.name}: ${line}`);
      counts.written++;
      if (!dry) {
        // Retried: Neon's HTTP endpoint drops a connection under load.
        await withRetry(() =>
          db.update(companies).set({ oneLiner: line }).where(eq(companies.id, target.id)));
      }
    }
  }

  if (!dry) {
    await db.update(runs)
      .set({ finishedAt: new Date(), counts, tokensIn: budget.tokensIn, tokensOut: budget.tokensOut })
      .where(eq(runs.id, run.id));
  }

  console.log(`\n${counts.written} written, ${counts.abstained} abstained (evidence not about the company),`
    + ` ${counts.batches_failed} batches failed, ${counts.unmatched} unmatched`);
  console.log(`tokens: ${budget.tokensIn} in, ${budget.tokensOut} out`);
  if (dry) console.log('(dry run — nothing written)');
})();
