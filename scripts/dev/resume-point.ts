/**
 * Where a cut-off run should pick up. Brief §2a.
 *
 * A hosted job is killed at six hours and the stages that overrun are always
 * the same three, so after a timeout the only question is which stage to
 * restart from. This answers it by reading run history rather than by guessing:
 * the first stage in pipeline order with no run that finished cleanly today.
 *
 * Prints the stage name and nothing else, so a workflow step can use it
 * directly. Prints nothing when every stage finished, which the caller should
 * read as "no resume needed" rather than as an error.
 *
 * Usage: npx tsx scripts/dev/resume-point.ts
 */
/*
 * The env loader prints a banner, and this script exists to emit one word a
 * workflow will read. Quiet it before loading rather than filtering after.
 */
process.env.DOTENV_CONFIG_QUIET = 'true';
import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { STAGES } from '../../lib/stages';

(async () => {
  const sql = getSql();
  const daily = process.argv.includes('--daily');

  /*
   * Today's clean finishes, by the name the SCRIPT writes — `filter` records
   * `filter_score`, `websites` records `enrich_web` — which is why every stage
   * carries runStage rather than this matching on a prefix.
   */
  /*
   * Back to the start of the run being resumed, not a guess at "today".
   *
   * Twelve hours is shorter than the gap a resume chain can open up: a 22:00
   * run deadlines at 02:50, and a depth-2 resume dispatched hours later looked
   * back past its own early stages, found nothing finished, and returned the
   * FIRST stage — restarting a night that was most of the way done and
   * spending the new day's allowance re-running work that had succeeded.
   *
   * Eighteen hours covers a full run plus its resumes and still stops short of
   * the next cron, so yesterday's stages can never be mistaken for tonight's.
   */
  const rows: any = await sql`
    select distinct stage from runs
    where finished_at is not null and error is null
      and started_at > now() - interval '18 hours'`;
  const finished = new Set(rows.map((r: any) => String(r.stage)));

  const stages = daily ? STAGES.filter((s) => !s.weeklyOnly) : STAGES;
  const next = stages.find((s) => !finished.has(s.runStage));

  if (next) process.stdout.write(next.name);
})();
