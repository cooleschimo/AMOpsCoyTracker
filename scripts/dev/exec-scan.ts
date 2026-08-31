import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const r: any = await sql`select title, location, company_id from job_postings
    where title ~* '(VP|Vice President|Head of|GM|General Manager|Chief|Director).*(International|APAC|Asia|Global|Regional|Expansion|Supply Chain|Country)'
       or title ~* '(International|APAC|Asia|Regional|Country).*(VP|Vice President|Head|GM|General Manager|Chief|Director|Lead)'
    limit 20`;
  console.log('exec-shaped titles in job_postings:', r.length);
  for (const x of r) console.log(`  ${x.title.slice(0,72)}  [${x.location ?? '-'}]`);
})();
