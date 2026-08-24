import '../../lib/loadenv';
import { extractNames } from '../../lib/portfolio';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
(async () => {
  for (const [ts, u] of [
    ['20211028044257', 'https://edbi.com/portfolio/'],
    ['20180226184945', 'http://www.edbi.com/portfolio-companies/emerging-technology'],
  ] as const) {
    const url = `https://web.archive.org/web/${ts}id_/${u}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    const html = await r.text();
    console.log(`\n=== ${ts} ${u}\n    HTTP ${r.status}, ${Math.round(html.length/1024)}KB`);
    if (r.ok) {
      const ex = extractNames(html);
      console.log(`    [${ex.strategy}] ${ex.names.length} names`);
      console.log('    ' + ex.names.slice(0, 25).join(' | '));
    }
    await new Promise((s) => setTimeout(s, 2000));
  }
})();
