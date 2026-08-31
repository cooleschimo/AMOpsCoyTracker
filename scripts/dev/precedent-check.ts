import '../../lib/loadenv';
import { findPrecedent } from '../../lib/proposition';
import { activeProvider } from '../../lib/search-providers';
(async () => {
  console.log('provider:', JSON.stringify(activeProvider()));
  const hits = await findPrecedent(['deeptech','ai'], 'semiconductor design and advanced packaging');
  console.log('hits:', hits.length);
  for (const h of hits) console.log(' -', h.title.slice(0,80), '\n   ', h.url.slice(0,90));
})();
