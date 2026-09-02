/**
 * Classify companies into the two-tier taxonomy. lib/subsectors.ts defines it.
 *
 * Writes the CSV that scripts/load-sectors.ts reads, so classification and
 * loading stay separable: the file can be read before anything is written, and
 * a bad run is a file to delete rather than a table to repair.
 *
 * Classification is by what a company SELLS, not what it uses to build it.
 * Nearly everything in scope uses AI now, so a tag that catches all of them
 * separates none of them — and the separation is the entire point, since a GPU
 * cloud needs land and power where a legal-AI product needs an office.
 *
 * A company with no real description is left alone rather than guessed at.
 * Portfolio scraping stores a name and a link and nothing else, and a sector
 * inferred from a name is a fabrication the rest of the pipeline would then
 * treat as fact.
 *
 * Usage: npx tsx scripts/classify-sectors.ts [--limit N] [--batch 15] [--all] [--dry]
 *        --all      also re-classify companies that already carry a sector
 *        --out      where to write (default data/sectors_classified.csv)
 */
import '../lib/loadenv';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';
import { getDb, getSql } from '../lib/db';
import { runs } from '../lib/schema';
import { Budget } from '../lib/budget';
import { callJson } from '../lib/llm';
import { isBroadSector, isSector, sectorBroadSector, sectorsForPrompt } from '../lib/subsectors';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

export const SECTOR_CLASSIFIER_VERSION = 'sector-v1';

const SYSTEM = `You classify companies into one sector for an investment promotion agency deciding whether to approach them.

Classify by what the company SELLS, not what it uses to build it. Nearly every company here uses AI; a tag that catches all of them separates none of them. A drug company that finds molecules with a transformer is a drug company. A robot company running a foundation model on board is a robot company.

The test that settles a hard case: what would this company need from a government if it opened here? Land and power, or an office and a sales team? Clinical trial sites, or fab capacity? Two companies needing the same things belong together however different their technology sounds.

Every company gets a broad sector. Give a subsector too when the description supports one; leave it empty when the family is clear but the child is not.

Some entries give a news headline rather than a company summary — "Freeman Automation to Establish New Operation in Graves County". Classify from what the headline reveals about the business, and return low confidence when it reveals little. A headline about a company's activity is not the same evidence as a description of what it sells.

Return the ids exactly as written. If no broad sector fits, use "other". Do not invent an id and do not stretch a definition to avoid "other".

Return JSON only:
{"results":[{"id":<number>,"sector":"<broad id>","subsector":"<subsector id or empty>","tags":["<other ids>"],"confidence":"high|medium|low","why":"<one clause, under twelve words>"}]}`;

type Row = { id: number; name: string; description: string | null; website: string | null };
type Out = {
  results?: Array<{
    id?: number; sector?: string; subsector?: string;
    tags?: string[]; confidence?: string; why?: string;
  }>;
};

function buildPrompt(batch: Row[]): string {
  return `Sectors:

${sectorsForPrompt()}

Classify each company below. Return one result per id, ${batch.length} in total.

${batch.map((c) => `id ${c.id}: ${c.name}
  ${c.description ?? '(no description)'}${c.website ? `\n  ${c.website}` : ''}`).join('\n\n')}`;
}

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const batchSize = Number(arg('batch', '15'));
  const limit = Number(arg('limit', '0'));
  const outFile = arg('out', 'data/sectors_classified.csv')!;
  const all = flag('all');
  const dry = flag('dry');

  /**
   * Companies worth classifying: something to read, and either no sector yet or
   * an explicit re-run. Ordered so the ones that reach the digest are done
   * first — a partial run then still covers what matters.
   *
   * A news-discovered company has no description, because that route stores a
   * name and the headline that surfaced it. The headline usually classifies
   * well enough on its own: "Freeman Automation to Establish New Operation in
   * Graves County" says manufacturing, "Epson launches AX6 cobot" says robotics.
   * So it stands in, and the prompt is told it may be reading one.
   */
  const rows: any = await sqlc`
    select c.id, c.name, c.website,
           coalesce(nullif(c.description, ''), c.scope_reason) as description
    from companies c
    where (
        (c.description is not null and c.description <> '' and c.description not ilike 'Website:%')
        or (c.discovered_via = 'news' and c.scope_reason is not null)
      )
      ${all ? sqlc`` : sqlc`and (c.sectors is null or array_length(c.sectors, 1) is null
                               or not exists (select 1 from unnest(c.sectors) s
                                              where s in ('ai','deeptech','biotech','defence_tech')))`}
    order by
      exists (select 1 from company_signals cs
              where cs.company_id = c.id and cs.week_of > current_date - 60) desc,
      c.name`;

  const list: Row[] = limit ? rows.slice(0, limit) : rows;
  console.log(`${rows.length} companies with a usable description${all ? '' : ' and no current-taxonomy sector'}`);
  console.log(`classifying ${list.length} in batches of ${batchSize}\n`);
  if (!list.length) return;

  const [run] = await db.insert(runs).values({ stage: 'classify_sectors' }).returning();
  const budget = new Budget();
  const counts = {
    considered: list.length, batches: 0, classified: 0,
    unknown_sector: 0, broad_mismatch: 0, failed_batches: 0, missing: 0,
  };
  const out: string[] = ['id,name,sector,subsector,tags,confidence,why'];
  const dist: Record<string, number> = {};

  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  try {
    for (let i = 0; i < list.length; i += batchSize) {
      if (budget.halted) { console.warn(`\nBudget halted: ${budget.haltReason}`); break; }
      const batch = list.slice(i, i + batchSize);
      counts.batches++;

      const res = await callJson<Out>({ system: SYSTEM, user: buildPrompt(batch), budget });
      if (!res.ok || !res.data?.results) {
        counts.failed_batches++;
        console.warn(`  batch ${counts.batches}: ${res.error ?? 'no results'}`);
        continue;
      }

      const byId = new Map(batch.map((b) => [b.id, b]));
      const seen = new Set<number>();
      for (const r of res.data.results) {
        const c = typeof r.id === 'number' ? byId.get(r.id) : undefined;
        if (!c) continue;
        seen.add(c.id);

        const sector = (r.sector ?? '').trim();
        const subsector = (r.subsector ?? '').trim();
        if (!isBroadSector(sector)) { counts.unknown_sector++; continue; }
        // A subsector that does not sit under the broad sector the model also
        // returned is a contradiction, not a near miss — drop the child and
        // keep the family rather than storing a pair that cannot both be true.
        let child = subsector;
        if (child && (!isSector(child) || sectorBroadSector(child) !== sector)) {
          counts.broad_mismatch++;
          child = '';
        }
        const tags = (r.tags ?? []).filter((t) => isSector(t) || isBroadSector(t));

        out.push([
          c.id, esc(c.name), sector, child, esc(tags.join('|')),
          (r.confidence ?? 'low').toLowerCase(), esc((r.why ?? '').slice(0, 90)),
        ].join(','));
        counts.classified++;
        const key = child || sector;
        dist[key] = (dist[key] ?? 0) + 1;
      }
      counts.missing += batch.length - seen.size;
      console.log(`  batch ${counts.batches}/${Math.ceil(list.length / batchSize)}: ${seen.size}/${batch.length} classified`);
    }
  } finally {
    await db.update(runs).set({
      finishedAt: new Date(), counts,
      tokensIn: budget.tokensIn, tokensOut: budget.tokensOut,
      error: budget.halted ? `halted: ${budget.haltReason}` : null,
    }).where(eq(runs.id, run.id));
  }

  if (!dry) writeFileSync(outFile, out.join('\n') + '\n');

  console.log('\ndistribution:');
  for (const [s, n] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} ${s}`);
  }
  console.log('\ncounts:', JSON.stringify(counts));
  console.log(dry ? '\nDRY RUN — no file written' : `\nwrote ${outFile}\n  load it: npx tsx scripts/load-sectors.ts`);
})();
