/**
 * Step 11 — render the weekly digest. Brief §10.
 *
 * Builds the plan (§7a matrix), renders Outlook-safe HTML plus a plaintext
 * alternative, and writes both to out/. It does NOT send: §11 is explicit that
 * nothing sends without approval, and DIGEST_TEST_MODE defaults true.
 *
 * Usage: npx tsx scripts/render-digest.ts [--rubric item-v3] [--save]
 *   --save  also records the digests row (status 'draft')
 */
import '../lib/loadenv';
import { weekOfSaturday, lastWeekSaturday } from '../lib/week';
import { mkdirSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { digests, runs } from '../lib/schema';
import { COMPANY_SIGNAL_VERSION } from '../lib/company-signal';
import { planDigest, coverageLine, type PlacementInput } from '../lib/placement';
import { renderHtml, renderText, type RenderRow } from '../lib/digest-render';
import { dismissalFilter } from '../lib/dashboard-data';
import { assembleWhyNow, hasCoOccurrence, type WhyNowInput } from '../lib/why-now';
import { env } from '../lib/env';
import type { Band } from '../lib/company-rubric';
import type { Familiarity } from '../lib/familiarity';
import { writeProposition, findPrecedent, STATUS_NOTE } from '../lib/proposition';
import { Budget } from '../lib/budget';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

/**
 * The week this digest covers: the one that just finished.
 *
 * The digest reports on a completed week, where the dashboard is a live view of
 * the current one — the same signals read at a different moment. A digest sent
 * on Monday about the week starting that Monday would cover a few hours, so it
 * looks back one. `--week` overrides, which is how an earlier week is
 * re-rendered.
 */

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const signalVersion = arg('signals', COMPANY_SIGNAL_VERSION)!;
  const save = flag('save');
  const weekOf = arg('week', lastWeekSaturday())!;

  // Latest assessment per company, at whatever version is current — a lateral
  // join rather than a plain one, so an unassessed company still yields a row.
  /**
   * One row per company scored this week, with the item it leads with.
   *
   * The judgment is the company's; the representative item is what an RD opens
   * the conversation with. A company scored without one is held back, since
   * presence in the digest requires something to point at.
   */
  let rows: any = await sqlc`
    select
      cs.company_id, c.name as company_name, c.familiarity, c.sectors,
      cs.expansion, cs.momentum, cs.partnership, cs.signal_type,
      cs.expansion_language, cs.why, cs.week_of,
      i.id as item_id, i.title, i.url, i.source, i.source_type, i.published_at,
      ca.target_priority, ca.singapore_fit, ca.potential_contribution,
      ca.contribution_drivers, ca.confidence, ca.rationale,
      ca.apac_footprint, ca.apac_footprint_detail,
      ca.financial_health, ca.financial_health_detail, ca.financial_source,
      (select count(*)::int from items d where d.cluster_id = i.id) as cluster_size,
      (select pr.note from path_reviews pr
        where pr.company_id = cs.company_id and pr.status = 'confirmed'
          and coalesce(pr.do_not_use, false) = false
        order by pr.confirmed_at desc limit 1) as warm_path
    from company_signals cs
    join companies c on c.id = cs.company_id
    join items i on i.id = cs.representative_item_id
    left join lateral (
      select * from company_assessments a
      where a.company_id = cs.company_id
      order by a.assessed_at desc limit 1
    ) ca on true
    where cs.signal_version = ${signalVersion}
      -- One week only. Signals accumulate week on week, so without this the
      -- digest read every week at once and then labelled the result with a
      -- single week's date.
      and cs.week_of = ${weekOf}::date
      /*
       * And something published in that week. The scoring window is thirty
       * days, so without this a company carried by a three-week-old story
       * reads as this week's news. lib/dashboard-data.ts applies the same
       * condition, because the digest and the dashboard must not disagree
       * about which companies belong to a week.
       *
       * Published in the week or first seen in it: an ATS aggregate carries no
       * publication date, and ordinary news is often found days after it ran.
       */
      and exists (
        select 1 from items w
        where w.company_id = cs.company_id and w.status = 'kept'
          and (
            -- Published in the week …
            (w.published_at >= cs.week_of and w.published_at < cs.week_of + 7)
            -- … or found in it, provided the story is not much older than the
            -- week itself. A quarter of kept news is discovered three or more
            -- days after it ran, so publication alone would file a company into
            -- a week whose page has already been read. But an unbounded
            -- fetched-in-week test is worse: a backfill stamps today's date on
            -- everything it pulls, so re-pulling a month of archives would drag
            -- all of it onto the current page. Fourteen days is wider than the
            -- observed lag and far short of the thirty-day scoring window.
            or (
              w.fetched_at >= cs.week_of and w.fetched_at < cs.week_of + 7
              and (w.published_at is null or w.published_at >= cs.week_of - 14)
            )
          ))
    order by cs.expansion desc, cs.momentum desc`;

  if (!rows.length) {
    console.log(`No company signals at '${signalVersion}'. Run score-companies first.`);
    return;
  }

  // A company dismissed on the dashboard does not arrive in the week's email.
  // The rule lives in dashboard-data so the two cannot disagree about it.
  const keep = await dismissalFilter();
  const before = rows.length;
  rows = (rows as any[]).filter((r: any) => keep(Number(r.company_id), r.published_at));
  if (rows.length < before) console.log(`  ${before - rows.length} dismissed by an RD, left out`);

  const input: PlacementInput[] = rows.map((r: any) => ({
    itemId: r.item_id,
    companyId: r.company_id,
    companyName: r.company_name,
    expansion: Number(r.expansion),
    momentum: Number(r.momentum),
    partnership: Number(r.partnership),
    familiarity: (r.familiarity ?? null) as Familiarity | null,
    signalType: r.signal_type,
    sourceType: r.source_type,
    targetPriority: (r.target_priority ?? null) as Band | null,
    singaporeFit: (r.singapore_fit ?? null) as Band | null,
    publishedAt: r.published_at ? new Date(r.published_at) : null,
    clusterSize: Number(r.cluster_size) || 1,
  }));

  const plan = planDigest(input);

  const renderRows = new Map<number, RenderRow>();
  for (const r of rows as any[]) {
    const base = input.find((i) => i.itemId === r.item_id)!;
    renderRows.set(r.item_id, {
      ...base,
      section: 'omitted', rank: 0,      // overwritten by the plan; unused in render
      title: r.title,
      url: r.url,
      why: r.why,
      source: r.source,
      potentialContribution: r.potential_contribution ?? null,
      confidence: r.confidence ?? null,
      sectors: r.sectors ?? null,
      // A warm path is shown ONLY when a human confirmed it (§8, §9). An
      // unreviewed association must never be presented as an introduction.
      warmPath: r.warm_path ?? null,
      contributionDrivers: r.contribution_drivers ?? null,
      assessmentRationale: r.rationale ?? null,
      assessmentConfidence: r.confidence ?? null,
    });
  }

  /**
   * Compose the why-now for featured items from the company's OTHER scored
   * items as well as the one that surfaced it.
   *
   * The scorer reads a single item and writes only what that item supports, so
   * a one-fact story yields one point. Everything else already known about the
   * company has been scored too — its hiring aggregate, its other news — and
   * those points were each checked against their own source. Merging them costs
   * no model call and is what makes §7's co-occurrence rule visible.
   */
  const scoredByCompany = new Map<number, WhyNowInput[]>();
  for (const r of rows as any[]) {
    if (r.company_id === null) continue;
    const arr = scoredByCompany.get(r.company_id) ?? [];
    arr.push({
      itemId: r.item_id, why: r.why, sourceType: r.source_type,
      publishedAt: r.published_at ? new Date(r.published_at) : null,
    });
    scoredByCompany.set(r.company_id, arr);
  }

  // The render rows are built before placement, so they carry a placeholder
  // section. Stamp the real one from the plan — every section conditional in
  // the renderer keys off it.
  // A company can legitimately appear in BOTH discovery and trending, and the
  // render rows are keyed by item, so the last write would win. Trending is
  // stamped first and discovery second: the discovery tiers carry the fuller
  // treatment, so an item in both should render as the one that says more.
  for (const sec of ['who_we_know', 'new_on_the_radar', 'worth_a_conversation'] as const) {
    for (const p of plan.sections[sec]) {
      const r = renderRows.get(p.itemId);
      if (r) r.section = sec;
    }
  }
  if (plan.exploration) {
    const r = renderRows.get(plan.exploration.itemId);
    if (r) r.section = 'exploration';
  }

  for (const sec of ['worth_a_conversation', 'new_on_the_radar', 'who_we_know'] as const) {
    for (const p of plan.sections[sec]) {
      const r = renderRows.get(p.itemId);
      if (!r || p.companyId === null) continue;
      const siblings = (scoredByCompany.get(p.companyId) ?? []).filter((x) => x.itemId !== p.itemId);
      const merged = assembleWhyNow(
        { itemId: p.itemId, why: r.why, sourceType: r.sourceType, publishedAt: r.publishedAt },
        siblings,
      );
      // Points from other items are marked, so a reader can tell what this
      // headline said from what the company has also been doing.
      r.whyPointsMerged = merged.map((m) => ({ text: m.text, primary: m.primary, sourceType: m.sourceType }));
      r.coOccurrence = hasCoOccurrence(merged);
    }
  }

  // Singapore's proposition, for the featured tier ONLY. One call per item,
  // at most four, so this costs a handful of requests rather than a run.
  const budget = new Budget();
  for (const p of [...plan.sections.worth_a_conversation, ...plan.sections.new_on_the_radar, ...plan.sections.who_we_know]) {
    const r = renderRows.get(p.itemId);
    if (!r) continue;
    // What Singapore has already done in this space, from the public record.
    // The assessment rationale names the plausible engagement, so it scopes
    // the search to what an RD would actually point at.
    const precedent = await findPrecedent(r.sectors ?? [], r.assessmentRationale ?? '');
    const prop = await writeProposition({
      companyName: p.companyName,
      sectors: r.sectors ?? [],
      precedent,
      assessmentRationale: r.assessmentRationale ?? null,
      singaporeFit: p.singaporeFit,
      targetPriority: p.targetPriority,
      triggerTitle: r.title,
      triggerWhy: r.why,
    }, { budget });
    // A missing proposition is left missing. An invented one would put a claim
    // in an RD's mouth that Singapore cannot back.
    if (prop) r.proposition = {
      line: prop.line, status: STATUS_NOTE[prop.status],
      caveat: prop.caveat, precedent: prop.precedent,
      precedentUrl: prop.precedentUrl, framedBy: prop.framedBy,
    };
  }

  // Watched companies, matching lib/dashboard-data.ts so the digest and the
  // dashboard cannot report different coverage for the same week.
  const mon: any = await sqlc`select count(*)::int n from companies c
    where coalesce(c.discovered_via, '') <> 'portfolio'
      and coalesce(c.scope_status, 'unknown') <> 'out_of_scope'`;
  const proc: any = await sqlc`select count(*)::int n from items`;
  const coverage = coverageLine(mon[0].n, proc[0].n, plan.counts.placed);

  const renderInput = { weekOf, coverage, plan, rows: renderRows, appBaseUrl: env.appBaseUrl() };
  const html = renderHtml(renderInput);
  const text = renderText(renderInput);

  mkdirSync('out', { recursive: true });
  writeFileSync(`out/digest-${weekOf}.html`, html);
  writeFileSync(`out/digest-${weekOf}.txt`, text);

  console.log(coverage);
  console.log(`\nwrote out/digest-${weekOf}.html  (${(html.length / 1024).toFixed(1)} KB)`);
  console.log(`wrote out/digest-${weekOf}.txt   (${(text.length / 1024).toFixed(1)} KB)`);
  console.log('\nsection counts:');
  for (const [sec, items] of Object.entries(plan.sections)) {
    if (items.length) console.log(`  ${sec.padEnd(22)} ${items.length}`);
  }
  if (plan.exploration) console.log(`  ${'exploration'.padEnd(22)} 1`);
  console.log('\ncounts:', JSON.stringify(plan.counts));
  console.log(`\nTEST MODE: ${env.appBaseUrl() ? 'app base ' + env.appBaseUrl() : ''} — nothing is sent by this script.`);

  if (save) {
    const featured = (['worth_a_conversation', 'new_on_the_radar', 'who_we_know'] as const)
      .flatMap((s2) => plan.sections[s2]).map((i) => i.itemId);
    const ids = plan.exploration ? [...featured, plan.exploration.itemId] : featured;
    const [run] = await db.insert(runs).values({ stage: 'render_digest' }).returning();
    await withRetry(() => db.insert(digests).values({
      weekOf, itemIds: ids, status: 'draft', testMode: true,
    }).onConflictDoUpdate({
      target: digests.weekOf, set: { itemIds: ids, status: 'draft' },
    }));
    await db.update(runs).set({ finishedAt: new Date(), counts: plan.counts }).where(eq(runs.id, run.id));
    console.log(`saved digests row for ${weekOf} (status 'draft', ${ids.length} items)`);
  }
})();
