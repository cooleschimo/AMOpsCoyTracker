/** Verify a merge repoints edges and deletes nothing. */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { recordDecision } from '../../lib/merge-actions';
(async () => {
  const sql = getSql();
  // Brian Scott Fuller at two sibling CAPU funds - almost certainly one person.
  const before = await sql`
    select p.id, p.name, count(r.id)::int as roles from people p
    left join roles r on r.person_id=p.id where p.normalized_name='brian scott fuller'
    group by p.id, p.name order by p.id`;
  console.log('BEFORE:'); console.table(before);
  if (before.length < 2) { console.log('need 2 rows'); return; }

  const r = await recordDecision({
    entityType: 'person', keptId: Number(before[0].id), mergedId: Number(before[1].id),
    decision: 'merged', signals: ['exact_normalized_name'], score: 0.25,
    note: 'test: sibling CAPU funds, same filer', decidedBy: 'test-merge script',
  });
  console.log('repointed:', r.repointed);

  console.log('AFTER (losing row still exists, marked):');
  console.table(await sql`
    select p.id, p.name, count(r.id)::int as roles from people p
    left join roles r on r.person_id=p.id where p.id in (${before[0].id}, ${before[1].id})
    group by p.id, p.name order by p.id`);
  console.log('decision recorded:');
  console.table(await sql`select entity_type, kept_id, merged_id, decision, note from entity_merges`);
})();
