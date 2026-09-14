/**
 * Discover companies from news that names nobody we track. Brief §5.5, step 16.
 *
 * lib/discover-news.ts explains why this route exists: company-directed search
 * can only return companies already on the list, so it monitors rather than
 * discovers. The untargeted feeds already carry the companies nobody has heard
 * of; nothing was reading the names out of them.
 *
 * A discovered company enters the same way a Form D discovery does — created
 * with `discovered_via = 'news'` and `scope_status = 'unknown'`, then judged by
 * the ordinary assessment. Nothing here decides a company is in scope, and the
 * item that surfaced it is attached so the claim stays checkable (§15).
 *
 * Two routes into the same table. A fundraise headline is read without a model,
 * because "Company raises $X" has a fixed grammar and the figure confirms the
 * event. Every other event type — an opening, a partnership, an acquisition —
 * is looser: "Japan seeks more H3 rocket launches" and "CADDi Launches ITAR
 * Support" are the same shape and only one names a company, so the model reads
 * those. Casting wide costs a few calls; being wrong about a name costs a bad
 * row flowing through assessment and scoring before anyone notices.
 *
 * Usage: npx tsx scripts/discover-news.ts [--days 14] [--min-usd 1000000]
 *          [--no-events] [--batch 15] [--dry]
 */
import '../lib/loadenv';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';
import { getDb, getSql, withRetry } from '../lib/db';
import { companies, items, runs } from '../lib/schema';
import {
  EXTRACT_SYSTEM, buildExtractPrompt, candidatesFrom, eventCandidates, isCategoryName,
  type NewsCandidate,
} from '../lib/discover-news';
import { normalizeCompanyName } from '../lib/normalize';
import { regionForState, refineCaRegion } from '../lib/edgar';
import { isUsState } from '../lib/scope';
import { callJson } from '../lib/llm';
import { openBudget } from '../lib/budget-store';
import { pool, batched, workersFromArgs } from '../lib/pool';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

/**
 * Split "Palo Alto, CA" or "Berlin, Germany" into the fields the rest of the
 * pipeline filters on. A two-letter tail is a US state, and only then is the
 * region meaningful — hq_region is a US concept, so a non-US company gets a
 * city and country and no region rather than a wrong one.
 */
function parseHq(hq: string | null | undefined) {
  if (!hq) return {};
  const [city, tail] = hq.split(',').map((p) => p.trim());
  if (!city) return {};
  if (isUsState(tail)) {
    // California spans three of the regions, so the city decides which.
    const region = tail === 'CA' ? refineCaRegion(city) : regionForState(tail);
    return { hqCity: city, hqState: tail, hqRegion: region };
  }
  return { hqCity: city, hqState: tail || null };
}



(async () => {
  const db = getDb();
  const sqlc = getSql();
  const days = Number(arg('days', '14'));
  /**
   * A floor on the round. Below roughly a million the company is pre-product,
   * and an approach has nothing to land on for years.
   *
   * It has never fired: across thirty days of items, no headline stated a round
   * under $1M — outlets do not write up rounds that small. Kept as a cheap
   * guard rather than removed, but it is not doing the work the guard list and
   * the model's own rejections are.
   */
  const minUsd = Number(arg('min-usd', '1000000'));
  const batchSize = Number(arg('batch', '15'));
  const noEvents = flag('no-events');
  const csvOut = arg('csv', 'data/discovered_candidates.csv')!;
  const dry = flag('dry');
  const workers = workersFromArgs();
  const kept: NewsCandidate[] = [];

  const known: any = await sqlc`select normalized_name from companies`;
  const knownSet = new Set<string>(known.map((k: any) => k.normalized_name));
  const excluded: any = await sqlc`select normalized_name from excluded_companies`;
  const excludedSet = new Set<string>(excluded.map((k: any) => k.normalized_name));

  /**
   * Untargeted items, minus the kinds that are context rather than discovery.
   *
   * Singapore agency news names companies EDB is already working with — a firm
   * announcing Singapore jobs alongside A*STAR is in conversation with the
   * agency, not a company to discover. Reading those would fill the pipeline
   * with names the RDs already know and have already engaged, which is the
   * opposite of the point.
   *
   * They stay ingested and stay read by score-companies as context: what
   * Singapore is currently able to offer is exactly what those feeds carry.
   * They are excluded from THIS route only.
   *
   * Export-control notices and competitor-IPA stories are excluded for the same
   * reason from the other direction — a Federal Register rule names no company
   * to approach, and a story about IDA Ireland's wins names companies another
   * agency has already landed.
   */
  const rows: any = await sqlc`
    select id, title, snippet, source, url from items
    where company_id is null
      and coalesce(context_kind, '') not in ('sg_policy', 'export_control', 'competitor_ipa')
      and coalesce(published_at, fetched_at) > now() - make_interval(days => ${days})
    order by coalesce(published_at, fetched_at) desc`;

  const found = candidatesFrom(rows, (n) => knownSet.has(normalizeCompanyName(n)));
  console.log(`${rows.length} untargeted items in the last ${days} days`);
  console.log(`${found.length} are fundraises naming a company we do not have`);

  const [run] = await db.insert(runs).values({ stage: 'discover_news' }).returning();
  const budget = await openBudget();
  const counts = {
    items_read: rows.length, candidates: found.length,
    event_headlines: 0, event_batches: 0, event_named: 0, event_rejected: 0,
    fundraise_rejected: 0, category_rejected: 0,
    created: 0, below_floor: 0, on_guard_list: 0, already_exists: 0,
  };

  /**
   * Every candidate is confirmed by the model, including the ones the fundraise
   * regex found. The regex reads the grammatical subject, which is usually the
   * company and sometimes "Sources:", "Harvard Law dropout" or a private equity
   * firm raising a fund. The model also returns the headquarters, which decides
   * whether the company is in scope at all — and nothing else in this route
   * knows where a company is.
   */
  if (found.length) {
    const asItems = found.map((c) => ({ id: c.itemId, title: c.title, source: c.source }));
    const byItem = new Map(found.map((c) => [c.itemId, c]));
    const confirmed: NewsCandidate[] = [];
    const confirmBatch = async (batch: typeof asItems) => {
      const res = await callJson<{ results?: Array<{ id?: number; company?: string | null; hq?: string | null }> }>({
        system: EXTRACT_SYSTEM, user: buildExtractPrompt(batch), budget,
      });
      if (!res.ok || !res.data?.results) {
        // Unconfirmed rather than rejected: the regex found something real, and
        // a model failure is not evidence against it.
        for (const b of batch) { const c = byItem.get(b.id); if (c) confirmed.push(c); }
        return;
      }
      for (const r of res.data.results) {
        const c = typeof r.id === 'number' ? byItem.get(r.id) : undefined;
        if (!c) continue;
        const name = (r.company ?? '').trim();
        if (!name || name.toLowerCase() === 'null') { counts.fundraise_rejected++; continue; }
        // The prompt asks for a name rather than a category; this is what makes
        // it so. "Defense startup" collected 88 stories about a dozen firms.
        if (isCategoryName(name)) { counts.category_rejected++; continue; }
        confirmed.push({ ...c, name, hq: (r.hq ?? '').trim() || null });
      }
    };

    await pool(batched(asItems, batchSize), workers, confirmBatch, () => budget.halted);
    found.length = 0;
    found.push(...confirmed);
  }

  /**
   * The other event types, read by the model. It answers with a company or
   * null, and null is the common and correct answer — most headlines in a wire
   * feed are about a market, a government or a person.
   */
  if (!noEvents) {
    const events = eventCandidates(rows);
    counts.event_headlines = events.length;
    console.log(`${events.length} more are other events, read by the model\n`);

    const eventBatch = async (batch: typeof events) => {
      counts.event_batches++;
      const res = await callJson<{ results?: Array<{ id?: number; company?: string | null; hq?: string | null; event?: string }> }>({
        system: EXTRACT_SYSTEM,
        user: buildExtractPrompt(batch.map((b) => ({ id: b.id, title: b.title, source: b.source }))),
        budget,
      });
      if (!res.ok || !res.data?.results) { console.warn(`  batch ${counts.event_batches}: ${res.error ?? 'no results'}`); return; }

      const byId = new Map(batch.map((b) => [b.id, b]));
      for (const r of res.data.results) {
        const it = typeof r.id === 'number' ? byId.get(r.id) : undefined;
        if (!it) continue;
        const name = (r.company ?? '').trim();
        if (!name || name.toLowerCase() === 'null') { counts.event_rejected++; continue; }
        if (isCategoryName(name)) { counts.category_rejected++; continue; }
        if (knownSet.has(normalizeCompanyName(name))) continue;
        counts.event_named++;
        found.push({
          name, round: null, amountUsd: null, valuationUsd: null,
          hq: (r.hq ?? '').trim() || null,
          itemId: it.id, title: it.title, source: it.source, url: it.url,
        } as NewsCandidate);
      }
    };

    await pool(batched(events, batchSize), workers, eventBatch, () => budget.halted);
  }
  console.log('');

  for (const c of found) {
    const norm = normalizeCompanyName(c.name);

    // §4's guard table: stale references keep exited companies circulating, and
    // a discovery route is exactly where they re-enter.
    if (excludedSet.has(norm)) {
      counts.on_guard_list++;
      console.log(`  skip  ${c.name} — on the exclusion list`);
      continue;
    }
    if (knownSet.has(norm)) { counts.already_exists++; continue; }
    if (c.amountUsd !== null && c.amountUsd < minUsd) {
      counts.below_floor++;
      console.log(`  skip  ${c.name} — $${(c.amountUsd / 1e6).toFixed(1)}M is below the floor`);
      continue;
    }

    console.log(`  NEW   ${c.name.padEnd(24)} ${(c.round ?? 'round unstated').padEnd(15)}`
      + `${c.amountUsd ? `$${(c.amountUsd / 1e6).toFixed(0)}M` : ''}`
      + `${c.valuationUsd ? ` at $${(c.valuationUsd / 1e9).toFixed(1)}B` : ''}  [${c.source}]`);

    if (!dry) {
      const [created] = await withRetry(() => db.insert(companies).values({
        name: c.name,
        normalizedName: norm,
        // Sectors are classified separately; nothing here knows them.
        sectors: [],
        roundStage: c.round,
        roundAmountMusd: c.amountUsd ? Math.round(c.amountUsd / 1e6) : null,
        // Millions, like the line above and like every other writer of this
        // column. The headline parser yields dollars.
        valuationEst: c.valuationUsd ? String(Math.round(c.valuationUsd / 1e6)) : null,
        valuationSource: c.valuationUsd ? `${c.source}, ${c.title}`.slice(0, 300) : null,
        ...parseHq(c.hq),
        discoveredVia: 'news',
        // Nothing has judged this company. 'unknown' is the honest value, and
        // assess-companies picks it up from there.
        scopeStatus: 'unknown',
        scopeReason: `found in ${c.source}: ${c.title}`.slice(0, 300),
      }).onConflictDoNothing({ target: companies.normalizedName })
        .returning({ id: companies.id }));

      // Attach the item that surfaced it, so the claim is checkable and the
      // company arrives with its own why-now rather than an empty week.
      if (created) {
        await withRetry(() => db.update(items)
          .set({ companyId: created.id, status: 'kept', droppedReason: 'discovered_company' })
          .where(eq(items.id, c.itemId)));
      }
    }
    knownSet.add(norm);
    kept.push(c);
    counts.created++;
  }

  // The candidate list, written whether or not it was inserted, so a dry run
  // leaves something to read rather than only something to scroll.
  if (kept.length) {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""').replace(/\s+/g, ' ').trim()}"`;
    writeFileSync(csvOut, ['name,hq,round,amount_usd,valuation_usd,source,headline,url']
      .concat(kept.map((c) => [
        esc(c.name), esc(c.hq ?? ''), c.round ?? '', c.amountUsd ?? '', c.valuationUsd ?? '',
        esc(c.source), esc(c.title), esc(c.url),
      ].join(',')))
      .join('\n') + '\n');
    console.log(`\nwrote ${csvOut}`);
  }

  await budget.done();

  await db.update(runs).set({
    finishedAt: new Date(), counts,
    tokensIn: budget.tokensIn, tokensOut: budget.tokensOut,
  }).where(eq(runs.id, run.id));
  console.log(`\ncounts: ${JSON.stringify(counts)}`);
  if (dry) console.log('DRY RUN — nothing written');
  else if (counts.created) console.log(`\n${counts.created} new companies. Assess them: npx tsx scripts/assess-companies.ts`);
})();
