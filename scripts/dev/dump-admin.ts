import '../../lib/loadenv';
import { optional } from '../../lib/env';
(async () => {
  const t = optional('ADMIN_TOKEN');
  const res = await fetch(`http://localhost:3111/admin/accounts?token=${encodeURIComponent(t)}`);
  const html = await res.text();
  console.log('status', res.status, '| bytes', html.length);
  const text = html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  console.log('\n', text.slice(0, 700));
})();
