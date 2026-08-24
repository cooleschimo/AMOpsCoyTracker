/** Live check of every configured search provider. */
import '../../lib/loadenv';

const PROBE = 'Rapidflare';
(async () => {
  const mod = await import('../../lib/search-providers');
  for (const p of ['serper', 'youcom', 'linkup', 'tavily', 'purili'] as const) {
    process.env.SEARCH_PROVIDER = p;
    const t = Date.now();
    try {
      const hits = await mod.search(PROBE, { maxResults: 5 });
      const ms = Date.now() - t;
      const withRaw = hits.filter((h) => h.raw).length;
      const withDate = hits.filter((h) => h.publishedAt).length;
      console.log(`${p.padEnd(8)} ${String(hits.length).padStart(2)} hits  ${String(ms).padStart(5)}ms  raw:${withRaw} dated:${withDate}  ${hits[0]?.host ?? ''}`);
    } catch (e) {
      console.log(`${p.padEnd(8)} ERROR  ${(e as Error).message.slice(0, 70)}`);
    }
  }
})();
