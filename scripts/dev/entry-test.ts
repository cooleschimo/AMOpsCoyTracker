import '../../lib/loadenv';
import { searchFilings, findSingaporeTrials, isFirstAsianSite, ENTRY_PHRASES } from '../../lib/entry-signals';
(async () => {
  const hits = await searchFilings(ENTRY_PHRASES[0], { startDate: '2026-05-01', endDate: '2026-08-26' });
  console.log(`EDGAR full-text "${ENTRY_PHRASES[0]}": ${hits.length} hits`);
  for (const h of hits.slice(0,3)) console.log(`  - ${h.companyName.slice(0,50)} | ${h.formType} ${h.filedAt}`);

  const trials = await findSingaporeTrials(60);
  const first = trials.filter(isFirstAsianSite);
  console.log(`\nSingapore trials: ${trials.length}, of which FIRST Asian site: ${first.length}`);
  for (const t of first.slice(0,5)) console.log(`  - ${t.sponsor.slice(0,42)} | ${t.phase ?? '-'} | ${t.title.slice(0,44)}`);
})();
