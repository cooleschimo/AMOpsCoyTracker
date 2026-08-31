import '../../lib/loadenv';
import { fetchGreenhouse, isNonUsLocation, isApacLocation, APAC_TITLE_RE } from '../../lib/ats';
import { summarisePostings, buildHiringTitle, buildHiringSnippet, type PostingLite } from '../../lib/job-signal';
(async () => {
  for (const [slug,name] of [['databricks','Databricks'],['anthropic','Anthropic']]) {
    const r = await fetchGreenhouse(slug); if (!r.ok) continue;
    const lite: PostingLite[] = r.jobs.map(j=>({title:j.title,location:j.location,department:j.department,content:j.content,
      isNonUs:isNonUsLocation(j.location), isApac:isApacLocation(j.location)||APAC_TITLE_RE.test(j.title), url:j.url}));
    const p = summarisePostings(lite);
    console.log('\n' + buildHiringTitle(name,p));
    if (p.execHires.length) console.log('  exec:', p.execHires.map(e=>e.title).join(' | ').slice(0,110));
  }
})();
