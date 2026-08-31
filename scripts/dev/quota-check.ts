import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { providerStatus, searchRequestsUsed } from '../../lib/search-providers';
(async () => {
  const sql = getSql();
  const p: any = await sql`select count(*)::int n from people`;
  const withRole: any = await sql`select count(distinct person_id)::int n from roles`;
  // People attached to companies that actually surface — the ones worth enriching.
  const relevant: any = await sql`
    select count(distinct r.person_id)::int n
    from roles r join company_signals cs on cs.company_id = r.company_id
    where cs.expansion >= 2 or cs.partnership >= 2`;
  console.log('all people:', p[0].n);
  console.log('people with a known role:', withRole[0].n);
  console.log('people at companies with a live signal:', relevant[0].n);
  console.log('\nsearch providers:');
  for (const s of providerStatus()) console.log(`  ${s.provider.padEnd(10)} ${s.usable ? 'usable' : 'no key'}  ${s.note}`);
})();
