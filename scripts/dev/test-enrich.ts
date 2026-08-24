import '../../lib/loadenv';
import { resolveWebsite, candidateDomains } from '../../lib/enrich';
(async () => {
  const names = ['Universal Graphene Products, Inc.', 'Noria Energy, Inc.', 'Standard Cognition, Corp.',
                 'Rapidflare, Inc.', 'iodyne, Inc.', 'Ember LifeSciences, Inc.', 'Spectrum Effect, Inc.'];
  for (const n of names) {
    process.stdout.write(`\n${n}\n  candidates: ${candidateDomains(n).slice(0,4).join(', ')}\n`);
    const r = await resolveWebsite(n);
    if (r) {
      console.log(`  ✓ ${r.domain}  (${r.verifyReason})`);
      console.log(`    title: ${r.title}`);
      console.log(`    desc : ${(r.description ?? '(none)').slice(0,110)}`);
      console.log(`    text : ${r.text.slice(0,150)}...`);
    } else console.log('  ✗ no verified domain');
  }
})();
