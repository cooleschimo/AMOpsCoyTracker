import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const sql = getSql();
  console.log('=== PEOPLE ===');
  const p: any = await sql`select count(*)::int n from people`;
  const withRole: any = await sql`select count(distinct person_id)::int n from roles`;
  const withAff: any = await sql`select count(distinct person_id)::int n from affiliations`;
  console.log('people:', p[0].n, '| with a role:', withRole[0].n, '| with a fund affiliation:', withAff[0].n);
  const cols: any = await sql`select column_name from information_schema.columns where table_name='people' order by ordinal_position`;
  console.log('people columns:', cols.map((c:any)=>c.column_name).join(', '));

  console.log('\n=== ORGANIZATIONS ===');
  const o: any = await sql`select count(*)::int n from organizations`;
  const ocols: any = await sql`select column_name from information_schema.columns where table_name='organizations' order by ordinal_position`;
  console.log('organizations:', o[0].n);
  console.log('columns:', ocols.map((c:any)=>c.column_name).join(', '));
  const inv: any = await sql`select count(*)::int n, count(distinct org_id)::int orgs from investments`;
  console.log('investments:', inv[0].n, 'across', inv[0].orgs, 'orgs');
  const top: any = await sql`select o.name, count(*)::int n from investments i join organizations o on o.id=i.org_id group by 1 order by n desc limit 5`;
  console.log('top funds by portfolio size:'); for (const x of top) console.log('   ', x.name, x.n);
})();
