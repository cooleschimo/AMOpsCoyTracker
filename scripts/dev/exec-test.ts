import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { classifyExecHire, execHireWeight } from '../../lib/exec-hire';
(async () => {
  const sql = getSql();
  const r: any = await sql`select title, location from job_postings limit 4000`;
  const hits = r.map((x: any) => classifyExecHire(x.title, x.location)).filter(Boolean);
  console.log(`${hits.length} exec expansion hires from ${r.length} postings\n`);
  const ranked = hits.sort((a: any, b: any) => execHireWeight(b) - execHireWeight(a));
  for (const h of ranked.slice(0, 14)) console.log(`  [${String(execHireWeight(h)).padStart(3)}] ${h.title.slice(0,62)}  (${h.location ?? '-'})`);
  console.log('\nrejected examples (senior but not expansion):');
  const rej = r.filter((x: any) => /Head of|Director|VP|Chief/i.test(x.title) && !classifyExecHire(x.title, x.location));
  for (const x of rej.slice(0, 5)) console.log('  -', x.title.slice(0,64));
})();
