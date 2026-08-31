/**
 * Smoke-test the dashboard pages against a running dev server.
 * Run: npx next dev -p 3111  then  npx tsx scripts/dev/smoke-pages.ts
 *
 * Checks that each page returns 200 and contains the honesty language the
 * design requires — an unreviewed path must never read as a warm introduction,
 * and a Form D amount must never read as total raised.
 */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { optional } from '../../lib/env';

const BASE = optional('SMOKE_BASE', 'http://localhost:3111');

(async () => {
  const sql = getSql();
  const token = optional('DASHBOARD_TOKEN');
  const item: any = await sql`select item_id from scores where score = 3 order by item_id limit 1`;
  const co: any = await sql`select company_id from items where company_id is not null
                            and status = 'kept' order by id limit 1`;

  const targets: Array<[string, string[]]> = [
    [`/item/${item[0].item_id}`, ['Your call', 'Take forward', 'anonymous']],
    [`/company/${co[0].company_id}`, ['Possible paths', 'not confirmed introductions']],
  ];

  let failed = 0;
  for (const [path, mustContain] of targets) {
    const url = `${BASE}${path}?token=${encodeURIComponent(token)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      const html = await res.text();
      const missing = mustContain.filter((m) => !html.includes(m));
      const ok = res.ok && !missing.length;
      if (!ok) failed++;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${path} -> ${res.status} (${(html.length / 1024).toFixed(1)} KB)`);
      if (missing.length) console.log(`     missing: ${missing.join(' | ')}`);
      if (!res.ok) console.log(`     ${html.slice(0, 300).replace(/\s+/g, ' ')}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${path} -> ${(e as Error).message}`);
    }
  }
  console.log(failed ? `\n${failed} failed` : '\nall pages OK');
})();
