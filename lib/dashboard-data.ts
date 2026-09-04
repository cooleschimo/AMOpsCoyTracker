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
import { COMPANY_SIGNAL_VERSION } from './company-signal';
import { planDigest, coverageLine, type PlacementInput, type Placed } from './placement';
import { assembleWhyNow, type WhyNowInput } from './why-now';
import { candidateProps } from './proposition';
import { sectorBroadSector, isBroadSector, isSurfaceable } from './subsectors';
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

/** Amounts are stored in dollars. Render at the scale a reader thinks in. */
const money = (n: unknown): string => {
  if (n === null || n === undefined) return 'Unknown';
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 'Unknown';
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
    oneLiner: String(r.description ?? ''),
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
    : typeof r.hq_state === 'string' && /^[A-Z]{2}$/.test(r.hq_state) ? 'other_us'
    : 'non_us') as 'west_coast' | 'other_us' | 'non_us',
    fundingTotal: money(r.total_raised),
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
          value: money(r.valuation_est),
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
async function whyNowContext(
  rows: Row[],
  signalVersion: string,
): Promise<{
  siblings: Map<number, WhyNowInput[]>;
  sources: Map<number, Source>;
  types: Map<number, string>;
}> {
  const siblings = new Map<number, WhyNowInput[]>();
  const sources = new Map<number, Source>();
  const types = new Map<number, string>();
  const companyIds = rows.map((r) => Number(r.company_id)).filter(Number.isFinite);
  if (!companyIds.length) return { siblings, sources, types };

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
      select id as item_id, source, url, source_type, published_at
      from items where id = any(${citedIds})`;
    for (const row of cited as Row[]) {
      sources.set(Number(row.item_id), {
        name: String(row.source ?? 'Source'),
        url: String(row.url ?? ''),
        date: asDate(row.published_at),
      });
      types.set(Number(row.item_id), String(row.source_type ?? 'news'));
    }
  }

  const others: any = await sql`
    select cs.company_id, cs.why, i.id as item_id, i.source, i.url,
           i.source_type, i.published_at
    from company_signals cs
    join items i on i.id = cs.representative_item_id
    where cs.signal_version = ${signalVersion}
      and cs.company_id = any(${companyIds})`;

  // The representative item's own source, plus every other scored item for the
  // same company — hiring aggregates especially, which is where co-occurrence
  // becomes visible (§7).
  const scored: any = await sql`
    select ic.company_id, s.why, i.id as item_id, i.source, i.url,
           i.source_type, i.published_at
    from scores s
    join items i on i.id = s.item_id
    join item_companies ic on ic.item_id = i.id
    where ic.company_id = any(${companyIds}) and i.status = 'kept'
    order by i.published_at desc nulls last
    limit 2000`;

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
  return { siblings, sources, types };
}

async function signalRows(signalVersion: string, weekOf?: string): Promise<Row[]> {
  const sql = getSql();
  const rows: any = await sql`
    select
      cs.company_id, c.name as company_name, c.familiarity, c.sectors,
      c.description, c.hq_city, c.hq_state, c.hq_region, c.total_raised, c.headcount_est,
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
      -- One week, and by default the latest. Signals accumulate week on week,
      -- and without this the dashboard showed every week at once: a company
      -- scored a fortnight ago sat beside one scored today, both reading as
      -- current. An explicit week is how the archive is read.
      and cs.week_of = coalesce(
        ${weekOf ?? null}::date,
        (select max(week_of) from company_signals where signal_version = ${signalVersion}))
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
  return (rows as Row[]).filter((r) => isSurfaceable(r.sectors as string[] | null));
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
  valuationUsd: r.valuation_est != null ? Number(r.valuation_est) : null,
  roundAmountMusd: r.round_amount_musd != null ? Number(r.round_amount_musd) : null,
  // A two-letter tail is a US state; anything else is the country, which is
  // what marks a Singapore company as not a target.
  hqCountry: typeof r.hq_state === 'string' && /^[A-Z]{2}$/.test(r.hq_state)
    ? 'United States' : (r.hq_state as string | null) ?? null,
  hqCity: (r.hq_city as string | null) ?? null,
  title: (r.title as string | null) ?? null,
  snippet: (r.snippet as string | null) ?? null,
});

export type WeeklyDigest = {
  weekLabel: string;
  coverage: string;
  /** The same three numbers as `coverage`, for a stat row rather than a sentence. */
  coverageStats: { monitored: number; processed: number; surfaced: number };
  /** A real trigger at a company the tool can argue for. */
  worthAConversation: DashboardCompany[];
  /** A strong trigger the tool cannot yet argue for. */
  newOnTheRadar: DashboardCompany[];
  familiarTerritory: DashboardCompany[];
  monitoring: DashboardCompany[];
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
): Promise<WeeklyDigest> {
  const rows = await signalRows(signalVersion, weekOf);
  const byCompany = new Map<number, Row>();
  for (const r of rows) byCompany.set(Number(r.company_id), r);

  const plan = planDigest(rows.map(toPlacementInput));
  const ctx = await whyNowContext(rows, signalVersion);
  const pick = (placed: Placed[]) =>
    placed
      .map((p) => (p.companyId === null ? null : byCompany.get(p.companyId)))
      .filter((r): r is Row => Boolean(r))
      .map((r) => toCompany(r, ctx));

  const sql = getSql();
  // Companies actually watched, not every row in the table. Portfolio scraping
  // fills the graph with thousands of names that are never fetched for news or
  // scored, and counting those would claim coverage the tool does not have.
  // Everything else counts, whatever route found it — naming origins here made
  // the figure drift every time ingestion grew.
  const [{ companies = 0 } = {}]: any = await sql`
    select count(*)::int as companies from companies c
    where coalesce(c.discovered_via, '') <> 'portfolio'
      and coalesce(c.scope_status, 'unknown') <> 'out_of_scope'`;
  const [{ signals = 0 } = {}]: any =
    await sql`select count(*)::int as signals from items where status <> 'fetched'`;

  const worthAConversation = pick(plan.sections.worth_a_conversation);
  const newOnTheRadar = pick(plan.sections.new_on_the_radar);
  // Account activity: companies EDB already holds or is talking to, where
  // something moved this week.
  const familiarTerritory = pick(plan.sections.familiar_territory);
  const monitoring = await getMonitoredCompanies(signalVersion);

  return {
    weekLabel: weekLabel(rows[0]?.week_of as string | undefined),
    coverage: coverageLine(Number(companies), Number(signals), worthAConversation.length + newOnTheRadar.length),
    coverageStats: {
      monitored: Number(companies),
      processed: Number(signals),
      surfaced: worthAConversation.length + newOnTheRadar.length,
    },
    worthAConversation,
    newOnTheRadar,
    familiarTerritory,
    monitoring,
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
  const mon = weekOf
    ? new Date(weekOf)
    : (() => {
        const now = new Date();
        const day = (now.getUTCDay() + 6) % 7;
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day) - 7 * 86400_000);
      })();
  const sun = new Date(mon.getTime() + 6 * 86400_000);
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });
  const sameMonth = mon.getUTCMonth() === sun.getUTCMonth();
  const from = sameMonth ? fmt(mon, { day: 'numeric' }) : fmt(mon, { day: 'numeric', month: 'long' });
  return `${from} – ${fmt(sun, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/** Companies an RD chose to monitor, with their signal row when one exists. */
export async function getMonitoredCompanies(
  signalVersion = COMPANY_SIGNAL_VERSION,
): Promise<DashboardCompany[]> {
  const sql = getSql();
  const rows: any = await sql`
    select c.id as company_id, c.name as company_name, c.familiarity, c.sectors,
           c.description, c.hq_city, c.hq_state, c.hq_region, c.total_raised, c.headcount_est,
           c.founded_year, c.hq_source, c.round_date, c.round_stage, c.round_amount_musd, c.valuation_est, c.valuation_source,
           m.added_at, m.note,
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
    order by m.added_at desc`;
  const ctx = await whyNowContext(rows as Row[], signalVersion);
  return (rows as Row[]).map((r) => toCompany(r, ctx));
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

  for (const p of paths) {
    const viaId = p.viaPersonId
      ? `p${p.viaPersonId}`
      : p.viaOrgId
        ? `o${p.viaOrgId}`
        : null;
    if (!viaId) continue;
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
      edges.push({ source: viaId, target: endId, feasibility: feasibilityOf(p), label: p.evidence });
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
      if (!via) return [];
      return [`${hub}|${via}`, ...(end ? [`${via}|${end}`] : [])];
    })(),
    nodeIds: [
      `c${companyId}`,
      p.viaPersonId ? `p${p.viaPersonId}` : p.viaOrgId ? `o${p.viaOrgId}` : null,
      p.targetCompanyId ? `c${p.targetCompanyId}` : null,
    ].filter((x): x is string => x !== null),
  }));
}
