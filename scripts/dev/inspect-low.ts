import '../../lib/loadenv';
import { scrapePortfolio } from '../../lib/portfolio';
(async () => {
  for (const [n, u] of [
    ['Prime Movers Lab','https://www.primemoverslab.com/portfolio/'],
    ['Shield Capital','https://shieldcap.com/portfolio/'],
    ['Basis Set','https://www.basisset.com/portfolio'],
  ] as const) {
    const r = await scrapePortfolio(u);
    console.log(`\n${n} [${r.strategy}] ${r.names.length}:`);
    console.log('  ' + r.names.slice(0, 20).join(' | '));
  }
})();
