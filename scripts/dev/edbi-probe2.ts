import '../../lib/loadenv';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

(async () => {
  // Ask CDX for the main portfolio listing page across all time.
  for (const pattern of ['edbi.com/portfolio*', 'edbi.com/our-portfolio*', 'www.edbi.com/portfolio*']) {
    const cdx = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(pattern)}&output=json&limit=20&filter=statuscode:200&collapse=urlkey&fl=timestamp,original`;
    const r = await fetch(cdx, { headers: { 'User-Agent': UA } });
    const txt = await r.text();
    console.log(`\n=== ${pattern} ===`);
    try {
      const rows = JSON.parse(txt).slice(1);
      rows.slice(0, 8).forEach((x: string[]) => console.log(' ', x[0], x[1]));
      if (!rows.length) console.log('  (none)');
    } catch { console.log('  parse fail:', txt.slice(0, 120)); }
    await new Promise((s) => setTimeout(s, 1500));
  }
})();
