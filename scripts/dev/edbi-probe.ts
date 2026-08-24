import '../../lib/loadenv';
(async () => {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
  const target = 'https://edbi.com/?post_type=portfolios&p=10210';
  const url = `https://web.archive.org/web/20240414003449/${target}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  const html = await res.text();
  console.log('HTTP', res.status, 'size', html.length);
  const title = html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim();
  console.log('TITLE:', title);
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1];
  console.log('OG:TITLE:', og);
  const h1 = html.match(/<h1[^>]*>([\s\S]{0,120}?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g,'').trim();
  console.log('H1:', h1);
})();
