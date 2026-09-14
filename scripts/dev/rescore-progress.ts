/**
 * Where the rescore has got to, and what it is finding.
 *
 * The run writes each batch as its answer lands, so the backlog is always
 * partly done rather than all-or-nothing — this reads that state. Safe to run
 * at any time, including while scoring is in flight.
 *
 * Usage: npx tsx scripts/dev/rescore-progress.ts
 */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';

(async () => {
  const sql = getSql();

  const [{ done = 0, left = 0 } = {}]: any = await sql`
    select
      (select count(*)::int from scores where rubric_version = 'item-v6') as done,
      (select count(*)::int from items i
        where i.status = 'kept'
          and not exists (select 1 from scores s where s.item_id = i.id)) as left`;

  const total = Number(done) + Number(left);
  const pct = total ? (100 * Number(done) / total).toFixed(1) : '0';

  // Rate over the last ten minutes, which is what predicts the finish rather
  // than an average dragged down by the run's slow start.
  const [{ recent = 0 } = {}]: any = await sql`
    select count(*)::int as recent from scores where scored_at > now() - interval '10 minutes'`;
  const perMin = Number(recent) / 10;
  const etaMin = perMin > 0 ? Number(left) / perMin : null;

  console.log(`scored ${done} of ${total}  (${pct}%)`);
  console.log(`left   ${left}`);
  console.log(`rate   ${perMin.toFixed(0)}/min` + (etaMin ? `  eta ~${(etaMin / 60).toFixed(1)}h` : '  (stalled)'));

  console.log('\nlast 30 minutes, by score:');
  console.table(await sql`
    select score, count(*)::int as n
    from scores where scored_at > now() - interval '30 minutes'
    group by 1 order by 1 desc`);

  // What the run is actually surfacing: a 3 is a decision window, and those are
  // the rows the digest is being rebuilt to carry.
  console.log('strongest items found in the last 30 minutes:');
  const top: any = await sql`
    select i.title, s.score, s.signal_type
    from scores s join items i on i.id = s.item_id
    where s.scored_at > now() - interval '30 minutes' and s.score >= 3
    order by s.scored_at desc limit 8`;
  if (!top.length) console.log('  (none at score 3 yet)');
  for (const r of top) console.log(`  [${r.score}] ${String(r.title).slice(0, 74)}  · ${r.signal_type}`);
})();
