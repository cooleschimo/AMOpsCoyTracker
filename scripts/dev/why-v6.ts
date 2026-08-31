import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { callJson } from '../../lib/llm';
import { COMPANY_SIGNAL_SYSTEM, buildCompanySignalPrompt, WINDOW_DAYS, type CompanyItem } from '../../lib/company-signal';
import { candidateProps } from '../../lib/proposition';
(async () => {
  const sql = getSql();
  for (const nm of ['SandboxAQ','Glean']) {
    const [c]: any = await sql`select id,name,sectors from companies where name=${nm}`;
    if (!c) continue;
    const rows: any = await sql`select i.id,i.title,i.snippet,i.source,i.source_type,i.published_at,
        (select count(*)::int from items d where d.cluster_id=i.id) cs
      from items i where i.company_id=${c.id} and i.status='kept'
        and coalesce(i.published_at,i.fetched_at) > now() - make_interval(days => ${WINDOW_DAYS})
      order by coalesce(i.published_at,i.fetched_at) desc limit 25`;
    const items: CompanyItem[] = rows.map((r:any)=>({itemId:r.id,title:r.title,snippet:r.snippet,source:r.source,
      sourceType:r.source_type,publishedAt:r.published_at?new Date(r.published_at):null,clusterSize:Number(r.cs)||1}));
    const r = await callJson<any>({system:COMPANY_SIGNAL_SYSTEM,
      user:buildCompanySignalPrompt({companyName:c.name,sectors:c.sectors??[],items,
        capabilities:candidateProps(c.sectors??[]).map(v=>({id:v.id,title:v.title,status:v.status,fits:v.fits.slice(0,3).join('; ')}))}),
      temperature:0.1});
    if(!r.ok){console.log(nm,'failed');continue;}
    console.log(`\n${nm}: e${r.data.expansion} m${r.data.momentum} p${r.data.partnership}`);
    for(const w of (Array.isArray(r.data.why)?r.data.why:[r.data.why])) console.log('   -',w);
  }
})();
