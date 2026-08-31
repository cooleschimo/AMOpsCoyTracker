import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r: any = await sql`
    select c.name, cs.expansion, cs.momentum, cs.partnership, cs.signal_type, cs.why, cs.items_considered,
           i.title as rep_title, i.source_type as rep_type
    from company_signals cs join companies c on c.id=cs.company_id
    left join items i on i.id=cs.representative_item_id
    order by cs.partnership desc, cs.expansion desc`;
  for (const x of r) {
    console.log(`\n${x.name} — expansion ${x.expansion} · momentum ${x.momentum} · partnership ${x.partnership} · ${x.signal_type} · ${x.items_considered} items`);
    for (const p of String(x.why).split(' · ')) console.log(`   - ${p}`);
    console.log(`   lead: ${x.rep_title ? x.rep_title.slice(0,80) : '(none)'} [${x.rep_type ?? '-'}]`);
  }
})();
