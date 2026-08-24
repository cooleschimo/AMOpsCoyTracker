/**
 * Verify every portfolioUrl in lib/funds.ts, and check robots.txt.
 *
 * The URLs in funds.ts are best-effort from memory, and a 404 or an empty parse
 * is a source-health event there. Running this before any scraping turns those
 * failures into a known list rather than a guess.
 *
 * Usage: npx tsx scripts/check-fund-urls.ts
 */
import '../lib/loadenv';
import { FUNDS } from '../lib/funds';

const UA = 'Mozilla/5.0 (compatible; AMOpsCoyTracker/1.0; research)';

async function robotsAllows(url: string): Promise<{ allowed: boolean; note: string }> {
  try {
    const u = new URL(url);
    const res = await fetch(`${u.origin}/robots.txt`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { allowed: true, note: 'no robots.txt' };
    const txt = (await res.text()).slice(0, 20000);

    // Parse the '*' group only; that is the group that applies to us.
    const lines = txt.split('\n').map((l) => l.replace(/#.*$/, '').trim());
    let inStar = false;
    const disallows: string[] = [];
    for (const l of lines) {
      const m = l.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
      if (!m) continue;
      const [, k, v] = m;
      if (k.toLowerCase() === 'user-agent') inStar = v.trim() === '*';
      else if (inStar && k.toLowerCase() === 'disallow' && v.trim()) disallows.push(v.trim());
    }
    const path = u.pathname || '/';
    const blocked = disallows.find((d) => d === '/' || path.startsWith(d));
    return blocked
      ? { allowed: false, note: `robots.txt disallows "${blocked}"` }
      : { allowed: true, note: 'robots.txt allows' };
  } catch {
    return { allowed: true, note: 'robots.txt unreachable' };
  }
}

(async () => {
  const results: Array<Record<string, string>> = [];
  for (const f of FUNDS) {
    if (!f.scrape) { results.push({ fund: f.name, status: 'skipped', note: 'scrape:false in funds.ts' }); continue; }
    const rb = await robotsAllows(f.portfolioUrl);
    let status = '', note = rb.note;
    try {
      const res = await fetch(f.portfolioUrl, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        redirect: 'follow', signal: AbortSignal.timeout(15000),
      });
      const html = res.ok ? await res.text() : '';
      const links = (html.match(/<a\s[^>]*href=/gi) ?? []).length;
      status = res.ok ? `${res.status}` : `${res.status} FAIL`;
      if (res.ok) {
        note += ` · ${Math.round(html.length / 1024)}KB, ${links} links`;
        if (html.length < 5000) note += ' · TINY (likely JS-rendered)';
      }
      if (res.url !== f.portfolioUrl) note += ` · redirected -> ${res.url}`;
    } catch (e) {
      status = 'ERROR';
      note += ` · ${(e as Error).message.slice(0, 50)}`;
    }
    if (!rb.allowed) status = 'BLOCKED';
    results.push({ fund: f.name, tier: f.tier, sg: f.sgLinked ? 'yes' : '', status, note });
    await new Promise((r) => setTimeout(r, 300));
  }
  console.table(results);
  const ok = results.filter((r) => r.status === '200').length;
  console.log(`\n${ok}/${results.length} reachable. funds.ts predicted ~70% scrapable.`);
})();
