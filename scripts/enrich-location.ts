/**
 * Read a company's headquarters out of the news written about it.
 *
 * A news-discovered company's location currently comes from the single headline
 * that surfaced it. That headline is about an event, not a company profile, so
 * the model is inferring from very little — right often enough to be useful,
 * wrong often enough that Implantica (Swiss) arrived as San Diego.
 *
 * After the company-directed news pull, the same company has around a hundred
 * headlines. Between them a location is usually stated outright — "Berlin's
 * Auxxo", "Finland's S-Transistors", "the Santa Clara chipmaker" — and the ones
 * that disagree are visible rather than invisible, which is what makes the
 * answer checkable instead of merely confident.
 *
 * Nothing here overwrites a location a person set, or one that came from a
 * filed address. A researched or filed location outranks anything read off a
 * headline, and `hq_source` is what records which is which.
 *
 * Usage: npx tsx scripts/enrich-location.ts [--limit N] [--batch 10] [--dry]
 *          [--all]  also re-read companies that already have a news location
 */
import '../lib/loadenv';
import { eq } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { companies, runs } from '../lib/schema';
import { Budget } from '../lib/budget';
import { callJson } from '../lib/llm';
import { refineCaRegion, regionForState } from '../lib/edgar';
import { isUsState } from '../lib/scope';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const SYSTEM = `You read news headlines about a company and give its headquarters.

Answer only from what the headlines actually support. They are about events, not company profiles, so most say nothing about where the company is — and "no location stated" is the common and correct answer. A guess that looks plausible is worse than nothing here, because it will be shown to someone as fact.

What counts as evidence: the company described by a place ("Berlin's Auxxo", "Finland's S-Transistors", "the Santa Clara chipmaker"), an office or facility called its headquarters, or a place named repeatedly across several unrelated headlines.

What does not: where a product launched, where a customer or partner is, where a conference was held, where a subsidiary or a new site is, or a country mentioned once in passing. A company opening a plant in Ohio is not headquartered in Ohio.

Give "City, ST" for a US company using the two-letter state, and "City, Country" otherwise. Return null when the headlines do not support one.

Return JSON only: {"results":[{"id":<number>,"hq":"<City, ST | City, Country | null>","evidence":"<the phrase that showed it, or empty>"}]}`;

type Out = { results?: Array<{ id?: number; hq?: string | null; evidence?: string }> };

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const batchSize = Number(arg('batch', '10'));
  const limit = Number(arg('limit', '0'));
  const all = flag('all');
  const dry = flag('dry');

  /**
   * Companies whose location is a guess or missing, with enough news to do
   * better. A manual correction or a filed address is never re-read.
   */
  const rows: any = await sqlc`
    select c.id, c.name, c.hq_city, c.hq_state,
           (select json_agg(t) from (
              select i.title as t from items i
              where i.company_id = c.id
              order by coalesce(i.published_at, i.fetched_at) desc
              limit 25) x) as titles
    from companies c
    where coalesce(c.hq_source, '') not in ('manual', 'researched', 'form_d')
      and (${all} or c.hq_city is null or c.hq_source = 'news')
      and (select count(*) from items i where i.company_id = c.id) >= 3
    order by c.name`;

  const list = (limit ? rows.slice(0, limit) : rows)
    .filter((r: any) => Array.isArray(r.titles) && r.titles.length >= 3);
  console.log(`${list.length} companies with enough news to locate\n`);
  if (!list.length) return;

  const [run] = await db.insert(runs).values({ stage: 'enrich_location' }).returning();
  const budget = new Budget();
  const counts = {
    considered: list.length, batches: 0, located: 0, unchanged: 0,
    no_evidence: 0, corrected: 0, failed_batches: 0,
  };

  try {
    for (let i = 0; i < list.length; i += batchSize) {
      if (budget.halted) { console.warn(`\nBudget halted: ${budget.haltReason}`); break; }
      const batch = list.slice(i, i + batchSize);
      counts.batches++;

      const user = `Give each company's headquarters, or null.\n\n${batch.map((c: any) =>
        `id ${c.id}: ${c.name}\n${(c.titles as string[]).slice(0, 25).map((t) => `  - ${t}`).join('\n')}`,
      ).join('\n\n')}`;

      const res = await callJson<Out>({ system: SYSTEM, user, budget });
      if (!res.ok || !res.data?.results) {
        counts.failed_batches++;
        console.warn(`  batch ${counts.batches}: ${res.error ?? 'no results'}`);
        continue;
      }

      const byId = new Map<number, any>(batch.map((b: any) => [b.id, b]));
      for (const r of res.data.results) {
        const c = typeof r.id === 'number' ? byId.get(r.id) : undefined;
        if (!c) continue;

        const hq = (r.hq ?? '').trim();
        if (!hq || hq.toLowerCase() === 'null') { counts.no_evidence++; continue; }

        const [city, tail] = hq.split(',').map((p) => p.trim());
        if (!city) { counts.no_evidence++; continue; }

        const region = isUsState(tail)
          ? (tail === 'CA' ? refineCaRegion(city) : regionForState(tail!))
          : null;

        const was = [c.hq_city, c.hq_state].filter(Boolean).join(', ');
        if (was === hq) { counts.unchanged++; continue; }
        if (was) {
          counts.corrected++;
          console.log(`  ${c.name.padEnd(24)} ${was.padEnd(24)} -> ${hq}${r.evidence ? `  (${r.evidence.slice(0, 40)})` : ''}`);
        } else {
          console.log(`  ${c.name.padEnd(24)} ${'(none)'.padEnd(24)} -> ${hq}`);
        }

        if (!dry) {
          await withRetry(() => db.update(companies).set({
            hqCity: city,
            hqState: isUsState(tail) ? tail : (tail || null),
            hqRegion: region,
            hqSource: 'news_search',
          }).where(eq(companies.id, c.id)));
        }
        counts.located++;
      }
    }
  } finally {
    await db.update(runs).set({
      finishedAt: new Date(), counts,
      tokensIn: budget.tokensIn, tokensOut: budget.tokensOut,
      error: budget.halted ? `halted: ${budget.haltReason}` : null,
    }).where(eq(runs.id, run.id));
  }

  console.log(`\ncounts: ${JSON.stringify(counts)}`);
  if (dry) console.log('DRY RUN — nothing written');
})();
