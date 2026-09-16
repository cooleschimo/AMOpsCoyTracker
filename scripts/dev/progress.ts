/**
 * What the pipeline is doing, stage by stage.
 *
 * A process list answers "is it alive" and never "is it getting anywhere", and
 * a three-queue summary answers neither for the fourteen stages that are not
 * filter, score or assess — a run spent an hour in `websites` while this said
 * "running: nothing", because nothing it looked at had moved.
 *
 * So it walks the whole stage list and pairs each one with its most recent run,
 * which means a stage that has never run shows as waiting rather than going
 * missing. The queues stay, underneath, because they are what says whether the
 * work landed rather than merely happened.
 *
 * Usage: npx tsx scripts/dev/progress.ts [--watch] [--daily]
 */
process.env.DOTENV_CONFIG_QUIET = 'true';
import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { STAGES } from '../../lib/stages';
import { COMPANY_SIGNAL_VERSION, WINDOW_DAYS } from '../../lib/company-signal';
import { COMPANY_RUBRIC_VERSION } from '../../lib/company-rubric';
import { weekOfSaturday } from '../../lib/week';

const num = (n: number) => n.toLocaleString().padStart(7);

/** The few counts that say what a stage achieved, out of a blob of twenty. */
function gist(counts: Record<string, unknown> | null): string {
  if (!counts) return '';
  const keys = ['inserted', 'survived_filters', 'scored', 'assessed', 'created',
    'classified', 'located', 'restored', 'written', 'dropped_items', 'resolved',
    'jobs_seen', 'found', 'considered'];
  return keys
    .filter((k) => typeof counts[k] === 'number' && (counts[k] as number) > 0)
    .slice(0, 2)
    .map((k) => `${(counts[k] as number).toLocaleString()} ${k.replace(/_/g, ' ')}`)
    .join(', ');
}

async function snapshot(daily: boolean) {
  const sql = getSql();
  const wk = weekOfSaturday();

  const [latest, [queue], [scored5], [toScore], [toAssess]]: any = await Promise.all([
    // One row per stage, the newest. A run that never closed still shows here,
    // which is the point: a dead stage should look different from an absent one.
    sql`select distinct on (stage) stage, started_at, finished_at, counts, error,
               round(extract(epoch from (coalesce(finished_at, now()) - started_at)) / 60) as mins
        from runs where started_at > now() - interval '24 hours'
        order by stage, started_at desc`,
    sql`select count(*)::int c from items where status = 'fetched'`,
    sql`select count(*)::int c from scores where scored_at > now() - interval '5 minutes'`,
    sql`select count(distinct c.id)::int c from companies c
        join items i on i.company_id = c.id and i.status = 'kept'
        where coalesce(i.published_at, i.fetched_at) > now() - make_interval(days => ${WINDOW_DAYS})
          and not exists (select 1 from company_signals cs
            where cs.company_id = c.id and cs.week_of = ${wk}::date
              and cs.signal_version = ${COMPANY_SIGNAL_VERSION})`,
    sql`select count(*)::int c from companies c
        where coalesce(c.scope_status, 'unknown') <> 'out_of_scope'
          and exists (select 1 from company_signals s
            where s.company_id = c.id and s.week_of > current_date - 60)
          and not exists (select 1 from company_assessments a
            where a.company_id = c.id and a.rubric_version = ${COMPANY_RUBRIC_VERSION})`,
  ]);

  const byStage = new Map((latest as any[]).map((r) => [String(r.stage), r]));
  const stages = daily ? STAGES.filter((s) => !s.weeklyOnly) : STAGES;

  console.log(`\n  ${new Date().toTimeString().slice(0, 8)}   week of ${wk}`);
  let phase = '';
  for (const st of stages) {
    if (st.phase !== phase) { phase = st.phase; console.log(`  ${phase.toUpperCase()}`); }
    const r = byStage.get(st.runStage);
    const mark = !r ? '·' : !r.finished_at ? '>' : r.error ? 'x' : '+';
    const when = !r ? 'not today'
      : !r.finished_at ? `RUNNING ${r.mins}m`
        : `${r.mins}m`;
    const note = r?.error ? String(r.error).slice(0, 44) : gist(r?.counts ?? null);
    console.log(`    ${mark} ${st.name.padEnd(17)}${when.padEnd(14)}${note}`);
  }

  console.log('  QUEUES');
  console.log(`    unjudged items   ${num(queue.c)}`);
  console.log(`    to score         ${num(toScore.c)}`);
  console.log(`    to assess        ${num(toAssess.c)}`);
  console.log(`    items scored     ${num(scored5.c)}   in the last 5 min`);
}

(async () => {
  const daily = process.argv.includes('--daily');
  if (!process.argv.includes('--watch')) { await snapshot(daily); return; }
  for (;;) { await snapshot(daily); await new Promise((r) => setTimeout(r, 30_000)); }
})();
