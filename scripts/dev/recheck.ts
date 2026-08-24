import '../../lib/loadenv';
import { tryDomain } from '../../lib/enrich';
(async () => {
  for (const [d, n] of [['amplifica.com','AMPLIFICA HOLDINGS GROUP, INC.'],['aevos.com','Aevos AI Inc.'],['ensysce.com','Ensysce Biosciences, Inc.']] as const) {
    const r = await tryDomain(d, n);
    console.log(`${d} (${n})\n  verified=${r?.verified}  ${r?.verifyReason}`);
  }
})();
