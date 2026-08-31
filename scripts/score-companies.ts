/**
 * Score COMPANIES on their recent window. Brief §7.
 *
 * Replaces per-item scoring as the thing the digest ranks on. The filter
 * cascade still runs per item — canonicalise, blocklist, pattern, company
 * match, recency, cluster — because that is cheap deduplication and has nothing
 * to do with judgment. What changed is the unit being judged: a company, on
 * everything it has done in the window, in light of which a connection can be
 * proposed.
 *
 * One call per company with recent activity, not one per item. On the current
 * data that is ~120 calls rather than 451, and each one sees the co-occurrence
 * (§7) that no single-item view can.
 *
 * Usage: npx tsx scripts/score-companies.ts [--limit N] [--week YYYY-MM-DD] [--dry] [--force]
 */
import '../lib/loadenv';
import { eq } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { companySignals, runs } from '../lib/schema';
import { callJson } from '../lib/llm';
import { Budget } from '../lib/budget';
import {
  COMPANY_SIGNAL_SYSTEM, COMPANY_SIGNAL_VERSION, WINDOW_DAYS,
  buildCompanySignalPrompt, type CompanyItem,
} from '../lib/company-signal';
import { isSignalType } from '../lib/rubric';
import { candidateProps } from '../lib/proposition';
import { classifyExecHire } from '../lib/exec-hire';
import { hiringIsTheNews } from '../lib/job-signal';
import { volumeTriggerFires } from '../lib/ats';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

/** Monday of the current week, so a mid-week re-run replaces one row. */
function weekOfMonday(): string {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day))
    .toISOString().slice(0, 10);
}

type Out = {
  expansion: number; momentum: number; partnership: number; signal_type: string;
  representative_item: number; expansion_language: boolean; why: string[] | string;
};

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const weekOf = arg('week', weekOfMonday())!;
  const limit = Number(arg('limit', '0'));
  const dry = flag('dry');
  const force = flag('force');

  // Companies with kept items in the window. An ATS aggregate has no published
  // date by construction, so it is included on its fetch date instead.
  // Raw neon templates do not compose like drizzle's `sql`, so the optional
  // clause is a plain boolean the query reads rather than spliced SQL.
  const targets: any = await sqlc`
    select c.id, c.name, c.sectors, count(i.id)::int n
    from companies c
    join items i on i.company_id = c.id and i.status = 'kept'
    where coalesce(i.published_at, i.fetched_at) > now() - make_interval(days => ${WINDOW_DAYS})
      and (${force} or not exists (
        select 1 from company_signals cs
        where cs.company_id = c.id and cs.week_of = ${weekOf}
          and cs.signal_version = ${COMPANY_SIGNAL_VERSION}))
    group by c.id, c.name, c.sectors
    order by count(i.id) desc`;

  const list = limit ? targets.slice(0, limit) : targets;
  console.log(`${list.length} companies with activity in the last ${WINDOW_DAYS} days (week of ${weekOf})\n`);
  if (!list.length) return;

  const [run] = await db.insert(runs).values({ stage: 'score_companies' }).returning();
  const budget = new Budget();
  const counts: Record<string, number> = {
    companies: 0, scored: 0, failed: 0, no_representative: 0, hiring_lead_replaced: 0,
    context_items_seen: 0,
    expansion_3: 0, expansion_2: 0, expansion_1: 0, expansion_0: 0,
    momentum_3: 0, momentum_2: 0, momentum_1: 0, momentum_0: 0,
    partnership_3: 0, partnership_2: 0, partnership_1: 0, partnership_0: 0,
    co_occurrence: 0,
  };

  try {
    for (const c of list) {
      if (budget.halted) {
        console.warn(`\nBudget halted: ${budget.haltReason}`);
        break;
      }
      counts.companies++;

      const rows: any = await sqlc`
        select i.id, i.title, i.snippet, i.source, i.source_type, i.published_at, i.fetched_at,
               (select count(*)::int from items d where d.cluster_id = i.id) as cluster_size
        from items i
        where i.company_id = ${c.id} and i.status = 'kept'
          and coalesce(i.published_at, i.fetched_at) > now() - make_interval(days => ${WINDOW_DAYS})
        order by coalesce(i.published_at, i.fetched_at) desc
        limit 25`;

      const items: CompanyItem[] = rows.map((r: any) => ({
        itemId: r.id, title: r.title, snippet: r.snippet, source: r.source,
        sourceType: r.source_type,
        publishedAt: r.published_at ? new Date(r.published_at) : null,
        clusterSize: Number(r.cluster_size) || 1,
      }));

      const [snap]: any = await sqlc`
        select total_jobs, non_us_jobs, apac_jobs from job_snapshots
        where company_id = ${c.id} order by snapshot_at desc limit 2`;
      const [sgCount]: any = await sqlc`
        select count(*)::int n from job_postings
        where company_id = ${c.id} and location ~* 'singapore'`;
      const snaps: any = await sqlc`
        select total_jobs from job_snapshots where company_id = ${c.id}
        order by snapshot_at desc limit 2`;

      // Senior roles owning a region: an event in their own right, where a
      // standing count of open roles is only background.
      const execRows: any = await sqlc`
        select title, location from job_postings where company_id = ${c.id}
        order by first_seen desc limit 200`;
      const execRoles = execRows
        .map((j: any) => classifyExecHire(j.title, j.location))
        .filter(Boolean).slice(0, 4);

      /**
       * Is the hiring itself the event. lib/job-signal.ts holds the rule; the
       * inputs it needs — the volume trigger and whether a Singapore entity
       * already exists — are known here.
       */
      const volumeTriggerFired = volumeTriggerFires(
        snaps.length > 1 ? Number(snaps[1].total_jobs) : null,
        snaps.length ? Number(snaps[0].total_jobs) : 0,
      );
      const [sgEntity]: any = await sqlc`
        select exists (select 1 from sg_links g
                       where g.subject_type = 'company' and g.subject_id = ${c.id}) as has_sg`;
      const hiringIsNews = hiringIsTheNews(
        {
          execHires: execRoles as any,
          apac: Number(snap?.apac_jobs ?? 0),
          singaporeCount: Number(sgCount?.n ?? 0),
        } as any,
        { volumeTriggerFired, hasSgEntity: Boolean(sgEntity?.has_sg) },
      );

      const filings: any = await sqlc`
        select form_type, filed_at, amount, security_type from sec_filings
        where company_id = ${c.id} order by filed_at desc limit 3`;

      /**
       * Policy, sector and competitor movement bearing on this company's
       * sectors, deduplicated by title and balanced across kinds.
       *
       * Recency alone fills the list with whichever feed published most that
       * week, so Singapore policy — the context that most affects what EDB can
       * offer — gets crowded out by sector-wide noise. Taking the most recent
       * few of each kind keeps all of them represented.
       *
       * The window differs by kind because the kinds are different sorts of
       * fact. An incentive scheme or an export-control rule is a standing
       * condition: it was true last quarter and still governs what EDB can
       * offer today, so ageing it out makes the model blind to it rather than
       * current. A funding wave or a trade headline is an event, and three
       * months on it is history — citing it as what is happening now would be
       * wrong. Slots are the cap either way, so a long window admits older
       * policy without letting it crowd out this week's news.
       */
      const CONTEXT_KINDS: Array<{ kind: string; days: number; slots: number }> = [
        { kind: 'sg_policy', days: 365, slots: 5 },
        { kind: 'export_control', days: 365, slots: 3 },
        { kind: 'competitor_ipa', days: 120, slots: 2 },
        { kind: 'sector', days: 60, slots: 3 },
        { kind: 'regional', days: WINDOW_DAYS, slots: 3 },
        { kind: 'trade', days: WINDOW_DAYS, slots: 3 },
      ];
      const contextByKind = await Promise.all(
        CONTEXT_KINDS.map(({ kind, days }) => sqlc`
          select distinct on (title) context_kind, title, source,
                 coalesce(published_at, fetched_at) as at
          from items
          where source_type = 'context' and context_kind = ${kind}
            and coalesce(published_at, fetched_at) > now() - make_interval(days => ${days})
            and (sectors is null or sectors && ${c.sectors ?? []}::text[])
          order by title, coalesce(published_at, fetched_at) desc
          limit 20`),
      );
      const context = contextByKind.flatMap((rows: any, i) =>
        (rows as any[])
          .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
          .slice(0, CONTEXT_KINDS[i].slots));

      counts.context_items_seen += context.length;

      const res = await callJson<Out>({
        system: COMPANY_SIGNAL_SYSTEM,
        user: buildCompanySignalPrompt({
          companyName: c.name,
          sectors: c.sectors ?? [],
          items,
          hiring: snap ? {
            total: snap.total_jobs, nonUs: snap.non_us_jobs, apac: snap.apac_jobs,
            singapore: sgCount?.n ?? 0,
            prevTotal: snaps[1]?.total_jobs ?? null,
            execHires: execRoles.map((e: any) => `${e.title}${e.location ? ` (${e.location})` : ''}`),
          } : null,
          // What Singapore has to offer this company's sectors. The
          // partnership axis cannot be judged without it.
          capabilities: candidateProps(c.sectors ?? []).map((v) => ({
            id: v.id, title: v.title, status: v.status, fits: v.fits.slice(0, 3).join('; '),
          })),
          context: context.map((x: any) => ({
            kind: x.context_kind, title: x.title, source: x.source,
          })),
          filings: filings.map((f: any) => ({
            formType: f.form_type, filedAt: f.filed_at,
            amount: f.amount, securityType: f.security_type,
          })),
        }),
        budget,
        temperature: 0.1,
      });

      if (!res.ok || !res.data) {
        counts.failed++;
        console.warn(`  ${c.name}: FAILED — ${res.error}`);
        continue;
      }

      const d = res.data;
      const band = (v: unknown) => Math.max(0, Math.min(3, Math.round(Number(v) || 0)));
      const expansion = band(d.expansion);
      const momentum = band(d.momentum);
      const partnership = band(d.partnership);

      // The representative item MUST be one we offered: a model naming an id we
      // did not supply has invented the evidence an RD would lead with.
      const offered = new Set(items.map((i) => i.itemId));
      const repId = Number(d.representative_item);
      let representativeItemId = offered.has(repId) ? repId : null;

      /**
       * Hiring never leads while there is other news.
       *
       * The item is the opening line of an approach. "You are hiring nine
       * people in Singapore" tells a founder we have been reading their job
       * board and says nothing they do not already know — it corroborates in
       * why-now, where it belongs. A funding round, a facility or a partnership
       * is what a person would actually raise first.
       *
       * The prompt asks for this, and asking was not enough: the model led with
       * hiring for 27 of 70 companies, 22 of which had news available — one led
       * with a job posting while eighty-one news items sat unused. So the rule
       * is applied here rather than requested there.
       */
      const byId = new Map(items.map((i) => [i.itemId, i]));
      if (representativeItemId !== null
          && byId.get(representativeItemId)?.sourceType === 'ats'
          && !hiringIsNews) {
        const news = items.filter((i) => i.sourceType !== 'ats');
        if (news.length) {
          // The most corroborated, then the most recent: the same order the
          // digest ranks by, so the lead is the story that actually travelled.
          const best = [...news].sort((a, b) =>
            (b.clusterSize - a.clusterSize)
            || ((b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)))[0];
          representativeItemId = best.itemId;
          counts.hiring_lead_replaced++;
        }
      }
      if (representativeItemId === null) counts.no_representative++;

      // Points arrive as {text, item} so each keeps the item it was drawn from.
      // Plain strings are still accepted: a rescore under an older signal
      // version has no per-point ids, and losing the points would be worse than
      // falling back to the representative item for their source.
      const rawPoints = Array.isArray(d.why) ? d.why : [d.why];
      const points = rawPoints
        .map((w: unknown) => {
          if (typeof w === 'string') return { text: w.trim(), item: null as number | null };
          if (w && typeof w === 'object') {
            const o = w as { text?: unknown; item?: unknown };
            const n = Number(o.item);
            return {
              text: String(o.text ?? '').trim(),
              item: Number.isFinite(n) && offered.has(n) ? n : null,
            };
          }
          return { text: '', item: null as number | null };
        })
        .filter((p) => p.text)
        .slice(0, 4);
      const why = points.map((p) => p.text).join(' · ');
      // Positionally aligned with `why`; the representative item stands in
      // wherever the model did not name one we offered.
      const whyItemIds = points.map((p) => p.item ?? representativeItemId ?? 0);

      const hasHiring = items.some((i) => i.sourceType === 'ats');
      const hasOther = items.some((i) => i.sourceType !== 'ats');
      if (hasHiring && hasOther) counts.co_occurrence++;

      if (!dry) {
        await withRetry(() => db.insert(companySignals).values({
          companyId: c.id, weekOf, expansion, momentum, partnership,
          signalType: isSignalType(d.signal_type) ? d.signal_type : 'other',
          expansionLanguage: Boolean(d.expansion_language),
          why: why || 'no rationale returned',
          whyItemIds,
          representativeItemId,
          itemsConsidered: items.length,
          windowDays: WINDOW_DAYS,
          signalVersion: COMPANY_SIGNAL_VERSION,
          model: res.model,
        }).onConflictDoUpdate({
          target: [companySignals.companyId, companySignals.weekOf, companySignals.signalVersion],
          set: {
            expansion, momentum, partnership, why: why || 'no rationale returned',
            whyItemIds, representativeItemId, model: res.model, scoredAt: new Date(),
            signalType: isSignalType(d.signal_type) ? d.signal_type : 'other',
            expansionLanguage: Boolean(d.expansion_language),
            itemsConsidered: items.length,
          },
        }));
      }

      counts.scored++;
      counts[`expansion_${expansion}`]++;
      counts[`momentum_${momentum}`]++;
      counts[`partnership_${partnership}`]++;
      console.log(`  ${c.name}: expansion ${expansion} · momentum ${momentum} · partnership ${partnership} · ${items.length} items${representativeItemId ? '' : ' (no representative item)'}`);
    }

    Object.assign(counts, budget.summary());
    await db.update(runs).set({
      finishedAt: new Date(), counts,
      tokensIn: budget.tokensIn, tokensOut: budget.tokensOut,
      error: budget.halted ? `halted: ${budget.haltReason}` : null,
    }).where(eq(runs.id, run.id));

    console.log('\ncounts:', JSON.stringify(counts, null, 2));
    if (dry) console.log('DRY RUN — nothing written');
  } catch (e) {
    await db.update(runs)
      .set({ finishedAt: new Date(), counts, error: (e as Error).message })
      .where(eq(runs.id, run.id));
    throw e;
  }
})();
