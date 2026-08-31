import '../../lib/loadenv';
import { optional } from '../../lib/env';
import { writeFileSync } from 'node:fs';
(async () => {
  const t = optional('DASHBOARD_TOKEN');
  const path = process.argv[2] ?? '/item/2361';
  const res = await fetch(`http://localhost:3111${path}?token=${encodeURIComponent(t)}`);
  const html = await res.text();
  console.log('status', res.status, '| bytes', html.length);
  const text = html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  console.log('\nVISIBLE TEXT (first 900 chars):\n', text.slice(0,900));
  writeFileSync('/tmp/page.html', html);
})();
