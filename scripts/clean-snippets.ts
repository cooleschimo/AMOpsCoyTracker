/**
 * Repair snippets stored with markup in them.
 *
 * A feed carrying escaped HTML resurrects its markup if tags are stripped
 * before entities are decoded, and Google News does exactly that — every
 * <description> is an escaped <ol> of related articles inside CDATA. That left
 * 8,967 of 10,418 stored snippets holding raw markup.
 *
 * It matters beyond rendering: the snippet goes into the scoring prompt, so the
 * model reads `<a href="https://news.google.com/rss/...">` as evidence about a
 * company.
 *
 * The parser handles the ordering correctly now, and this applies the same
 * repair to rows already stored so nothing has to be re-fetched. A snippet is
 * derived text rather than the fetched record — url, title, source and dates
 * are untouched — so the retention rule still holds.
 *
 * Usage: npx tsx scripts/clean-snippets.ts [--dry] [--limit N]
 */
import '../lib/loadenv';
import { getSql } from '../lib/db';

const flag = (n: string) => process.argv.includes(`--${n}`);
const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

/** Same transformation as lib/news-sources.ts:tagText, applied to stored text. */
function cleanSnippet(raw: string): string {
  const decode = (t: string) => t
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&mdash;|&ndash;/gi, '-')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');

  let t = raw;
  for (let pass = 0; pass < 3; pass++) {
    const before = t;
    t = decode(t).replace(/<[^>]+>/g, ' ');
    if (t === before) break;
  }
  return t.replace(/\s+/g, ' ').trim();
}

(async () => {
  const sql = getSql();
  const dry = flag('dry');
  const limit = Number(arg('limit', '0'));

  const rows: any = await sql`select id, snippet from items
    where snippet is not null and (snippet like '%<%' or snippet like '%&lt;%')
    order by id`;
  const targets = limit ? rows.slice(0, limit) : rows;
  console.log(`${targets.length} snippets contain markup`);

  let changed = 0, emptied = 0;
  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    const cleaned = cleanSnippet(r.snippet);
    if (cleaned === r.snippet) continue;

    if (i < 3) {
      console.log(`\n[${r.id}] before: ${r.snippet.slice(0, 110)}`);
      console.log(`      after:  ${cleaned.slice(0, 110) || '(empty — the snippet was ONLY markup)'}`);
    }

    // A snippet that was pure markup becomes null rather than an empty string:
    // "no snippet" is a real state the scorer already handles, and an empty
    // string would read as a snippet that says nothing.
    if (!dry) {
      if (cleaned) await sql`update items set snippet = ${cleaned} where id = ${r.id}`;
      else await sql`update items set snippet = null where id = ${r.id}`;
    }
    changed++;
    if (!cleaned) emptied++;
  }

  console.log(`\ncleaned: ${changed} · became empty: ${emptied}`);
  if (dry) console.log('DRY RUN — nothing written');
  else console.log('Re-score affected items to give the model clean text: npx tsx scripts/filter-score.ts --rescore');
})();
