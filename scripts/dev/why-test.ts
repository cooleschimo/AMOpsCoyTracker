/**
 * Check the why-now points on the items that produced padding.
 *
 * item-v5 filled three slots regardless of what an item supported, inventing
 * points from the prompt itself — "X is the AI company on file" restated the
 * company-on-file line, "Asian business outlet reporting..." described the
 * source. v6 says one point is a complete answer and names those two failures.
 *
 * Run: npx tsx scripts/dev/why-test.ts
 */
import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { callJson } from '../../lib/llm';
import { ITEM_RUBRIC_SYSTEM, buildScoringPrompt } from '../../lib/rubric';

(async () => {
  const sql = getSql();
  // The Perplexity item that produced the padding, plus a few neighbours.
  const rows: any = await sql`
    select i.id, i.title, i.snippet, i.source, i.source_type, i.published_at,
           c.name company, c.sectors
    from items i join companies c on c.id = i.company_id
    where i.status = 'kept' and c.name in ('Perplexity', 'Hadrian', 'Etched')
    order by i.id limit 6`;

  const batch = rows.map((x: any, k: number) => ({
    n: k + 1, title: x.title, snippet: x.snippet, source: x.source,
    sourceType: x.source_type, companyName: x.company,
    companySectors: x.sectors ?? [], publishedAt: x.published_at,
  }));

  const res = await callJson<any>({
    system: ITEM_RUBRIC_SYSTEM,
    user: buildScoringPrompt(batch),
    temperature: 0.1,
  });
  if (!res.ok) { console.log('failed:', res.error); return; }

  const BAD = [
    /\bis the .* company on file\b/i,
    /\b(outlet|publication|reports?|reporting)\b.*\b(funding|valuation|news)\b/i,
    /\bcompany on file\b/i,
  ];

  let flagged = 0;
  for (const [i, s] of res.data.scores.entries()) {
    const pts: string[] = Array.isArray(s.why) ? s.why : [String(s.why)];
    console.log(`\n[${batch[i]?.companyName}] score ${s.score} · momentum ${s.momentum} · ${pts.length} point(s)`);
    for (const p of pts) {
      const bad = BAD.some((re) => re.test(p));
      if (bad) flagged++;
      console.log(`  ${bad ? 'PADDING >' : '        -'} ${p}`);
    }
  }
  console.log(flagged ? `\n${flagged} padded points still present` : '\nno padded points');
})();
