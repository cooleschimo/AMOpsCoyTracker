/** Live EDGAR parser check. Run: npx tsx scripts/dev/test-edgar.ts */
import '../../lib/loadenv';
process.env.SEC_USER_AGENT ||= 'AMOpsCoyTracker research chimin.liu777@gmail.com';
import { fetchDailyIndex, fetchFiling } from '../../lib/edgar';

(async () => {
  for (let back = 1; back <= 5; back++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - back);
    const idx = await fetchDailyIndex(d);
    console.log(`${d.toISOString().slice(0, 10)}: ${idx.length} Form D entries`);
    if (!idx.length) continue;
    console.log(idx.slice(0, 3).map((e) => `  ${e.companyName} | CIK ${e.cik} | ${e.accession}`).join('\n'));
    const withPeople = [];
    for (const e of idx.slice(0, 6)) {
      const f = await fetchFiling(e.cik, e.accession);
      if (f) withPeople.push(f);
    }
    console.log('\n--- sample parsed filings ---');
    for (const f of withPeople.slice(0, 3)) {
      console.log(`\n${f.entityName} (${f.stateOrCountry}) ${f.formType} filed ${f.filedAt}`);
      console.log(`  security=${f.securityType} sold=${f.totalAmountSold} offering=${f.totalOfferingAmount}`);
      console.log(`  people: ${f.relatedPersons.map((p) => `${p.name} [${p.relationships.join('/')}]`).join(', ')}`);
      console.log(`  ${f.url}`);
    }
    break;
  }
})();
