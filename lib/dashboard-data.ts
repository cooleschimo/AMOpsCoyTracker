/**
 * Query layer for the dashboard UI. Brief §11.
 *
 * The UI was designed against a mock module exporting typed functions; this is
 * the real implementation of that surface, so the screens swap one import and
 * keep working. Shapes here mirror what the components already consume rather
 * than the database's own row shapes.
 *
 * Placement uses the same lib/placement.ts the digest does, so the dashboard
 * and the weekly email cannot drift apart on which company sits where.
 */
import { getSql } from './db';
import { weekOfSaturday, weekEnd } from './week';
import { COMPANY_SIGNAL_VERSION } from './company-signal';
import { planDigest, coverageLine, QUALIFY, type PlacementInput, type Placed } from './placement';
import { assembleWhyNow, type WhyNowInput } from './why-now';
import { candidateProps } from './proposition';
import { sectorBroadSector, isBroadSector, isSurfaceable } from './subsectors';
import { isUsState } from './scope';
import type { Band } from './company-rubric';
import type { Familiarity } from './familiarity';
import { EXPORT_CONTROLLED } from './subsectors';

export type Source = { name: string; url: string; date: string };

export type EvidencePoint = {
  id: string;
  text: string;
  signalType: string;
  origin: 'headline_signal' | 'supporting';
  source: Source;
  /**
   * The item behind this point was first fetched today.
   *
   * The pipeline runs daily and a company stays on the dashboard for as long as
   * its week's signal holds, so "is this company new" stops being a useful
   * question by Tuesday — the same names sit there all week. What changes daily
   * is the evidence: a company surfaced on Monday can pick up a fresh item on
   * Thursday, and that item is the reason to look again. Marking the POINT
   * rather than the company is what makes that visible.
   *
   * Fetched, not published: this says the pipeline saw it today, which is the
   * claim the dashboard can actually support. A story published last week and
   * found today is new to the reader.
   */
  isNew: boolean;
};

export type Assessment = {
  priority: Band;
  sgFit: Band;
  contribution: Band;
  confidence: Band;
  rationale: string;
  assessedOn: string;
  /** Why each band landed where it did. Shown on the band itself. */
  bandReasons: {
    priority: string;
    sgFit: string;
    contribution: string;
    confidence: string;
  };
};

export type DashboardCompany = {
  id: string;
  companyId: number;
  name: string;
  sector: string;
  sectors: string[];
  oneLiner: string;
  hq: string;
  /** How the location was derived, so a filed address reads differently from a guess. */
  hqSource: string | null;
  /** west_coast | other_us | non_us — the dashboard filters on this. */
  geography: 'west_coast' | 'other_us' | 'non_us';
  fundingTotal: string;
  headcount: string;
  founded: number | null;
  /**
   * When the company last raised, as a year or YYYY-MM.
   *
   * Shown where a founding year would otherwise sit: `founded_year` is
   * populated for 87 of 2,824 companies, and those are Form D filing entities
   * whose "year" is a registration date rather than a real founding. The date
   * of the last round is both better covered and more decision-relevant — how
   * recently a company raised bears on whether a window is open.
   */
  lastRound: string | null;
  valuation: { value: string; source: Source; caveat: string } | null;
  assessment: Assessment;
  trigger: {
    headline: string;
    score: 0 | 1 | 2 | 3;
    source: Source;
    /** The three axes the company was scored on. Brief §7. */
    expansion: number;
    partnership: number;
    momentum: number;
  };
  whyNow: EvidencePoint[];
  familiarity: Familiarity;
  momentum: string | null;
  warmPath: string | null;
  clusterSize: number;
  /**
   * Contribution band restated with the dimensions behind it. The card reads
   * this rather than `assessment.contribution` so a band and its drivers stay
   * together — "high" alone does not say high in what.
   */
  potentialValue: { band: Band; dimensions: string[]; confidence: Band };
  /**
   * Where each figure came from, keyed by the grid label.
   *
   * §15 asks a figure to travel with its source. Funding and valuation are
   * hand-checked CB Insights rows loaded from CSV; headcount and the round date
   * come from the same load. Naming the provider is more useful than a generic
   * caveat, and it lets a reader judge staleness themselves.
   */
  factSources: Record<string, string>;
  /** Set when an opportunity is already open, so a second approach is visible. */
  duplicateOutreach: { owner: string; since: string } | null;
  /** Export-control or similar caution to verify before approaching. */
  checkFirst: string | null;
  /** One-line summary of the strongest possible path, when one is reviewed. */
  possiblePathSummary: string | null;
  /**
   * Who on the team is watching this company, by name.
   *
   * Empty everywhere except the monitoring list, which is the only view whose
   * question is "who is looking at what". A company several people follow
   * carries several names rather than several cards.
   */
  watchers: string[];
  /**
   * Named people at the company. Shown when the graph found no path, because
   * "no path" is not an answer to "who do I call".
   */
  contacts: Array<{ name: string; title: string | null; email: string | null; profileUrl: string | null }>;
  /** Singapore's proposition for this company, selected from lib/valueprops.ts. */
  offer: {
    title: string;
    tier: 'available_now' | 'underway' | 'exploratory';
    precedent: string;
    precedentSource: Source;
    caveat?: string;
  } | null;
};

const band = (v: unknown): Band =>
  v === 'high' || v === 'medium' || v === 'low' ? v : 'unknown';

const asDate = (d: unknown): string =>
  d instanceof Date ? d.toISOString().slice(0, 10) : typeof d === 'string' ? d.slice(0, 10) : '';

/**
 * Takes dollars. Renders at the scale a reader thinks in.
 *
 * Callers hold millions — total_raised and valuation_est both — so they scale
 * up before calling rather than this guessing which unit it was handed.
 */
const money = (n: unknown): string => {
  if (n === null || n === undefined) return 'Unknown';
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 'Unknown';
  // A market cap runs to trillions, and "$1454B" is a number a reader has to
  // convert themselves.
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 2)}B`;
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
};

/**
 * Why-now points, each carrying the source it actually came from.
 *
 * A company's points are drawn from several of its scored items — its hiring
 * aggregate, its funding story, a partnership — and each was checked against
 * that item when it was scored. Attaching one blanket source to all of them
 * would cite a funding article for a claim about job postings, which breaks
 * the rule that every point is separately checkable (§10).
 *
 * `assembleWhyNow` does the merge and dedupe; this maps its output onto the
 * source each point's own item carries.
 */
function whyPoints(
  featured: {
    itemId: number;
    why: string | null;
    whyItemIds: number[];
    sourceType: string;
    publishedAt: Date | null;
  },
  siblings: WhyNowInput[],
  sourcesByItem: Map<number, Source>,
  typesByItem: Map<number, string>,
  fetchedToday: Set<number>,
  signalType: string,
  fallback: Source,
): EvidencePoint[] {
  if (!featured.why) return [];

  // Rows scored at signal-v8 or later carry the item behind each point, which
  // is exact. Older rows have none, and fall through to the merge below.
  const texts = featured.why.split(' · ').map((t) => t.trim()).filter(Boolean);
  if (featured.whyItemIds.length === texts.length) {
    return texts.map((text, i) => {
      const itemId = featured.whyItemIds[i] ?? featured.itemId;
      const src = sourcesByItem.get(itemId) ?? fallback;
      const sourceType =
        typesByItem.get(itemId) ??
        siblings.find((sb) => sb.itemId === itemId)?.sourceType ??
        featured.sourceType;
      return {
        id: `w${i}`,
        text,
        signalType: sourceType === 'ats' ? 'hiring' : signalType,
        origin: itemId === featured.itemId ? ('headline_signal' as const) : ('supporting' as const),
        source: src,
        isNew: fetchedToday.has(itemId),
      };
    });
  }

  const merged = assembleWhyNow(
    {
      itemId: featured.itemId,
      why: featured.why,
      sourceType: featured.sourceType,
      publishedAt: featured.publishedAt,
    },
    siblings,
  );
  return merged.map((p, i) => ({
    id: `w${i}`,
    text: p.text,
    // A point from a job board is hiring evidence whatever the company's
    // headline signal was; the item's own source type is the honest label.
    signalType: p.sourceType === 'ats' ? 'hiring' : signalType,
    origin: p.primary ? ('headline_signal' as const) : ('supporting' as const),
    source: sourcesByItem.get(p.itemId) ?? fallback,
    isNew: fetchedToday.has(p.itemId),
  }));
}

/**
 * Map the pipeline's subsectors onto the four `valueprops.ts` sectors.
 *
 * The two taxonomies diverged: companies now carry subsectors like
 * `ai_software` or `semiconductors`, which resolve to one of ten broad sectors,
 * while the value propositions are still written against deeptech / biotech /
 * defence_tech / ai. Without the bridge every company falls through to the
 * cross-sector props and gets the same generic offer.
 */
function valuePropSectors(sectors: string[]): string[] {
  const out = new Set<string>();
  for (const s of sectors) {
    const broad = sectorBroadSector(s) ?? (isBroadSector(s) ? s : undefined);
    switch (broad) {
      case 'ai':
      case 'digital':
        out.add('ai');
        break;
      case 'compute':
      case 'industrial':
      case 'aerospace':
        out.add('deeptech');
        break;
      case 'health':
        out.add('biotech');
        break;
      case 'defence':
        out.add('defence_tech');
        break;
      default:
        break;
    }
  }
  return [...out];
}

type Row = Record<string, unknown>;

function toCompany(
  r: Row,
  ctx?: {
    siblings: Map<number, WhyNowInput[]>;
    sources: Map<number, Source>;
    types: Map<number, string>;
    fetchedToday: Set<number>;
  },
): DashboardCompany {
  const source: Source = {
    name: String(r.source ?? 'Source'),
    url: String(r.url ?? ''),
    date: asDate(r.published_at),
  };
  const sectors = Array.isArray(r.sectors) ? (r.sectors as string[]) : [];
  return {
    id: String(r.company_id),
    companyId: Number(r.company_id),
    name: String(r.company_name ?? ''),
    // The primary, which load-sectors writes as the subsector when the
    // evidence supported one and the broad sector otherwise. 'other' is the
    // honest fallback for a company nothing has classified.
    sector: sectors[0] ?? 'other',
    sectors,
    oneLiner: String(r.one_liner ?? ''),
    hq: [r.hq_city, r.hq_state].filter(Boolean).join(', ') || 'Unknown',
  hqSource: (r.hq_source as string | null) ?? null,
  /**
   * Three buckets, because that is how the geography is actually read: the West
   * Coast is the core of the target list, the rest of the US is in scope on the
   * same terms, and everything else is worth seeing but is a different
   * conversation.
   *
   * Five of the six hq_region values are West Coast — the Bay Area, SoCal,
   * Seattle, San Diego and other_west — so the roll-up is everything except
   * other_us. Splitting the Bay Area out on its own put Seattle and San Diego
   * companies under "rest of US", which is not how anyone reads that list.
   */
  geography: (typeof r.hq_region === 'string' && r.hq_region !== 'other_us' ? 'west_coast'
    : isUsState(r.hq_state) ? 'other_us'
    : 'non_us') as 'west_coast' | 'other_us' | 'non_us',
    // Millions, like valuation_est below, so it is scaled before money(), which
    // formats dollars.
    fundingTotal: r.total_raised != null ? money(Number(r.total_raised) * 1e6) : 'Unknown',
    headcount: r.headcount_est ? String(r.headcount_est) : 'Unknown',
    founded: r.founded_year ? Number(r.founded_year) : null,
    lastRound: (() => {
      const when = r.round_date ? String(r.round_date) : null;
      // Stored in millions USD, so it needs its own formatting rather than
      // money(), which expects dollars.
      const amt = Number(r.round_amount_musd);
      const size = Number.isFinite(amt) && amt > 0
        ? amt >= 1000 ? `$${(amt / 1000).toFixed(amt >= 10000 ? 0 : 2).replace(/\.?0+$/, '')}B` : `$${Math.round(amt)}M`
        : null;
      if (size && when) return `${size} · ${when}`;
      return size ?? when;
    })(),
    valuation: r.valuation_est
      ? {
          // Stored in millions USD, like round_amount_musd and for the same
          // reason, so it is scaled before money(), which expects dollars.
          value: money(Number(r.valuation_est) * 1e6),
          source: {
            name: String(r.valuation_source ?? 'Reported'),
            url: '',
            date: asDate(r.published_at),
          },
          // The stored source already names the provider, the date and the
          // round, which is the whole of what §15 asks a figure to carry.
          caveat: String(r.valuation_source ?? 'Source not recorded'),
        }
      : null,
    assessment: {
      priority: band(r.target_priority),
      sgFit: band(r.singapore_fit),
      contribution: band(r.potential_contribution),
      confidence: band(r.confidence),
      rationale: String(r.rationale ?? ''),
      assessedOn: asDate(r.assessed_at),
      bandReasons: {
        priority: String(r.priority_reason ?? ''),
        sgFit: String(r.singapore_fit_reason ?? ''),
        contribution: String(r.contribution_reason ?? ''),
        confidence: String(r.confidence_reason ?? ''),
      },
    },
    trigger: {
      headline: String(r.title ?? ''),
      // Whichever opening is stronger, matching the rule that admitted the
      // company: a company can qualify on partnership alone, and showing its
      // expansion score would label a qualified entry 'noise'.
      score: (Math.max(Number(r.expansion) || 0, Number(r.partnership) || 0) || 0) as 0 | 1 | 2 | 3,
      source,
      expansion: Number(r.expansion) || 0,
      partnership: Number(r.partnership) || 0,
      momentum: Number(r.momentum) || 0,
    },
    whyNow: whyPoints(
      {
        itemId: Number(r.item_id),
        why: r.why as string | null,
        whyItemIds: Array.isArray(r.why_item_ids)
          ? (r.why_item_ids as unknown[]).map(Number).filter(Number.isFinite)
          : [],
        sourceType: String(r.source_type ?? 'news'),
        publishedAt: r.published_at ? new Date(r.published_at as string) : null,
      },
      ctx?.siblings.get(Number(r.company_id)) ?? [],
      ctx?.sources ?? new Map(),
      ctx?.types ?? new Map(),
      ctx?.fetchedToday ?? new Set(),
      String(r.signal_type ?? 'other'),
      source,
    ),
    familiarity: (r.familiarity as Familiarity) ?? 'unknown',
    momentum: r.momentum !== null && r.momentum !== undefined ? `${r.momentum}/3` : null,
    warmPath: (r.warm_path as string | null) ?? null,
    clusterSize: Number(r.cluster_size ?? 0),
    potentialValue: {
      band: band(r.potential_contribution),
      dimensions: Array.isArray(r.contribution_drivers) ? (r.contribution_drivers as string[]) : [],
      confidence: band(r.confidence),
    },
    watchers: Array.isArray(r.watchers)
      ? (r.watchers as string[]).filter(Boolean)
      : [],
    factSources: {
      'Total raised': String(
        r.valuation_source ? String(r.valuation_source).split(',')[0] : 'CB Insights',
      ).trim() + ', summed across recorded rounds',
      Valuation: String(r.valuation_source ?? 'Source not recorded'),
      Headcount: 'CB Insights headcount estimate',
      'Last round': String(
        r.valuation_source ? String(r.valuation_source).split(',')[0] : 'CB Insights',
      ).trim() + ', most recent recorded round',
    },
    duplicateOutreach: r.opportunity_owner
      ? { owner: String(r.opportunity_owner), since: asDate(r.opportunity_since) }
      : null,
    // Defence companies may be legally unable to site engineering abroad
    // whatever their interest (DESIGN_RATIONALE §14). The tool cannot know a
    // given company's control status, so it flags exposure to verify.
    checkFirst: (Array.isArray(r.sectors) ? (r.sectors as string[]) : [])
      .some((s) => EXPORT_CONTROLLED.includes(s))
      ? 'US export controls (ITAR/EAR) may limit siting engineering abroad. Verify before approaching.'
      : null,
    possiblePathSummary: (r.warm_path as string | null) ?? null,
    contacts: Array.isArray(r.contacts)
      ? (r.contacts as any[]).map((p) => ({
          name: String(p.name),
          title: (p.title as string | null) ?? null,
          email: (p.contact_email as string | null) ?? null,
          profileUrl: (p.profile_url as string | null) ?? null,
        }))
      : [],
    // The digest has a model write a sentence per company; nothing stores it, so
    // the dashboard selects the same candidate deterministically from
    // valueprops.ts and shows the proposition as written there. Everything here
    // is publicly sourced and dated, and no claim is invented at read time.
    offer: (() => {
      const props = candidateProps(valuePropSectors(sectors));
      const top = props[0];
      if (!top) return null;
      return {
        title: top.title,
        tier:
          top.status === 'established'
            ? ('available_now' as const)
            : top.status === 'committed'
              ? ('underway' as const)
              : ('exploratory' as const),
        // The first evidence line is the precedent: what Singapore has already
        // done in this space, stated rather than linked (§10).
        precedent: top.evidence[0] ?? '',
        precedentSource: { name: 'lib/valueprops.ts', url: '', date: '' },
        ...(top.avoidWhen[0] ? { caveat: top.avoidWhen[0] } : {}),
      };
    })(),
  };
}

/**
 * Every company carrying a signal this week, with the item it leads with and
 * its latest assessment. The lateral join keeps a company whose assessment has
 * not been written yet, so it shows as 'unknown' rather than vanishing.
 */
/**
 * Every scored item for the companies in `rows`, so a why-now point can cite the
 * item it came from rather than the one the company leads with.
 */
/**
 * What counts as newly arrived, in SQL.
 *
 * The PUBLISHED date, not the fetch date. A story published nine days ago that
 * today's pull happened to reach is not news to the reader — and one run
 * brought in items back three weeks, so a fetch-based rule marks those as new
 * every time a feed surfaces something old.
 *
 * The window is the gap since the PREVIOUS ingest, not a fixed number of days.
 * That is the only definition that holds on every day of the week: on a Tuesday
 * it reaches back to Monday's run, and on a Monday it reaches back to Sunday's
 * — or, if the weekend was missed, to Friday's, which is exactly when a reader
 * wants the weekend included. A fixed three-day window gets Monday right and
 * then keeps showing the weekend all week.
 *
 * Capped at seven days so a long outage cannot mark a fortnight of news as new,
 * and floored at six hours so two runs in one morning do not blank the mark.
 * An item with no published date falls back to when it was fetched, that being
 * the only date it has.
 */
const NEW_WINDOW_MAX_DAYS = 7;
const NEW_WINDOW_MIN_HOURS = 6;

/**
 * The start of the previous ingest, which is the moment the reader last had a
 * chance to see anything. `ingest_news` is the pull that brings company news
 * in; the run in progress is skipped, since its own items are the ones being
 * marked.
 */
const PREVIOUS_RUN = `
  greatest(
    least(
      coalesce(
        (select max(r.started_at) from runs r
          where r.stage = 'ingest_news'
            and r.started_at < (select max(r2.started_at) from runs r2 where r2.stage = 'ingest_news')),
        now() - interval '${NEW_WINDOW_MAX_DAYS} days'),
      now() - interval '${NEW_WINDOW_MIN_HOURS} hours'),
    now() - interval '${NEW_WINDOW_MAX_DAYS} days')`;

const arrivedRecently = (col: string) => `
  coalesce(${col}.published_at, ${col}.fetched_at) >= (${PREVIOUS_RUN})`;

async function whyNowContext(
  rows: Row[],
  signalVersion: string,
): Promise<{
  siblings: Map<number, WhyNowInput[]>;
  sources: Map<number, Source>;
  types: Map<number, string>;
  fetchedToday: Set<number>;
}> {
  const siblings = new Map<number, WhyNowInput[]>();
  const sources = new Map<number, Source>();
  const types = new Map<number, string>();
  const fetchedToday = new Set<number>();
  const companyIds = rows.map((r) => Number(r.company_id)).filter(Number.isFinite);
  if (!companyIds.length) return { siblings, sources, types, fetchedToday };

  const sql = getSql();

  // Fetch the items the why points actually cite, by id. Inferring them from
  // representative items or scores rows misses most of them: a point can come
  // from any item the company scorer was shown, and those are ordinary items
  // with no row of their own here.
  const citedIds = Array.from(
    new Set(
      rows.flatMap((r) =>
        Array.isArray(r.why_item_ids) ? (r.why_item_ids as unknown[]).map(Number) : [],
      ),
    ),
  ).filter((n) => Number.isFinite(n) && n > 0);

  if (citedIds.length) {
    const cited: any = await sql`
      select id as item_id, source, url, source_type, published_at,
             ${sql.unsafe(arrivedRecently('items'))} as fetched_today
      from items where id = any(${citedIds})`;
    for (const row of cited as Row[]) {
      if (row.fetched_today) fetchedToday.add(Number(row.item_id));
      sources.set(Number(row.item_id), {
        name: String(row.source ?? 'Source'),
        url: String(row.url ?? ''),
        date: asDate(row.published_at),
      });
      types.set(Number(row.item_id), String(row.source_type ?? 'news'));
    }
  }

  /*
   * Both read items for the same companies and neither reads the other, so they
   * are issued together. Awaited in turn they doubled this function's share of
   * the page's load for nothing.
   */
  const [others, scored]: any = await Promise.all([
    sql`
    select cs.company_id, cs.why, i.id as item_id, i.source, i.url,
           i.source_type, i.published_at,
           ${sql.unsafe(arrivedRecently('i'))} as fetched_today
    from company_signals cs
    join items i on i.id = cs.representative_item_id
    where cs.signal_version = ${signalVersion}
      and cs.company_id = any(${companyIds})`,
    sql`
    select ic.company_id, s.why, i.id as item_id, i.source, i.url,
           i.source_type, i.published_at,
           ${sql.unsafe(arrivedRecently('i'))} as fetched_today
    from scores s
    join items i on i.id = s.item_id
    join item_companies ic on ic.item_id = i.id
    where ic.company_id = any(${companyIds}) and i.status = 'kept'
    order by i.published_at desc nulls last
    limit 2000`,
  ]);


  for (const row of [...(others as Row[]), ...(scored as Row[])]) {
    const itemId = Number(row.item_id);
    if (!sources.has(itemId)) {
      sources.set(itemId, {
        name: String(row.source ?? 'Source'),
        url: String(row.url ?? ''),
        date: asDate(row.published_at),
      });
    }
    const cid = Number(row.company_id);
    const arr = siblings.get(cid) ?? [];
    if (!arr.some((x) => x.itemId === itemId)) {
      arr.push({
        itemId,
        why: String(row.why ?? ''),
        sourceType: String(row.source_type ?? 'news'),
        publishedAt: row.published_at ? new Date(row.published_at as string) : null,
      });
    }
    siblings.set(cid, arr);
  }
  // Every route that produced an item also records whether it arrived today,
  // so a supporting point is markable as well as a headline one.
  for (const row of [...(others as Row[]), ...(scored as Row[])]) {
    if (row.fetched_today) fetchedToday.add(Number(row.item_id));
  }

  return { siblings, sources, types, fetchedToday };
}

async function signalRows(signalVersion: string, weekOf?: string): Promise<Row[]> {
  const sql = getSql();
  const rows: any = await sql`
    select
      cs.company_id, c.name as company_name, c.familiarity, c.sectors,
      c.description, c.one_liner, c.hq_city, c.hq_state, c.hq_region, c.total_raised, c.headcount_est,
      c.founded_year, c.hq_source, c.round_date, c.round_stage, c.round_amount_musd, c.valuation_est, c.valuation_source,
      cs.expansion, cs.momentum, cs.partnership, cs.signal_type,
      cs.expansion_language, cs.why, cs.why_item_ids, cs.week_of,
      i.id as item_id, i.title, i.url, i.source, i.source_type, i.published_at,
      ca.target_priority, ca.singapore_fit, ca.potential_contribution,
      ca.contribution_drivers, ca.confidence, ca.rationale, ca.assessed_at,
      ca.priority_reason, ca.singapore_fit_reason, ca.contribution_reason,
      ca.confidence_reason,
      (select count(*)::int from items d where d.cluster_id = i.id) as cluster_size,
      (select pr.note from path_reviews pr
        where pr.company_id = cs.company_id and pr.status = 'confirmed'
          and coalesce(pr.do_not_use, false) = false
        order by pr.confirmed_at desc limit 1) as warm_path,
      /*
       * Who to contact when the graph has no path. "No path found" is true but
       * useless — the named people at the company are the fallback an RD would
       * reach for anyway, so they are carried here rather than left one click
       * away. Reachable people first: a name with an email or a profile is
       * actionable where a bare name is a starting point.
       */
      (select json_agg(x order by x.rank, x.name) from (
         -- One row per PERSON, not per role: someone who has held two roles at
         -- the same company has two rows here, and listing them twice is a
         -- duplicate in the reader's list rather than a display detail.
         select distinct on (p.id)
                p.name, coalesce(p.title, nullif(ro.role_raw, '')) as title,
                p.contact_email, p.profile_url,
                case when p.contact_email is not null then 0
                     when p.profile_url is not null then 1 else 2 end as rank
         from roles ro join people p on p.id = ro.person_id
         where ro.company_id = cs.company_id
           -- The people extractor sometimes lifts a product or partner name off
           -- a page. A person has a forename and a surname and is not the
           -- company itself; anything else is not someone to write to.
           and p.name ~ '^[A-Z][a-z]+ [A-Z]'
           and p.name <> c.name
           and p.name !~* '(cloud|aws|azure|foundry|powered by|claude|api|platform|inc\.?$|llc$)'
         -- distinct on needs the deduped column to lead; current roles first so
         -- the surviving row is the one still true.
         order by p.id, ro.last_seen desc nulls last
         limit 4) x) as contacts,
      (select o.owner from opportunities o
        where o.company_id = cs.company_id and o.status not in ('closed','dropped')
        order by o.created_at limit 1) as opportunity_owner,
      (select o.created_at from opportunities o
        where o.company_id = cs.company_id and o.status not in ('closed','dropped')
        order by o.created_at limit 1) as opportunity_since
    from company_signals cs
    join companies c on c.id = cs.company_id
    join items i on i.id = cs.representative_item_id
    left join lateral (
      select * from company_assessments a
      where a.company_id = cs.company_id
      order by a.assessed_at desc limit 1
    ) ca on true
    where cs.signal_version = ${signalVersion}
      -- Judged not to be a company EDB could attract, or not a company at all.
      -- Every other read applies this; without it a row retired by review kept
      -- its place on the page, because placement reads the signal rather than
      -- the company behind it.
      and coalesce(c.scope_status, 'unknown') <> 'out_of_scope'
      and coalesce(c.discovered_via, '') <> 'portfolio'
      -- One week, and by default the latest. Signals accumulate week on week,
      -- and without this the dashboard showed every week at once: a company
      -- scored a fortnight ago sat beside one scored today, both reading as
      -- current. An explicit week is how the archive is read.
      and cs.week_of = coalesce(
        ${weekOf ?? null}::date,
        (select max(week_of) from company_signals where signal_version = ${signalVersion}))
      /*
       * A week's page shows companies that did something THAT WEEK.
       *
       * The scoring window is thirty days, so a company scored on Monday can be
       * carried by a story from three weeks earlier and still read as this
       * week's news. Fifty-five of the current week's signals had no item
       * published inside the week at all.
       *
       * Published in the week or first seen in it. An ATS aggregate has no
       * publication date by construction, and ordinary news is often found
       * days after it ran, so both dates count.
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
            -- all of it onto the current page. Five days covers the ordinary
            -- lag without letting a story from a previous week read as this
            -- week's news.
            or (
              w.fetched_at >= cs.week_of and w.fetched_at < cs.week_of + 7
              and (w.published_at is null or w.published_at >= cs.week_of - 5)
            )
          ))
    order by cs.expansion desc, cs.momentum desc`;
  /*
   * Funds, REITs, insurers and the rest are dropped here rather than in the
   * query, so the rule lives once in lib/subsectors.ts beside the taxonomy that
   * defines it. Repeating the six ids in SQL is how the search list and the
   * surface list drift apart.
   *
   * They are still scored and still stored — a fund's news is what tells us a
   * portfolio company raised. It is the dashboard they do not belong on.
   */
  const surfaceable = (rows as Row[]).filter((r) => isSurfaceable(r.sectors as string[] | null));

  /*
   * Anything §7b's review found to be no company at all — a headline fragment
   * taken for a name, or one row collecting stories about a dozen different
   * companies. A proposed duplicate is NOT hidden: the merge target may be
   * wrong, and hiding a real company on a guess is worse than showing it twice
   * until someone confirms.
   */
  const hidden: any = await sql`
    select company_id from company_reviews
    where hide_from_dashboard = true and resolved_at is null`;
  const hide = new Set<number>(hidden.map((h: any) => Number(h.company_id)));

  const dismissal = await dismissalFilter();
  return surfaceable.filter(
    (r) => !hide.has(Number(r.company_id))
      && dismissal(Number(r.company_id), r.published_at as string | Date | null),
  );
}

/**
 * Companies an RD has dismissed, as a predicate over (company, signal date).
 *
 * A dismissal was written down and never read, so the same company cleared the
 * same bar the following week and came back — the reader's judgment survived in
 * the table and not on the page.
 *
 * What a dismissal means depends on the reason it carries, and the two kinds
 * cannot be suppressed alike:
 *
 *  - 'irrelevant_company' and 'no_sg_angle' are verdicts about the company.
 *    Nothing it does next week changes them, so they hold until someone
 *    revisits the row.
 *  - 'too_early' and 'already_tracked' are about the moment. A company
 *    dismissed as too early is exactly the one worth showing when it raises a
 *    larger round, so these hold only against the news already seen: a signal
 *    published after the dismissal surfaces the company again.
 *
 * A dismissal carrying no reason is read as being about the moment, that being
 * the weaker of the two claims.
 *
 * Shared by the dashboard and the digest, which build their rows from separate
 * queries: a company dismissed on the page would otherwise still arrive in the
 * week's email.
 */
export async function dismissalFilter(): Promise<
  (companyId: number, publishedAt: string | Date | null) => boolean
> {
  const sql = getSql();
  const rows: any = await sql`
    select company_id, reasons, created_at from dispositions
    where disposition = 'dismiss' and company_id is not null`;

  const ABOUT_THE_COMPANY = ['irrelevant_company', 'no_sg_angle'];
  const forever = new Set<number>();
  const until = new Map<number, Date>();
  for (const d of rows) {
    const id = Number(d.company_id);
    const reasons: string[] = Array.isArray(d.reasons) ? d.reasons : [];
    if (reasons.some((x) => ABOUT_THE_COMPANY.includes(x))) { forever.add(id); continue; }
    const at = new Date(d.created_at as string);
    const prev = until.get(id);
    if (!prev || at > prev) until.set(id, at);
  }

  return (companyId, publishedAt) => {
    if (forever.has(companyId)) return false;
    const cutoff = until.get(companyId);
    if (!cutoff) return true;
    // News newer than the dismissal is a new reason to look.
    const published = publishedAt ? new Date(publishedAt as string) : null;
    return published !== null && published > cutoff;
  };
}

const toPlacementInput = (r: Row): PlacementInput => ({
  itemId: Number(r.item_id),
  companyId: Number(r.company_id),
  companyName: String(r.company_name ?? ''),
  expansion: Number(r.expansion) || 0,
  momentum: Number(r.momentum) || 0,
  partnership: Number(r.partnership) || 0,
  signalType: String(r.signal_type ?? 'other'),
  sourceType: String(r.source_type ?? 'news'),
  targetPriority: (r.target_priority as Band) ?? null,
  singaporeFit: (r.singapore_fit as Band) ?? null,
  familiarity: (r.familiarity as Familiarity) ?? null,
  publishedAt: r.published_at ? new Date(r.published_at as string) : null,
  clusterSize: Number(r.cluster_size ?? 0),
  roundStage: (r.round_stage as string | null) ?? null,
  // valuation_est is millions; the field is dollars, and the early-stage cap it
  // feeds is 5e9. Unscaled, no stored valuation could ever exceed that cap.
  valuationUsd: r.valuation_est != null ? Number(r.valuation_est) * 1e6 : null,
  roundAmountMusd: r.round_amount_musd != null ? Number(r.round_amount_musd) : null,
  // A US state code means the US; anything else is the country itself, which is
  // what marks a Singapore company as not a target.
  hqCountry: isUsState(r.hq_state)
    ? 'United States' : (r.hq_state as string | null) ?? null,
  hqCity: (r.hq_city as string | null) ?? null,
  title: (r.title as string | null) ?? null,
  snippet: (r.snippet as string | null) ?? null,
});

export type WeeklyDigest = {
  weekLabel: string;
  coverage: string;
  /** The same three numbers as `coverage`, for a stat row rather than a sentence. */
  coverageStats: {
    /** Standing totals, since the tool started. */
    monitored: number; processed: number; everSurfaced: number;
    /** This week only. */
    surfaced: number; readThisWeek: number; scoredThisWeek: number;
  };
  /** A real trigger at a company the tool can argue for. */
  worthAConversation: DashboardCompany[];
  /** Assessed, and argued down — a low band is still a judgment worth showing. */
  newOnTheRadar: DashboardCompany[];
  whoWeKnow: DashboardCompany[];
  /** Cleared the trigger bar, but nobody has assessed them yet. A backlog. */
  awaitingAssessment: DashboardCompany[];
  /** Assessed, and rated low on priority or Singapore fit. */
  lowFit: DashboardCompany[];
  monitoring: DashboardCompany[];
  /**
   * A company the tool rates highly with nothing to act on this week.
   *
   * Distinct from `monitoring`, which is a standing choice a person made and
   * keeps until they undo it. This is derived fresh each run: the assessment
   * says EDB should care, and the week produced no trigger worth leading with.
   */
  toWatch: DashboardCompany[];
};

/** This week's digest, placed by the same rules the email uses. */
/**
 * Every week the tool has scored, newest first.
 *
 * A digest is a record of what was known that week, and re-running the pipeline
 * later cannot reconstruct it — the news window has moved on and the scoring
 * rubric may have changed. So the weeks are kept and made reachable rather than
 * only ever showing the latest.
 */
export async function availableWeeks(
  signalVersion = COMPANY_SIGNAL_VERSION,
): Promise<Array<{ weekOf: string; label: string; companies: number }>> {
  const sql = getSql();
  const rows: any = await sql`
    select week_of, count(distinct company_id)::int as companies
    from company_signals
    where signal_version = ${signalVersion}
    group by week_of
    order by week_of desc`;
  return rows.map((r: any) => ({
    // The driver hands back a Date for a date column, whose toString is a
    // human format — an ISO slice of it produces "Mon Aug 31" rather than a
    // date the query can use.
    weekOf: new Date(r.week_of).toISOString().slice(0, 10),
    label: weekLabel(r.week_of),
    companies: Number(r.companies),
  }));
}

export async function getWeeklyDigest(
  signalVersion = COMPANY_SIGNAL_VERSION,
  weekOf?: string,
  /**
   * What Singapore could offer is withheld from a guest.
   *
   * Stripped here rather than hidden in the component: a card that renders
   * without the block still carries it in the HTML the server sends, so the
   * proposition would be one view-source away. The reader sees the week; the
   * argument for approaching a company needs an account.
   */
  opts?: { withOffer?: boolean },
): Promise<WeeklyDigest> {
  const rows = await signalRows(signalVersion, weekOf);
  const byCompany = new Map<number, Row>();
  for (const r of rows) byCompany.set(Number(r.company_id), r);

  const plan = planDigest(rows.map(toPlacementInput));
  const ctx = await whyNowContext(rows, signalVersion);
  // Opt IN, not opt out. Defaulting this to true meant a page that simply did
  // not pass the option leaked the proposition — which is how
  // /awaiting-assessment shipped it to guests while / withheld it.
  const withOffer = opts?.withOffer === true;
  const pick = (placed: Placed[]) =>
    placed
      .map((p) => (p.companyId === null ? null : byCompany.get(p.companyId)))
      .filter((r): r is Row => Boolean(r))
      .map((r) => {
        const c = toCompany(r, ctx);
        return withOffer ? c : { ...c, offer: null };
      });

  const sql = getSql();
  // Companies actually watched, not every row in the table. Portfolio scraping
  // fills the graph with thousands of names that are never fetched for news or
  // scored, and counting those would claim coverage the tool does not have.
  /*
   * The counts and the monitoring list, together rather than one after another.
   *
   * None of them reads another's result, but each was awaited in turn, so the
   * page paid the sum of six round trips to a database in another region — ten
   * seconds before a filter click showed anything, on queries that are a few
   * hundred milliseconds each. Issued together they cost about the slowest one.
   */
  const [
    [{ companies = 0 } = {}],
    [{ ever_surfaced: everSurfaced = 0 } = {}],
    [{ signals = 0 } = {}],
    [{ read = 0 } = {}],
    [{ scored = 0 } = {}],
    monitoring,
  ]: any = await Promise.all([
    // Everything except portfolio counts, whatever route found it — naming
    // origins here made the figure drift every time ingestion grew.
    sql`
      select count(*)::int as companies from companies c
      where coalesce(c.discovered_via, '') <> 'portfolio'
        and coalesce(c.scope_status, 'unknown') <> 'out_of_scope'`,
    /*
     * Distinct companies ever surfaced, not a sum of weekly counts. A company
     * that qualifies three weeks running is one company an RD could have been
     * told about, and adding the weeks up would claim three.
     *
     * The bar is QUALIFY, the same threshold that admits a company to a
     * discovery section. Replaying the full placement over history is not
     * possible — it reads assessments as they stand now, not as they stood then
     * — but the trigger bar is what decides whether a company reached the page.
     */
    sql`
      select count(distinct company_id)::int as ever_surfaced
      from company_signals
      where greatest(expansion, partnership) >= ${QUALIFY.minTopAxis}
        and momentum >= ${QUALIFY.minMomentum}`,
    sql`select count(*)::int as signals from items where status <> 'fetched'`,
    /*
     * The same reading, for this week alone.
     *
     * The three figures used to mix spans without saying so: two counted
     * everything since the tool started and one counted the current week, which
     * read as one sentence and measured three different things. Both are worth
     * knowing — what the week produced, and how much stands behind it — so both
     * are carried and the UI separates them.
     */
    sql`
      select count(*)::int as read from items
      where status <> 'fetched'
        and coalesce(published_at, fetched_at) > now() - interval '7 days'`,
    sql`
      select count(distinct company_id)::int as scored from company_signals
      where signal_version = ${signalVersion}
        and week_of = coalesce(${weekOf ?? null}::date,
          (select max(week_of) from company_signals where signal_version = ${signalVersion}))`,
    getMonitoredCompanies(signalVersion, { withOffer: opts?.withOffer === true }),
  ]);

  const worthAConversation = pick(plan.sections.worth_a_conversation);
  const newOnTheRadar = pick(plan.sections.new_on_the_radar);
  // Account activity: companies EDB already holds or is talking to, where
  // something moved this week.
  const whoWeKnow = pick(plan.sections.who_we_know);
  // The assessment backlog. Not a verdict, so it is kept apart from the bands
  // and given its own page rather than a slot in the weekly read.
  const awaitingAssessment = pick(plan.sections.awaiting_assessment);
  const lowFit = pick(plan.sections.low_fit);
  // Rated worth caring about, but nothing happened this week worth leading
  // with. Kept visible so a quiet week reads as quiet rather than as absence.
  const toWatch = pick(plan.sections.to_watch);

  return {
    weekLabel: weekLabel(rows[0]?.week_of as string | undefined),
    coverage: coverageLine(Number(companies), Number(signals), worthAConversation.length + newOnTheRadar.length),
    coverageStats: {
      monitored: Number(companies),
      processed: Number(signals),
      everSurfaced: Number(everSurfaced),
      surfaced: worthAConversation.length + newOnTheRadar.length,
      readThisWeek: Number(read),
      scoredThisWeek: Number(scored),
    },
    worthAConversation,
    newOnTheRadar,
    whoWeKnow,
    awaitingAssessment,
    lowFit,
    monitoring,
    toWatch,
  };
}

/**
 * The week being reported on, as a date range.
 *
 * The digest goes out on a Monday about the week that just ended, so this is
 * the previous Monday to Sunday rather than the current week. The month is
 * repeated when a range spans two — "29 September – 5 October" reads wrong
 * without it.
 */
function weekLabel(weekOf?: string | Date | null): string {
  // The week the SIGNALS are from, not the week it happens to be read in. A
  // label computed from today drifts away from the data it sits above the
  // moment a run lands on a different day than the reader opens the page.
  //
  // The fallback is THIS week, because that is what score-companies stamps: it
  // writes the current Saturday, so a dashboard with no row to read from should
  // name the week it is being read in rather than the one before it. The digest
  // is the place that looks back a week; see scripts/render-digest.ts.
  //
  // Weeks run Saturday to Friday — lib/week.ts says why. The label is built
  // here rather than taken from weekRangeLabel because the dashboard carries
  // the year and the digest does not.
  // A Date from the driver, or a YYYY-MM-DD string from the URL: normalise
  // through the string form so both land on UTC midnight.
  const sat = weekOf
    ? new Date(`${(weekOf instanceof Date ? weekOf.toISOString() : String(weekOf)).slice(0, 10)}T00:00:00Z`)
    : new Date(`${weekOfSaturday()}T00:00:00Z`);
  const fri = weekEnd(sat);
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });
  const sameMonth = sat.getUTCMonth() === fri.getUTCMonth();
  const from = sameMonth ? fmt(sat, { day: 'numeric' }) : fmt(sat, { day: 'numeric', month: 'long' });
  return `${from} – ${fmt(fri, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/** Companies an RD chose to monitor, with their signal row when one exists. */
export async function getMonitoredCompanies(
  signalVersion = COMPANY_SIGNAL_VERSION,
  /** As getWeeklyDigest: a guest reads the week without the proposition. */
  opts?: { withOffer?: boolean },
): Promise<DashboardCompany[]> {
  const sql = getSql();
  const rows: any = await sql`
    select c.id as company_id, c.name as company_name, c.familiarity, c.sectors,
           c.description, c.one_liner, c.hq_city, c.hq_state, c.hq_region, c.total_raised, c.headcount_est,
           c.founded_year, c.hq_source, c.round_date, c.round_stage, c.round_amount_musd, c.valuation_est, c.valuation_source,
           m.added_at, m.note,
           (select array_agg(distinct u.name order by u.name)
              from monitoring m2 join users u on u.id = m2.user_id
             where m2.company_id = m.company_id and m2.removed_at is null) as watchers,
           cs.expansion, cs.momentum, cs.partnership, cs.signal_type, cs.why,
           cs.why_item_ids,
           i.id as item_id, i.title, i.url, i.source, i.source_type, i.published_at,
           ca.target_priority, ca.singapore_fit, ca.potential_contribution,
           ca.confidence, ca.rationale, ca.assessed_at,
           ca.priority_reason, ca.singapore_fit_reason, ca.contribution_reason,
           ca.confidence_reason,
           0 as cluster_size, null as warm_path
    from monitoring m
    join companies c on c.id = m.company_id
    left join lateral (
      select * from company_signals s
      where s.company_id = m.company_id and s.signal_version = ${signalVersion}
      limit 1
    ) cs on true
    left join items i on i.id = cs.representative_item_id
    left join lateral (
      select * from company_assessments a
      where a.company_id = m.company_id
      order by a.assessed_at desc limit 1
    ) ca on true
    where m.removed_at is null
    -- One card per company however many people watch it. Without this a company
    -- three colleagues follow arrives three times, which reads as a duplicate
    -- rather than as agreement.
    group by c.id, c.name, c.familiarity, c.sectors, c.description, c.one_liner,
             c.hq_city, c.hq_state, c.hq_region, c.total_raised, c.headcount_est,
             c.founded_year, c.hq_source, c.round_date, c.round_stage,
             c.round_amount_musd, c.valuation_est, c.valuation_source,
             m.company_id, m.added_at, m.note, cs.expansion, cs.momentum,
             cs.partnership, cs.signal_type, cs.why, cs.why_item_ids,
             i.id, i.title, i.url, i.source, i.source_type, i.published_at,
             ca.target_priority, ca.singapore_fit, ca.potential_contribution,
             ca.confidence, ca.rationale, ca.assessed_at, ca.priority_reason,
             ca.singapore_fit_reason, ca.contribution_reason, ca.confidence_reason
    order by max(m.added_at) desc`;
  const ctx = await whyNowContext(rows as Row[], signalVersion);
  // Opt in, as getWeeklyDigest.
  const withOffer = opts?.withOffer === true;
  return (rows as Row[]).map((r) => {
    const c = toCompany(r, ctx);
    return withOffer ? c : { ...c, offer: null };
  });
}

/** One company in full, for /company/[id]. */
export async function getCompany(id: string | number): Promise<DashboardCompany | null> {
  const rows = await signalRows(COMPANY_SIGNAL_VERSION);
  const hit = rows.find((r) => String(r.company_id) === String(id));
  return hit ? toCompany(hit) : null;
}

export type IngestSource = {
  id: string;
  name: string;
  kind: string;
  lastRun: string;
  itemsThisRun: number;
  trailingAverage: number;
  anomaly: 'none' | 'spike' | 'drop' | 'silent';
};

/** Source health for /admin/sources. */
export async function getSourceHealth(): Promise<IngestSource[]> {
  const sql = getSql();
  const rows: any = await sql`
    select source, source_type, last_run_at, last_success_at, last_count, trailing_avg, status
    from source_health order by source`;
  return (rows as Row[]).map((r) => {
    const last = Number(r.last_count ?? 0);
    const avg = Number(r.trailing_avg ?? 0);
    // A source quietly returning nothing is the failure this page exists for,
    // so silence outranks a volume swing.
    const anomaly: IngestSource['anomaly'] =
      last === 0 ? 'silent' : avg > 0 && last > avg * 2 ? 'spike' : avg > 0 && last < avg / 2 ? 'drop' : 'none';
    return {
      id: String(r.source),
      name: String(r.source),
      kind: String(r.source_type ?? 'news'),
      lastRun: asDate(r.last_success_at ?? r.last_run_at),
      itemsThisRun: last,
      trailingAverage: Math.round(avg),
      anomaly,
    };
  });
}

export type Opportunity = {
  id: string;
  companyId: string;
  company: string;
  owner: string;
  status: string;
  nextAction: string;
  dueDate: string;
};

/** Open opportunities for /inbox. */
export async function getOpportunities(): Promise<Opportunity[]> {
  const sql = getSql();
  const rows: any = await sql`
    select o.id, o.company_id, c.name, o.owner, o.status, o.next_action, o.due_date
    from opportunities o join companies c on c.id = o.company_id
    where o.status not in ('closed', 'dropped')
    order by o.due_date nulls last, o.created_at desc`;
  return (rows as Row[]).map((r) => ({
    id: String(r.id),
    companyId: String(r.company_id),
    company: String(r.name ?? ''),
    owner: String(r.owner ?? 'Unassigned'),
    status: String(r.status ?? 'open'),
    nextAction: String(r.next_action ?? '—'),
    dueDate: asDate(r.due_date),
  }));
}

/** Per-stage drop counts and score distribution for /admin/stats. */
export async function getStats() {
  const sql = getSql();
  const drops: any = await sql`
    select coalesce(dropped_reason, status) as reason, count(*)::int as n
    from items group by 1 order by 2 desc limit 12`;
  const dist: any = await sql`
    select s.expansion as score, count(*)::int as n
    from company_signals s where s.signal_version = ${COMPANY_SIGNAL_VERSION}
    group by 1 order by 1`;
  const dispositions: any = await sql`
    select disposition, count(*)::int as n from dispositions group by 1`;
  const reasons: any = await sql`
    select unnest(reasons) as reason, count(*)::int as n from dispositions group by 1`;
  return {
    funnel: (drops as Row[]).map((r) => ({ stage: String(r.reason), n: Number(r.n) })),
    scoreDistribution: (dist as Row[]).map((r) => ({ score: Number(r.score), n: Number(r.n) })),
    dispositions: (dispositions as Row[]).map((r) => ({
      disposition: String(r.disposition),
      n: Number(r.n),
    })),
    reasonMix: (reasons as Row[]).map((r) => ({ reason: String(r.reason), n: Number(r.n) })),
  };
}

/* ------------------------------------------------------------------ */
/* Graph                                                               */
/* ------------------------------------------------------------------ */

export type GraphNode = {
  id: string;
  label: string;
  kind: 'hub' | 'person' | 'investor' | 'sg_entity';
  /** How many paths run through this node — the reason to approach it first. */
  degree: number;
  sector?: string;
};

export type GraphEdge = {
  source: string;
  target: string;
  feasibility: 'confirmed' | 'plausible' | 'weak';
  label: string;
};

export type CompanyGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

/**
 * The paths around one company, as a node-link graph.
 *
 * Feasibility follows the same rule the list uses: a reviewed path outranks any
 * unreviewed inference, and below that the score carries it. Nothing here is
 * called a warm introduction — an unreviewed edge is an association.
 */
export async function getCompanyGraph(companyId: number): Promise<CompanyGraph> {
  const { findWarmPaths } = await import('./paths');
  const sql = getSql();
  const [company]: any = await sql`select id, name, sectors from companies where id = ${companyId}`;
  if (!company) return { nodes: [], edges: [] };

  const paths = await findWarmPaths(companyId);
  const hubId = `c${companyId}`;
  const nodes = new Map<string, GraphNode>([
    [
      hubId,
      {
        id: hubId,
        label: String(company.name),
        kind: 'hub',
        degree: paths.length,
        sector: Array.isArray(company.sectors) ? company.sectors[0] : undefined,
      },
    ],
  ]);
  const edges: GraphEdge[] = [];

  const feasibilityOf = (p: { reviewStatus: string; score: number }): GraphEdge['feasibility'] => {
    if (p.reviewStatus === 'confirmed' || p.reviewStatus === 'usable') return 'confirmed';
    return p.score >= 2 ? 'plausible' : 'weak';
  };

  /*
   * A path reaches its destination through a connector, or directly.
   *
   * A company-to-company edge — an acquisition, a partnership — runs hub to
   * target with nobody in between, so `viaId` is null and the walk below joins
   * the hub straight to the far company. Requiring a connector dropped those
   * paths from the graph entirely: the list beside it named companies that had
   * no node.
   */
  for (const p of paths) {
    const viaId = p.viaPersonId
      ? `p${p.viaPersonId}`
      : p.viaOrgId
        ? `o${p.viaOrgId}`
        : null;

    if (viaId) {
      const existing = nodes.get(viaId);
      if (existing) existing.degree += 1;
      else
        nodes.set(viaId, {
          id: viaId,
          label: p.viaPersonName ?? p.viaOrgName ?? 'Unknown',
          kind: p.viaPersonId ? 'person' : 'investor',
          degree: 1,
        });

      edges.push({
        source: hubId,
        target: viaId,
        feasibility: feasibilityOf(p),
        label: p.description,
      });
    }

    if (p.targetCompanyId && p.targetCompanyName) {
      const endId = `c${p.targetCompanyId}`;
      const end = nodes.get(endId);
      if (end) end.degree += 1;
      else
        nodes.set(endId, {
          id: endId,
          label: p.targetCompanyName,
          kind: 'sg_entity',
          degree: 1,
        });
      // From the connector where there is one, from the company itself where
      // the relationship is direct.
      edges.push({
        source: viaId ?? hubId,
        target: endId,
        feasibility: feasibilityOf(p),
        label: viaId ? p.evidence : p.description,
      });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

export type PathRow = {
  id: string;
  kind: string;
  description: string;
  evidence: string;
  sourceUrl: string | null;
  feasibility: 'confirmed' | 'plausible' | 'weak';
  reviewStatus: string;
  viaPersonName: string | null;
  viaOrgName: string | null;
  /** The company at the far end, so its name can link to its own page. */
  targetCompanyId: number | null;
  targetCompanyName: string | null;
  /**
   * The edges this path actually runs along, as `from|to` node-id pairs.
   *
   * The graph cannot infer them from `nodeIds`: several paths share a connector
   * and a destination, so any edge between two of a path's nodes lit up whether
   * or not it belonged to that path.
   */
  edgeKeys: string[];
  /**
   * The graph nodes this path runs through, using the same ids getCompanyGraph
   * assigns. Selecting a row can then light up its own edges rather than every
   * path that happens to go through a person.
   */
  nodeIds: string[];
};

/** The ranked path list for a company. Brief §8. */
export async function getCompanyPaths(companyId: number): Promise<PathRow[]> {
  const { findWarmPaths } = await import('./paths');
  const paths = await findWarmPaths(companyId);
  return paths.map((p, i) => ({
    id: `path-${companyId}-${i}`,
    kind: p.kind,
    description: p.description,
    evidence: p.evidence,
    sourceUrl: p.sourceUrl,
    feasibility:
      p.reviewStatus === 'confirmed' || p.reviewStatus === 'usable'
        ? 'confirmed'
        : p.score >= 2
          ? 'plausible'
          : 'weak',
    reviewStatus: p.reviewStatus,
    viaPersonName: p.viaPersonName,
    viaOrgName: p.viaOrgName,
    targetCompanyId: p.targetCompanyId,
    targetCompanyName: p.targetCompanyName,
    edgeKeys: (() => {
      const hub = `c${companyId}`;
      const via = p.viaPersonId ? `p${p.viaPersonId}` : p.viaOrgId ? `o${p.viaOrgId}` : null;
      const end = p.targetCompanyId ? `c${p.targetCompanyId}` : null;
      // A direct company-to-company relationship runs hub to target with no
      // connector, and its single edge is what selecting the row lights up.
      if (!via) return end ? [`${hub}|${end}`] : [];
      return [`${hub}|${via}`, ...(end ? [`${via}|${end}`] : [])];
    })(),
    nodeIds: [
      `c${companyId}`,
      p.viaPersonId ? `p${p.viaPersonId}` : p.viaOrgId ? `o${p.viaOrgId}` : null,
      p.targetCompanyId ? `c${p.targetCompanyId}` : null,
    ].filter((x): x is string => x !== null),
  }));
}

/**
 * Every company that has ever cleared the trigger bar, newest first.
 *
 * The dashboard says how many; this is the list behind that number. Deduped by
 * company — a company that qualified in three separate weeks is one entry, with
 * the week it was last seen.
 */
/**
 * Companies this reader has dismissed.
 *
 * Scoped to the browser's own voter key, because that is the only identity the
 * schema has (§7a) and one person's dismissal is not a verdict for everyone.
 *
 * A dismissal is easy to make by accident and, once made, the company stops
 * appearing — so the only way back is a list of what was dismissed. The reason
 * travels with each row: 'irrelevant_company' and 'no_sg_angle' suppress the
 * company outright, where the others only hold against news already seen, and
 * a reader deciding whether to undo needs to know which they chose.
 */
export async function dismissedCompanies(userId: number | null): Promise<Array<{
  id: number; name: string; oneLiner: string; sectors: string[]; hq: string;
  reasons: string[]; note: string | null; at: string; by: string;
}>> {
  if (!userId) return [];
  const sql = getSql();
  /*
   * Everyone's dismissals, not only this reader's, each carrying who made it.
   *
   * A dismissal removes a company from the week for the whole team, so a
   * teammate wondering where something went needs to see that a person took it
   * off and which person — the same transparency monitoring gives.
   */
  const rows: any = await sql`
    select c.id, c.name, c.one_liner, c.sectors, c.hq_city, c.hq_state,
           d.reasons, d.note, d.created_at, coalesce(u.name, 'Someone') as by_name
      from dispositions d
      join companies c on c.id = d.company_id
      left join users u on u.id = d.user_id
     where d.disposition = 'dismiss'
     order by d.created_at desc`;
  return (rows as Row[]).map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? ''),
    oneLiner: String(r.one_liner ?? ''),
    sectors: Array.isArray(r.sectors) ? (r.sectors as string[]) : [],
    hq: [r.hq_city, r.hq_state].filter(Boolean).join(', ') || 'Unknown',
    reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [],
    note: (r.note as string | null) ?? null,
    at: asDate(r.created_at),
    by: String(r.by_name ?? 'Someone'),
  }));
}

export async function everSurfacedCompanies(): Promise<Array<{
  id: number; name: string; sectors: string[]; hq: string;
  lastWeek: string; weeks: number;
}>> {
  const sql = getSql();
  const rows: any = await sql`
    select c.id, c.name, c.sectors, c.hq_city, c.hq_state,
           max(cs.week_of) as last_week,
           count(distinct cs.week_of)::int as weeks
    from company_signals cs
    join companies c on c.id = cs.company_id
    where greatest(cs.expansion, cs.partnership) >= ${QUALIFY.minTopAxis}
      and cs.momentum >= ${QUALIFY.minMomentum}
      -- The same scope the week's page applies. A company retired by review
      -- never belonged in the standing record either.
      and coalesce(c.scope_status, 'unknown') <> 'out_of_scope'
      and coalesce(c.discovered_via, '') <> 'portfolio'
    group by c.id, c.name, c.sectors, c.hq_city, c.hq_state
    order by max(cs.week_of) desc, c.name`;
  return (rows as Row[]).map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? ''),
    sectors: Array.isArray(r.sectors) ? (r.sectors as string[]) : [],
    hq: [r.hq_city, r.hq_state].filter(Boolean).join(', ') || 'Unknown',
    lastWeek: asDate(r.last_week),
    weeks: Number(r.weeks ?? 1),
  }));
}

export type StageStatus = {
  name: string;
  phase: string;
  cost: 'llm' | 'fetch';
  why: string;
  /** running | ok | failed | stale — stale means it has not run today. */
  state: 'running' | 'ok' | 'failed' | 'stale';
  startedAt: string | null;
  minutes: number | null;
  timeoutMin: number;
  counts: Record<string, unknown> | null;
  error: string | null;
};

export type PipelineStatus = {
  stages: StageStatus[];
  /** The queues, so a stage that is between runs still says how much is left. */
  backlog: { filter: number; score: number; assess: number };
  /** Work landing right now, which is what separates wedged from slow. */
  rate: { itemsScored5m: number; assessed30m: number };
  weekOf: string;
};

/**
 * What the pipeline is doing, stage by stage.
 *
 * A process list answers "is it alive" and never "is it getting anywhere" — a
 * wedged stage and a working one look identical from outside. Every stage
 * leaves a countable trace as it goes, so this pairs each one's most recent run
 * with the queues it drains and the work landing in the last few minutes.
 *
 * Driven by lib/stages.ts rather than by whatever happens to be in `runs`, so a
 * stage that has never run still appears, as stale, instead of silently
 * missing.
 */
export async function getPipelineStatus(): Promise<PipelineStatus> {
  const sql = getSql();
  const { STAGES } = await import('./stages');
  const { COMPANY_SIGNAL_VERSION: sigV, WINDOW_DAYS } = await import('./company-signal');
  const { COMPANY_RUBRIC_VERSION: rubV } = await import('./company-rubric');
  const wk = weekOfSaturday();

  /*
   * The runs table records a stage name, not the stage list's name, and the two
   * differ (`score` vs `score_companies`). Matching on a prefix of either keeps
   * the page working when a script is renamed without a migration.
   */
  const [latest, [queue], [scored5], [target], [assessed30], [toAssess]]: any = await Promise.all([
    sql`select distinct on (stage) stage, started_at, finished_at, counts, error,
               extract(epoch from (coalesce(finished_at, now()) - started_at))/60 as minutes
        from runs where started_at > now() - interval '3 days'
        order by stage, started_at desc`,
    sql`select count(*)::int c from items where status = 'fetched'`,
    sql`select count(*)::int c from scores where scored_at > now() - interval '5 minutes'`,
    sql`select count(distinct c.id)::int c from companies c
        join items i on i.company_id = c.id and i.status = 'kept'
        where coalesce(i.published_at, i.fetched_at) > now() - make_interval(days => ${WINDOW_DAYS})
          and not exists (select 1 from company_signals cs
            where cs.company_id = c.id and cs.week_of = ${wk}::date
              and cs.signal_version = ${sigV})`,
    sql`select count(*)::int c from company_assessments
        where rubric_version = ${rubV} and assessed_at > now() - interval '30 minutes'`,
    sql`select count(*)::int c from companies c
        where coalesce(c.scope_status, 'unknown') <> 'out_of_scope'
          and exists (select 1 from company_signals s
            where s.company_id = c.id and s.week_of > current_date - 60)
          and not exists (select 1 from company_assessments a
            where a.company_id = c.id and a.rubric_version = ${rubV})`,
  ]);

  const rowFor = (name: string) =>
    (latest as any[]).find((r) => {
      const s = String(r.stage);
      return s === name || s.startsWith(`${name}_`) || name.startsWith(s);
    });

  const stages: StageStatus[] = (STAGES as any[]).map((st) => {
    const r = rowFor(st.name);
    const minutes = r ? Math.round(Number(r.minutes) * 10) / 10 : null;
    const state: StageStatus['state'] = !r
      ? 'stale'
      : !r.finished_at
        ? 'running'
        : r.error
          ? 'failed'
          : 'ok';
    return {
      name: st.name, phase: st.phase, cost: st.cost, why: st.why,
      state, minutes, timeoutMin: st.timeoutMin,
      startedAt: r ? new Date(r.started_at).toISOString() : null,
      counts: r?.counts ?? null,
      error: r?.error ?? null,
    };
  });

  return {
    stages,
    backlog: { filter: queue.c, score: target.c, assess: toAssess.c },
    rate: { itemsScored5m: scored5.c, assessed30m: assessed30.c },
    weekOf: wk,
  };
}
