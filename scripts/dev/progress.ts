/**
 * What the pipeline is doing right now, in one line per stage.
 *
 * A process list names the stage and nothing else, which answers "is it alive"
 * and not "is it getting anywhere". Every stage leaves a countable trace as it
 * works — scores rows, signals, assessments, items leaving the queue — so this
 * reads those and shows the delta since the run started.
 *
 * Usage: npx tsx scripts/dev/progress.ts [--watch]
 */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { COMPANY_SIGNAL_VERSION, WINDOW_DAYS } from '../../lib/company-signal';
import { COMPANY_RUBRIC_VERSION } from '../../lib/company-rubric';
import { weekOfSaturday } from '../../lib/week';

const pad = (s: unknown, n: number) => String(s).padEnd(n);
const num = (n: number) => n.toLocaleString().padStart(7);

async function snapshot() {
  const sql = getSql();
  const wk = weekOfSaturday();

  const [[queue], [scored5], [sig], [target], [assessed], [toAssess], [live]]: any = await Promise.all([
    sql`select count(*)::int c from items where status = 'fetched'`,
    sql`select count(*)::int c from scores where scored_at > now() - interval '5 minutes'`,
    sql`select count(*)::int c from company_signals
        where signal_version = ${COMPANY_SIGNAL_VERSION} and week_of = ${wk}::date`,
    sql`select count(distinct c.id)::int c from companies c
        join items i on i.company_id = c.id and i.status = 'kept'
        where coalesce(i.published_at, i.fetched_at) > now() - make_interval(days => ${WINDOW_DAYS})
          and not exists (select 1 from company_signals cs
            where cs.company_id = c.id and cs.week_of = ${wk}::date
              and cs.signal_version = ${COMPANY_SIGNAL_VERSION})`,
    sql`select count(*)::int c from company_assessments
        where rubric_version = ${COMPANY_RUBRIC_VERSION}
          and assessed_at > now() - interval '30 minutes'`,
    sql`select count(*)::int c from companies c
        where coalesce(c.scope_status, 'unknown') <> 'out_of_scope'
          and exists (select 1 from company_signals s
            where s.company_id = c.id and s.week_of > current_date - 60)
          and not exists (select 1 from company_assessments a
            where a.company_id = c.id and a.rubric_version = ${COMPANY_RUBRIC_VERSION})`,
    sql`select stage, to_char(started_at, 'HH24:MI') t from runs
        where finished_at is null and started_at > now() - interval '6 hours'
        order by started_at desc limit 4`,
  ]);

  const running: any = await sql`select stage, to_char(started_at,'HH24:MI') t from runs
    where finished_at is null and started_at > now() - interval '6 hours' order by started_at desc limit 4`;

  console.log(`\n  ${new Date().toTimeString().slice(0, 8)}   week of ${wk}`);
  console.log(`  ${pad('filter queue', 22)}${num(queue.c)}   items still unjudged`);
  console.log(`  ${pad('  …scoring items', 22)}${num(scored5.c)}   in the last 5 min`);
  console.log(`  ${pad('signals this week', 22)}${num(sig.c)}   companies judged`);
  console.log(`  ${pad('  …still to score', 22)}${num(target.c)}`);
  console.log(`  ${pad('assessed', 22)}${num(assessed.c)}   in the last 30 min`);
  console.log(`  ${pad('  …still to assess', 22)}${num(toAssess.c)}`);
  if (running.length) {
    console.log(`  running: ${running.map((r: any) => `${r.stage} (from ${r.t})`).join(', ')}`);
  } else {
    console.log('  running: nothing');
  }
}

(async () => {
  if (!process.argv.includes('--watch')) { await snapshot(); return; }
  for (;;) { await snapshot(); await new Promise((r) => setTimeout(r, 30_000)); }
})();
