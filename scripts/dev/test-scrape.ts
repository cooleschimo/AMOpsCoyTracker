import '../../lib/loadenv';
import { scrapePortfolio } from '../../lib/portfolio';
import { FUNDS } from '../../lib/funds';
(async () => {
  for (const f of FUNDS.filter((x) => x.scrape).slice(8, 14)) {
    const r = await scrapePortfolio(f.portfolioUrl);
    console.log(`\n${f.name}  [${r.strategy}]  ${r.names.length} names, ${r.rejected} rejected${r.error ? ' · ' + r.error : ''}`);
    console.log('  ' + r.names.slice(0, 12).join(' | '));
  }
})();
