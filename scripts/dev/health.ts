/**
 * Whether the pipeline is actually working. Brief §2a.
 *
 * Exit 0 when healthy, 1 when not, so cron or a workflow step can act on it
 * rather than a person having to notice. Everything it checks is a way work has
 * silently stopped here, not a hypothetical:
 *
 *   - a run row that opened and never closed. Four score_companies rows sat
 *     open between three and six DAYS, because a killed process cannot write
 *     its own finish. The process table forgets; this does not.
 *   - a stage that has not run at all today. Ten were skipped in one evening
 *     because a chained job died before reaching them, and nothing said so.
 *   - a queue that is not draining. A stage can exit 0 having done nothing,
 *     which reads as success and leaves the backlog where it was.
 *   - no LLM capacity left. Not a fault in itself, but it explains the three
 *     above and should be said plainly rather than inferred.
 *
 * Usage: npx tsx scripts/dev/health.ts [--daily] [--quiet]
 */
process.env.DOTENV_CONFIG_QUIET = 'true';
import { appendFileSync } from 'node:fs';
import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { STAGES } from '../../lib/stages';
import { spentToday, rejectedKeys } from '../../lib/budget-store';
import { llmProviders } from '../../lib/env';
import { worst, type Verdict, type VerdictReason } from '../../lib/run-verdict';

/** Longer than the longest stage budget, so a slow run is not called dead. */
const STRANDED_MIN = 120;

type Problem = { severity: 'error' | 'warn'; what: string; verdict?: Verdict; code?: string };

(async () => {
  const sql = getSql();
  const daily = process.argv.includes('--daily');
  const quiet = process.argv.includes('--quiet');
  const problems: Problem[] = [];

  const [stranded, finishedToday, [queue], [toScore], [toAssess], spent, rejected, deadSources] = await Promise.all([
    sql`select id, stage, round(extract(epoch from (now() - started_at)) / 60) as age
        from runs where finished_at is null
          and started_at < now() - make_interval(mins => ${STRANDED_MIN})
        order by started_at`,
    sql`select distinct stage from runs
        where finished_at is not null and error is null
          and started_at > now() - interval '20 hours'`,
    sql`select count(*)::int c from items where status = 'fetched'`,
    sql`select count(distinct c.id)::int c from companies c
        join items i on i.company_id = c.id and i.status = 'kept'
        where coalesce(i.published_at, i.fetched_at) > now() - interval '30 days'
          and not exists (select 1 from company_signals cs
            where cs.company_id = c.id
              and cs.week_of = (select max(week_of) from company_signals))`,
    sql`select count(*)::int c from companies c
        where coalesce(c.scope_status, 'unknown') <> 'out_of_scope'
          and exists (select 1 from company_signals s
            where s.company_id = c.id and s.week_of > current_date - 60)
          and not exists (select 1 from company_assessments a
            where a.company_id = c.id
              and a.rubric_version = (select rubric_version from company_assessments
                                      order by assessed_at desc limit 1))`,
    spentToday(),
    rejectedKeys(),
    sql`select source, status, note from source_health
        where status = 'down' and last_success_at < now() - interval '3 days'
        order by last_success_at asc nulls first`,
  ]) as any;

  /*
   * A row that opened and never closed. Left alone these accumulate silently
   * and make every later "is it running" answer wrong.
   */
  for (const r of stranded as any[]) {
    problems.push({
      severity: 'error',
      verdict: 'broken',
      code: 'stranded-run',
      what: `run #${r.id} (${r.stage}) has been open ${r.age}m — the process is gone`,
    });
  }

  /*
   * A rejected key is not a spent one and does not come back on its own.
   *
   * Reported above the allowance check because it outranks it: a night where
   * the caps were spent resolves itself at midnight, and a night where a
   * credential was refused is the same night again tomorrow until someone
   * replaces the key. DEBUGGING.md §2b used to send you to models.ts to tell
   * these apart by hand; lib/llm.ts already knows, and now says so.
   */
  for (const [provider, reason] of rejected as Array<[string, string]>) {
    problems.push({
      severity: 'error',
      verdict: 'credential',
      code: 'credential-rejected',
      what: `${provider}: credential rejected, not spent — ${reason.slice(0, 80)}`,
    });
  }

  /*
   * A feed that has not answered for three days has changed shape or gone, and
   * the fix is a URL in lib/news-sources.ts rather than anything about tonight.
   * Warn, not error: the run around it worked.
   */
  for (const r of deadSources as any[]) {
    problems.push({
      severity: 'warn',
      verdict: 'broken',
      code: 'source-down',
      what: `source ${r.source} has been down for days — ${String(r.note ?? 'no successful fetch').slice(0, 60)}`,
    });
  }

  const live = llmProviders().length - (spent as any[]).length;

  const done = new Set((finishedToday as any[]).map((r) => String(r.stage)));
  const wanted = daily ? STAGES.filter((s) => !s.weeklyOnly) : STAGES;
  const missing = wanted.filter((s) => !done.has(s.runStage)).map((s) => s.name);
  if (missing.length) {
    /*
     * Counting the missing stages says how much did not happen, not whether
     * anything is broken. A run that spends its allowance and skips the rest
     * leaves twelve stages missing and is working as designed — the backlog is
     * capped per stage and the next run picks it up. Calling that an error
     * turns the schedule red every morning for a quota that resets on its own,
     * and a red that means nothing is a red nobody reads.
     *
     * So the count decides the severity only while there is allowance left to
     * have used. With none, the missing stages are the symptom and the spent
     * chain below is the cause.
     *
     * Excused and unexcused are reported separately rather than together. An
     * all-or-nothing test made one failed fetch stage disqualify the whole
     * night: twelve stages skipped for a spent chain, correctly, plus `news`
     * timing out, and every one of the thirteen was reported as an error
     * because they were not all LLM stages. The fetch stage is the finding;
     * the twelve are still working as designed.
     */
    const missingStages = wanted.filter((s) => missing.includes(s.name));
    const excusedStages = live === 0 ? missingStages.filter((s) => s.cost === 'llm') : [];
    const unexcused = missingStages.filter((s) => !excusedStages.includes(s));

    if (excusedStages.length) {
      problems.push({
        severity: 'warn',
        verdict: 'partial',
        code: 'allowance-exhausted',
        what: `${excusedStages.length} LLM stage${excusedStages.length === 1 ? '' : 's'} skipped: `
          + `${excusedStages.map((s) => s.name).join(', ')} — every key was spent before the run started`,
      });
    }
    if (unexcused.length) {
      problems.push({
        severity: unexcused.length > 3 ? 'error' : 'warn',
        verdict: 'broken',
        code: 'stages-missing',
        what: `${unexcused.length} stage${unexcused.length === 1 ? '' : 's'} have not run today: `
          + unexcused.map((s) => s.name).join(', '),
      });
    }
  }

  if (queue.c > 0) {
    problems.push({
      severity: 'warn',
      verdict: 'partial',
      code: 'queue-unjudged',
      what: `${queue.c.toLocaleString()} items are unjudged — scoring cannot see them until the filter runs`,
    });
  }

  if (live === 0) {
    problems.push({
      severity: 'warn',
      verdict: 'partial',
      code: 'allowance-exhausted',
      what: 'every LLM key is spent — nothing that needs a model will progress until the caps reset',
    });
  }

  if (!quiet) {
    console.log(`  stages run today   ${wanted.length - missing.length}/${wanted.length}`);
    console.log(`  unjudged items     ${queue.c}`);
    console.log(`  to score / assess  ${toScore.c} / ${toAssess.c}`);
    console.log(`  live LLM keys      ${live}/${llmProviders().length}`);
  }

  /*
   * The verdict, for whatever acts on it.
   *
   * Exit stays 0 or 1, because that is what a workflow step reads and what
   * decides whether the morning shows red: `partial` is deliberately green.
   * The category rides alongside as a step output so the workflow and the
   * digest can branch on a slug instead of matching this prose.
   */
  const found: VerdictReason[] = problems
    .filter((p) => p.verdict)
    .map((p) => ({
      verdict: p.verdict!,
      what: p.what,
      code: p.code ?? p.verdict!,
      exit: p.severity === 'error' ? 1 : 0,
    }));
  const decided = worst(found);
  const exit = problems.some((p) => p.severity === 'error') ? 1 : 0;

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT,
      `verdict=${decided.verdict}\ncode=${decided.code}\nreason=${decided.what.replace(/\n/g, ' ')}\n`);
  }

  if (!problems.length) {
    console.log('  healthy');
    console.log(`\n  verdict: ${decided.verdict} (${decided.code})`);
    return;
  }
  console.log('');
  for (const p of problems) console.log(`  ${p.severity === 'error' ? 'ERROR' : 'warn '}  ${p.what}`);
  console.log(`\n  verdict: ${decided.verdict} (${decided.code})`);
  process.exit(exit);
})();
