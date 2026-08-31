import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { buildCompanySignalPrompt, WINDOW_DAYS } from '../../lib/company-signal';
import { classifyExecHire } from '../../lib/exec-hire';
(async () => {
  const sql = getSql();
  for (const nm of ['SandboxAQ','Anthropic','Together AI']) {
    const [c]: any = await sql`select id,name,sectors from companies where name=${nm}`;
    if (!c) continue;
    const [snap]: any = await sql`select total_jobs,non_us_jobs,apac_jobs from job_snapshots where company_id=${c.id} order by snapshot_at desc limit 1`;
    const [sg]: any = await sql`select count(*)::int n from job_postings where company_id=${c.id} and location ~* 'singapore'`;
    const ex: any = await sql`select title,location from job_postings where company_id=${c.id} limit 200`;
    const execs = ex.map((j:any)=>classifyExecHire(j.title,j.location)).filter(Boolean).slice(0,4);
    const prompt = buildCompanySignalPrompt({companyName:c.name,sectors:c.sectors??[],items:[],
      hiring: snap ? {total:snap.total_jobs,nonUs:snap.non_us_jobs,apac:snap.apac_jobs,singapore:sg?.n??0,
        execHires:execs.map((e:any)=>`${e.title}${e.location?` (${e.location})`:''}`)} : null});
    const line = prompt.split('\n').find(l=>l.startsWith('HIRING:'));
    console.log(`${nm}: ${line ?? '(no hiring block)'}`);
  }
})();
