/** Same company, scored with and without context, to see what context does. */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { callJson } from '../../lib/llm';
import { COMPANY_SIGNAL_SYSTEM, buildCompanySignalPrompt, WINDOW_DAYS, type CompanyItem } from '../../lib/company-signal';

(async () => {
  const sql = getSql();
  const [c]: any = await sql`select id, name, sectors from companies where name='Harvey'`;
  const rows: any = await sql`
    select i.id, i.title, i.snippet, i.source, i.source_type, i.published_at,
           (select count(*)::int from items d where d.cluster_id=i.id) cs
    from items i where i.company_id=${c.id} and i.status='kept'
      and coalesce(i.published_at,i.fetched_at) > now() - make_interval(days => ${WINDOW_DAYS})
    order by coalesce(i.published_at,i.fetched_at) desc limit 25`;
  const items: CompanyItem[] = rows.map((r: any) => ({
    itemId: r.id, title: r.title, snippet: r.snippet, source: r.source,
    sourceType: r.source_type, publishedAt: r.published_at ? new Date(r.published_at) : null,
    clusterSize: Number(r.cs) || 1,
  }));
  const ctx: any = await sql`select context_kind, title, source from items
    where source_type='context' and (sectors is null or sectors && ${c.sectors}::text[])
    order by coalesce(published_at,fetched_at) desc limit 10`;

  for (const [label, context] of [['WITHOUT', undefined], ['WITH', ctx.map((x:any)=>({kind:x.context_kind,title:x.title,source:x.source}))]] as const) {
    const r = await callJson<any>({
      system: COMPANY_SIGNAL_SYSTEM,
      user: buildCompanySignalPrompt({ companyName: c.name, sectors: c.sectors ?? [], items, context: context as any }),
      temperature: 0.1,
    });
    if (!r.ok) { console.log(label, 'failed:', r.error); continue; }
    const d = r.data;
    console.log(`\n${label} context: e${d.expansion} m${d.momentum} p${d.partnership}`);
    for (const w of (Array.isArray(d.why) ? d.why : [d.why])) console.log('   -', w);
  }
})();
