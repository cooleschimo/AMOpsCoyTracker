import '../../lib/loadenv';
import { getSql } from '../../lib/db';
(async () => {
  const q = getSql();
  const junkWords = ['offices','office','team','careers','contact','news','blog','about',
    'portfolio','companies','more','all','home','login','search','press','events','people',
    'insights','stories','approach','values','jobs'];
  const rows = await q`
    select id, name from companies where discovered_via='portfolio'
      and lower(name) = any(${junkWords})`;
  console.log(`explicit junk rows: ${rows.length}`);
  console.table(rows);
  const total = await q`select count(*)::int as n from companies where discovered_via='portfolio'`;
  console.log(`total portfolio companies: ${total[0].n}`);
  console.log(`junk rate: ${(rows.length / Number(total[0].n) * 100).toFixed(2)}%`);
})();
