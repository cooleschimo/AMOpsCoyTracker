import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  const q = async (label: string, s: any) => { const r: any = await s; console.log(label.padEnd(46), r[0].n); };
  await q('companies with a live signal:', sql`select count(*)::int n from company_signals where signal_version='signal-v5' and (expansion>=2 or partnership>=2)`);
  await q('  ...with no investors recorded:', sql`select count(*)::int n from company_signals cs where cs.signal_version='signal-v5' and (cs.expansion>=2 or cs.partnership>=2) and not exists (select 1 from investments i where i.company_id=cs.company_id)`);
  await q('  ...with no people:', sql`select count(*)::int n from company_signals cs where cs.signal_version='signal-v5' and (cs.expansion>=2 or cs.partnership>=2) and not exists (select 1 from roles r where r.company_id=cs.company_id)`);
  await q('  ...with no total_raised:', sql`select count(*)::int n from company_signals cs join companies c on c.id=cs.company_id where cs.signal_version='signal-v5' and (cs.expansion>=2 or cs.partnership>=2) and c.total_raised is null`);
  await q('  ...with no headcount:', sql`select count(*)::int n from company_signals cs join companies c on c.id=cs.company_id where cs.signal_version='signal-v5' and (cs.expansion>=2 or cs.partnership>=2) and c.headcount_est is null`);
  await q('orgs with no fund size:', sql`select count(*)::int n from organizations where fund_size_usd_m is null`);
  await q('orgs with any people:', sql`select count(distinct org_id)::int n from affiliations`);
})();
