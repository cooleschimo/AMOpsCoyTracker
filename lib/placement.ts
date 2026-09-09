/**
 * Digest and dashboard placement.
 *
 * Two sections, ~7 companies each. Every section places COMPANIES; items are the
 * evidence behind a placement, and a company carrying four signals is one entry
 * with a fuller case rather than four competing entries. The sections ask
 * genuinely different questions, and the ranking inputs differ accordingly:
 *
 *   Company discovery — company-centred. "Who don't we know that we should?"
 *     Ranks on the §7a company axis
 *     (target_priority, singapore_fit) and on how well it is already known: a
 *     company someone has marked known does not belong in a discovery list.
 *     'in_conversation' stays in, since active discussions still need
 *     surfacing, while 'known' and 'not_known' drop out.
 *
 *   Trending — activity-centred. "What just happened that we could build on?"
 *     Still a company, selected on its activity rather than its profile: ranks
 *     on `momentum` and how widely the story was carried. Account status is ignored here: a fast-moving
 *     company EDB already meets is exactly where a joint R&D project, testbed
 *     or commercial deployment becomes possible, so excluding known companies
 *     would hide the best openings.
 *
 * The §7a matrix governs discovery, which is what stops a large raise at an
 * out-of-scope company outranking a strategically important one. Trending is
 * the scoped exception: momentum never lifts a company into discovery.
 */
import type { Band } from './company-rubric';
import { ENGAGED, type Familiarity } from './familiarity';
import { parseFundraise } from './fundraise';

/**
 * Discovery splits in two by whether the company is actionable now. Both are
 * discovery; the difference is how much the tool can honestly say:
 *
 *   worth_a_conversation — a company assessed as a priority with a real
 *     trigger. Gets the full treatment: why now, why EDB, possible path, and
 *     Singapore's value proposition for THIS company.
 *   new_on_the_radar — a genuine find the tool cannot yet argue for. Gets a
 *     lighter treatment: what the company does, what just happened, and the
 *     model's own reasoning for not rating it a priority, with its confidence,
 *     so a regional director can correct it rather than take it on trust.
 *
 * Signals are evidence, not sections. Job postings, funding and partnerships
 * feed these judgments — an APAC hire helps surface a company into discovery or
 * trending rather than getting a block of its own.
 */
export const SECTIONS = [
  'worth_a_conversation', 'new_on_the_radar', 'who_we_know',
  'awaiting_assessment',
  'monitoring', 'exploration', 'to_watch', 'low_fit', 'omitted',
] as const;
export type Section = (typeof SECTIONS)[number];

/**
 * A company appears because it cleared the bar, not because it placed in a top
 * four. A fixed cap makes the digest a ranking of whatever arrived that week:
 * in a quiet week the fourth-best entry is padding, and in a busy one a company
 * that plainly qualifies is cut for finishing fifth. The threshold below is a
 * judgment about what qualifies, and it holds either way.
 *
 * RATIONALE §1 still governs: too much is the failure mode, and the PoliteMail
 * finding is that more links reduce total clicks. That constrains how much is
 * *written* about each company, not how many clear the bar — which is what
 * DETAIL_BUDGET handles by compressing the entries as a section grows. The
 * dashboard carries the full list, and the email is the invitation to it.
 */
export const QUALIFY = {
  /** Deciding where to put something, or an opening to propose into. */
  minTopAxis: 3,
  /** And moving. A 3 with no momentum is a standing fact, not a reason to act now. */
  minMomentum: 2,
} as const;

/** Clears the bar for a discovery section. */
export function qualifies(it: PlacementInput): boolean {
  return Math.max(it.expansion, it.partnership) >= QUALIFY.minTopAxis
    && it.momentum >= QUALIFY.minMomentum;
}

/**
 * How much is written about each entry, by that entry's position in its
 * section. The first few carry the full opportunity structure; past that the
 * reader is scanning, so an entry becomes a headline and one line of why, and
 * the detail waits behind the link.
 */
export const DETAIL_BUDGET = { full: 5, brief: 12 } as const;
export type Detail = 'full' | 'brief' | 'line';

export function detailFor(indexInSection: number): Detail {
  if (indexInSection < DETAIL_BUDGET.full) return 'full';
  if (indexInSection < DETAIL_BUDGET.brief) return 'brief';
  return 'line';
}

/**
 * A ceiling, not a target — high enough that it never decides who qualifies in
 * a normal week, low enough that a runaway week cannot produce an unreadable
 * email. Hitting it is a signal the threshold needs looking at.
 */
export const SECTION_CAPS: Partial<Record<Section, number>> = {
  worth_a_conversation: 25,
  new_on_the_radar: 25,
  who_we_know: 15,
  // No cap: this section is the assessment backlog, and hiding part of a
  // backlog behind a cap is how it stops being visible work. It has its own
  // page, so length costs the dashboard nothing.
  awaiting_assessment: Number.MAX_SAFE_INTEGER,
  // Both are complete lists behind their own link rather than sections
  // competing for a slot, so neither is capped.
  low_fit: Number.MAX_SAFE_INTEGER,
  exploration: 1,
};

/**
 * Early-stage discovery: the companies an RD would not already be tracking.
 *
 * The main threshold asks for a siting decision, which favours companies large
 * enough to be making one — so the section fills with names an RD already
 * knows and is already scheduling calls with. Seeing them is useful, because it
 * confirms the judgment, but it is not discovery.
 *
 * This section asks less: a real event at a company small enough that its
 * fundraise is itself the news. Series A and B are the core. Seed is admitted
 * only with genuine traction, because a seed round is a plan rather than a
 * business. Series C is admitted only when the company has not broken through
 * despite the money — measured first by the RD's own marking of whether they
 * know it, and falling back to valuation, since a company past a few billion is
 * not a discovery whatever its round is called.
 *
 * Round and valuation come from THIS WEEK'S HEADLINE first and the stored
 * fields second. Only 55% of scored companies carry a valuation and 70% a
 * round, so a rule reading the stored fields alone is guessing for a third of
 * them — and the guess falls the permissive way, admitting companies it cannot
 * size. The headline usually states both outright, and it is also more current:
 * the item is this week's evidence where the stored field is whenever someone
 * last looked. When neither source knows the round, the company is not placed
 * here — not knowing is not the same as qualifying.
 */
export const EARLY_STAGE = {
  /** Rounds that qualify outright. */
  core: ['series_a', 'series_b', 'series_a_ext', 'series_b_ext'],
  /** Admitted on evidence rather than by right. */
  conditional: ['seed', 'launch'],
  /**
   * Past this, a company is known whatever its round is called. It only ever
   * DISQUALIFIES: a valuation under it is not evidence of a find, since a
   * company can be worth three billion with no round on record — Sila
   * Nanotechnologies is — and calling that early stage because it sat under a
   * five-billion ceiling is the guess this section exists to avoid.
   */
  maxValuationUsd: 5e9,
  /**
   * And past this in a single round. Most headlines name an amount without
   * naming the series — "Reframe Systems raises $40M" — so the amount decides
   * when the label is missing, which is most of the time. A round at or under
   * this is an early-stage company by any reading; above it, the company is
   * established enough to be raising growth money.
   */
  maxRoundUsd: 150e6,
  /** A seed round needs this many outlets before it counts as traction. */
  seedMinOutlets: 3,
  /** Something real happened, even if it is not a siting decision. */
  minTopAxis: 2,
} as const;

const LATE_ROUNDS = [
  // Series C is late here: the bar is Series B and below, because by C a
  // company is usually established enough that an RD has heard of it.
  'series_c', 'series_c_ext',
  'series_d', 'series_e', 'series_f', 'series_g', 'series_h',
  'series_d_ext', 'series_e_ext', 'series_f_ext',
  'growth', 'late', 'ipo', 'strategic', 'multiple',
] as const;

/**
 * An early-stage find: small enough that an RD would not already know the name.
 *
 * Size is read from whatever the evidence actually carries, in order of how
 * much it settles. A valuation is decisive. A named round is nearly so. An
 * amount without a series is the common case — most headlines write "$40M"
 * without writing "Series B" — and it is enough on its own, because nobody
 * raising forty million is a household name.
 *
 * A company none of those describe is NOT early stage by default. Absence of
 * evidence about size is not evidence of smallness, and the alternative reading
 * fills this section with large firms whose rounds simply were not reported.
 */
export function isEarlyStageFind(it: PlacementInput): boolean {
  if (it.companyId === null) return false;
  if (it.familiarity && NOT_DISCOVERABLE.includes(it.familiarity)) return false;
  if (Math.max(it.expansion, it.partnership) < EARLY_STAGE.minTopAxis) return false;
  // Someone has said they know this company, which settles it whatever the
  // numbers say.
  if (it.familiarity === 'known') return false;

  const news = it.title ? parseFundraise(it.title, it.snippet ?? null) : null;

  /*
   * The ROUND is read before the valuation, because it is the more specific
   * fact. Checking valuation first put SiFive — a Series F at $3.65bn — on the
   * radar as a find, simply because its valuation sat under the cap and the
   * round label was never reached. A named late round settles the question on
   * its own; the valuation is what decides when no round is stated.
   */
  const stage = (news?.round ?? it.roundStage ?? '').toLowerCase();
  if (LATE_ROUNDS.includes(stage as never)) return false;

  const valuation = news?.valuationUsd ?? it.valuationUsd ?? null;
  if (valuation !== null && valuation > EARLY_STAGE.maxValuationUsd) return false;

  if (EARLY_STAGE.core.includes(stage as never)) return true;
  if (stage === 'seed' || stage === 'launch') {
    // A seed round is a plan rather than a business, so it needs the market to
    // have noticed before it is worth an RD's attention.
    return it.clusterSize >= EARLY_STAGE.seedMinOutlets;
  }

  // No round named. The amount raised says as much, and is far more often
  // present: a company raising at or under the cap is early stage.
  const amount = news?.amountUsd ?? (it.roundAmountMusd ? it.roundAmountMusd * 1e6 : null);
  if (amount !== null) return amount <= EARLY_STAGE.maxRoundUsd;

  return false;
}

export type PlacementInput = {
  itemId: number;
  companyId: number | null;
  companyName: string;
  /** Is the company deciding where to put something. */
  expansion: number;
  /** Is the company accelerating. */
  momentum: number;
  /** Is there an opening EDB could propose into. */
  partnership: number;
  signalType: string;
  sourceType: string;
  targetPriority: Band | null;
  singaporeFit: Band | null;
  familiarity: Familiarity | null;
  publishedAt: Date | null;
  /** How many outlets carried this story — corroboration, and a momentum input. */
  clusterSize: number;
  /** Round label, for the early-stage section. Read from the news when stated. */
  roundStage?: string | null;
  /** Latest valuation in USD, the fallback for "already well known". */
  valuationUsd?: number | null;
  /** Latest round size in USD millions — the size signal most often present. */
  roundAmountMusd?: number | null;
  /** Where the company is. Singapore companies are not targets for inbound FDI. */
  hqCountry?: string | null;
  hqCity?: string | null;
  /** The headline, so a round or valuation it states beats a stale stored one. */
  title?: string | null;
  snippet?: string | null;
};

export type Placed = PlacementInput & { section: Section; rank: number };

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
const priorityScore = (b: Band | null) => (b ? PRIORITY_RANK[b] ?? 0 : 0);
const daysOld = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86400_000);

/**
 * Familiarity values that disqualify a company from discovery.
 *
 * A company EDB already knows, or is already talking to, is not a find — it
 * belongs under Who we know instead. 'not_known' is deliberately absent:
 * a company someone checked and does not know is precisely what discovery is
 * for, and 'no_status' means nobody has said, which is no reason to exclude it.
 */
const NOT_DISCOVERABLE: Familiarity[] = ['known', 'in_conversation'];

/**
 * Which discovery section, or null if not a discovery candidate at all.
 *
 * The dividing line is the ASSESSMENT, and an unassessed company is not a
 * verdict — it is work not yet done. Those two were one section, so a judgment
 * of 'low' and nobody having looked sat under the same heading, and the tool
 * could not say which it meant.
 *
 *  - high / medium -> worth_a_conversation, the full opportunity structure.
 *  - low           -> new_on_the_radar: assessed, argued down, still worth
 *                     seeing, because a low band is a judgment a reader may
 *                     disagree with and the section is where they can.
 *  - unassessed    -> awaiting_assessment, a backlog rather than a finding.
 *
 * Company SIZE deliberately does not decide the section. A Micron fab decision
 * and a Series A both belong wherever the argument puts them — an RD reads for
 * what EDB could do about a company, not for how famous it is, and splitting on
 * size separated companies the same conversation would cover.
 */
export function discoveryTier(
  it: PlacementInput,
): 'worth_a_conversation' | 'new_on_the_radar' | 'awaiting_assessment' | 'low_fit' | null {
  if (!isDiscovery(it)) return null;
  if (!isAssessed(it)) return 'awaiting_assessment';
  /*
   * Assessed, and the answer was no.
   *
   * A company the assessment rated low on priority or on Singapore fit has been
   * judged — it is not a backlog item — but it is also not something to put in
   * front of an RD beside a company the tool is arguing for. Its own section
   * keeps the judgment visible and correctable without spending a slot on it.
   */
  if (isLowFit(it)) return 'low_fit';
  /*
   * The split is SIZE, not how well the tool rated the company.
   *
   * It used to be priority: a low-priority company went on the radar, which
   * made "new on the radar" a list of things the tool thought less of. That is
   * not what an RD wants from it. Read as a pair of section names, the useful
   * question is how big the company already is — a Series B is a find, and a
   * company with a multi-billion valuation is a call to schedule — so that is
   * what decides.
   *
   * A company whose size cannot be established goes to worth_a_conversation.
   * Not knowing is not evidence of smallness, and the cost of the two mistakes
   * is different: a large company shown as a find reads as an error, where a
   * small one among the larger names is merely a lighter entry.
   */
  return isEarlyStageFind(it) ? 'new_on_the_radar' : 'worth_a_conversation';
}

/**
 * Assessed, and rated low on either axis that matters.
 *
 * Priority is whether EDB should want the company at all; Singapore fit is
 * whether Singapore is a plausible place for it. Low on either is enough — a
 * high-priority company that does not fit Singapore is still not a conversation
 * an RD can open, and the reverse is a good fit for a company nobody wants.
 */
export function isLowFit(it: PlacementInput): boolean {
  return it.targetPriority === 'low' || it.singaporeFit === 'low';
}

/**
 * Whether anyone has actually judged this company.
 *
 * 'unknown' is what the assessor writes when it ran but reached no verdict, and
 * null is no row at all; neither is a judgment, so both are a backlog.
 */
export function isAssessed(it: PlacementInput): boolean {
  return it.targetPriority !== null && it.targetPriority !== 'unknown';
}

/**
 * Singapore companies are not FDI targets.
 *
 * The tool exists to attract activity INTO Singapore, so a company already
 * based there has nothing to move. They stay in the graph — a Singapore firm is
 * often the partner, customer or investor that makes a foreign company's
 * approach work, which is exactly what §8's warm paths are built from — but
 * they are never surfaced as a company to approach.
 */
export function isSingaporeBased(it: PlacementInput): boolean {
  // The city carries it as often as the country: a Singapore company is stored
  // as "Singapore" with no state, because the city and the country are the
  // same word and there is no state between them.
  const where = `${it.hqCountry ?? ''} ${it.hqCity ?? ''}`;
  return /\bsingapore\b/i.test(where);
}

/** A discovery candidate needs a real why-now AND a company worth pursuing. */
export function isDiscovery(it: PlacementInput): boolean {
  if (it.companyId === null) return false;
  if (isSingaporeBased(it)) return false;
  if (it.familiarity && NOT_DISCOVERABLE.includes(it.familiarity)) return false;
  // §7a: presence always requires a why-now. Expansion or partnership is what
  // makes a company actionable; a company with neither is held back whatever
  // its standing assessment says. QUALIFY is the bar, and it does not move with
  // how busy the week was.
  const trigger = Math.max(it.expansion, it.partnership);
  if (!qualifies(it)) {
    // An assessed priority earns a slightly lower bar: the tool can already say
    // why EDB cares, so a solid trigger is enough without top marks on both.
    const assessed = priorityScore(it.targetPriority) >= 2;
    if (!(assessed && trigger >= QUALIFY.minTopAxis)) return false;
  }
  return true;
}

/**
 * Who we know: companies someone has marked known or in conversation.
 * Ranked on momentum, because what matters at a company already in hand is what
 * just moved — a growth event is where a joint project becomes possible.
 *
 * These are excluded from discovery by NOT_DISCOVERABLE, so this is where they
 * surface instead. Without it, marking a company known would hide it entirely,
 * and the week it did something interesting would pass unseen.
 */
export function isWhoWeKnow(it: PlacementInput): boolean {
  if (!it.familiarity) return false;
  if (!ENGAGED.includes(it.familiarity)) return false;
  return it.momentum >= 2 || Math.max(it.expansion, it.partnership) >= 2;
}

/**
 * Discovery rank: the company axis first, then the trigger.
 *
 * Transparent and predictable rather than learned — brief §14 excludes learned
 * ranking ("log the data, do not model it"). An RD should be able to see why
 * one company is above another.
 */
export function discoveryRank(it: PlacementInput): number {
  // A company nobody has assessed yet is a weaker bet than one assessed high,
  // but a stronger one than a company assessed low.
  const unknownIsNeutral = it.targetPriority === null ? 1.5 : priorityScore(it.targetPriority);
  return (
    unknownIsNeutral * 1_000_000 +
    priorityScore(it.singaporeFit) * 100_000 +
    // Whichever kind of opening is stronger: a company deciding where to put
    // something and one ready for a joint project are both actionable now.
    Math.max(it.expansion, it.partnership) * 10_000 +
    // A live conversation is slightly below a cold company here: the point of
    // this section is finding what EDB does not already have in hand.
    (it.familiarity === 'in_conversation' ? -5_000 : 0) +
    Math.min(it.clusterSize, 30) * 100 +
    (it.publishedAt ? Math.max(0, 30 - daysOld(it.publishedAt)) : 10)
  );
}

/**
 * Trending rank: momentum first, then how widely the story was carried.
 *
 * Cluster size is corroboration, not popularity — it counts outlets that ran
 * the story, which is the closest free proxy for "the market noticed". It is
 * capped so one heavily syndicated wire release cannot dominate the section.
 */
export function trendingRank(it: PlacementInput): number {
  return (
    it.momentum * 1_000_000 +
    Math.min(it.clusterSize, 30) * 10_000 +
    Math.max(it.expansion, it.partnership) * 1_000 +
    priorityScore(it.targetPriority) * 100 +
    (it.publishedAt ? Math.max(0, 30 - daysOld(it.publishedAt)) : 10)
  );
}

/**
 * One company appears at most once PER SECTION. A company can legitimately
 * appear in both — discovered as a target AND moving fast — and that
 * co-occurrence is a signal rather than repetition.
 */
function dedupeByCompany(items: Placed[]): { kept: Placed[]; dropped: Placed[] } {
  const seen = new Set<number>();
  const kept: Placed[] = [];
  const dropped: Placed[] = [];
  for (const it of items) {
    if (it.companyId === null) { kept.push(it); continue; }
    if (seen.has(it.companyId)) { dropped.push(it); continue; }
    seen.add(it.companyId);
    kept.push(it);
  }
  return { kept, dropped };
}

/**
 * The exploration slot. §10: "exactly one exploration slot — an item scored 1-2
 * that would otherwise be cut, subtly tagged."
 *
 * RATIONALE §10 calls it "the only defence against the ranking going
 * permanently blind to a category", so it deliberately favours a signal type
 * that did not otherwise appear. Picking the best of the cut items would just
 * extend the ranking rather than probe outside it.
 */
export function pickExploration(cut: PlacementInput[], represented: Set<string>): PlacementInput | null {
  const eligible = cut.filter((c) => {
    const t = Math.max(c.expansion, c.partnership);
    return t >= 1 && t <= 2;
  });
  if (!eligible.length) return null;
  const unrepresented = eligible.filter((c) => !represented.has(c.signalType));
  const pool = unrepresented.length ? unrepresented : eligible;
  return pool.sort((a, b) => trendingRank(b) - trendingRank(a))[0];
}

export type DigestPlan = {
  sections: Record<Section, Placed[]>;
  exploration: Placed | null;
  counts: {
    scored: number;
    placed: number;
    discovery_candidates: number;
    who_we_know_candidates: number;
    /** Discovery candidates nobody has assessed yet — the backlog. */
    awaiting_assessment: number;
    low_fit: number;
    early_stage_candidates: number;
    /** Entries carrying a full argument, in either section. */
    worth_a_conversation: number;
    excluded_existing_account: number;
    capped: number;
    company_deduped: number;
    /** Companies whose opening is a partnership rather than a siting decision. */
    partnership_led: number;
  };
};

export function planDigest(input: PlacementInput[]): DigestPlan {
  const sections = Object.fromEntries(SECTIONS.map((s) => [s, [] as Placed[]])) as Record<Section, Placed[]>;
  const counts = {
    scored: input.length,
    placed: 0,
    discovery_candidates: 0,
    who_we_know_candidates: 0,
    awaiting_assessment: 0,
    low_fit: 0,
    early_stage_candidates: 0,
    worth_a_conversation: 0,
    excluded_existing_account: 0,
    capped: 0,
    company_deduped: 0,
    partnership_led: input.filter((i) => i.partnership > i.expansion).length,
  };

  counts.excluded_existing_account = input.filter(
    (i) => i.familiarity && NOT_DISCOVERABLE.includes(i.familiarity),
  ).length;

  /*
   * Discovery, split on what the assessment says. `isWorthAConversation` marks
   * the entries carrying a full argument, in either section — that is emphasis
   * inside a section, not a section of its own.
   */
  type Tier = Exclude<ReturnType<typeof discoveryTier>, null>;
  const discoveryPool = input
    .map((it) => ({ it, tier: discoveryTier(it) }))
    .filter((x): x is { it: PlacementInput; tier: Tier } => x.tier !== null)
    .map(({ it, tier }) => ({ ...it, section: tier as Section, rank: discoveryRank(it) }))
    .sort((a, b) => b.rank - a.rank);
  counts.discovery_candidates = discoveryPool.length;
  // Deduped across both, so one company cannot be both argued for and a find.
  const discovery = dedupeByCompany(discoveryPool);
  counts.company_deduped += discovery.dropped.length;

  // ---- Who we know: companies already known or in conversation -----
  const inPlayPool = input.filter(isWhoWeKnow)
    .map((it) => ({ ...it, section: 'who_we_know' as Section, rank: trendingRank(it) }))
    .sort((a, b) => b.rank - a.rank);
  counts.who_we_know_candidates = inPlayPool.length;
  const inPlay = dedupeByCompany(inPlayPool);
  counts.company_deduped += inPlay.dropped.length;
  counts.low_fit = discovery.kept.filter((d) => d.section === 'low_fit').length;
  counts.awaiting_assessment = discovery.kept.filter(
    (d) => d.section === 'awaiting_assessment',
  ).length;

  const buckets: Array<[Section, Placed[]]> = [
    ['worth_a_conversation', discovery.kept.filter((d) => d.section === 'worth_a_conversation')],
    ['new_on_the_radar', discovery.kept.filter((d) => d.section === 'new_on_the_radar')],
    ['who_we_know', inPlay.kept],
    ['awaiting_assessment', discovery.kept.filter((d) => d.section === 'awaiting_assessment')],
    ['low_fit', discovery.kept.filter((d) => d.section === 'low_fit')],
  ];
  for (const [name, list] of buckets) {
    const cap = SECTION_CAPS[name]!;
    for (const it of list) {
      if (sections[name].length >= cap) {
        // Over the cap: NOT deleted, moved to omitted so the count stays
        // visible and the dashboard can still show it.
        sections.omitted.push({ ...it, section: 'omitted' });
        counts.capped++;
        continue;
      }
      sections[name].push(it);
    }
  }

  /**
   * Companies worth an eye on: a real priority, and nothing happening this week.
   *
   * Derived fresh each run, and distinct from `monitoring`, which is the table
   * of companies a person chose to follow. §7a requires a why-now for
   * placement, so these are held back rather than featured.
   */
  const placedIds = new Set(
    [...sections.worth_a_conversation, ...sections.new_on_the_radar, ...sections.who_we_know,
     ...sections.awaiting_assessment, ...sections.low_fit]
      .map((i) => i.itemId),
  );
  for (const it of input) {
    if (placedIds.has(it.itemId)) continue;
    if (priorityScore(it.targetPriority) >= 2 && Math.max(it.expansion, it.partnership) < 2) {
      sections.to_watch.push({ ...it, section: 'to_watch', rank: discoveryRank(it) });
    }
  }

  const represented = new Set(
    [...sections.worth_a_conversation, ...sections.new_on_the_radar, ...sections.who_we_know]
      .map((i) => i.signalType),
  );
  const cutPool = input.filter((i) => !placedIds.has(i.itemId));
  const explore = pickExploration(cutPool, represented);
  const exploration = explore
    ? { ...explore, section: 'exploration' as Section, rank: trendingRank(explore) }
    : null;

  counts.placed = sections.worth_a_conversation.length + sections.new_on_the_radar.length
    + sections.who_we_know.length + (exploration ? 1 : 0);
  return { sections, exploration, counts };
}

/** §10 header line. "monitored/processed", never "screened" — that would overclaim. */
export function coverageLine(companiesMonitored: number, signalsProcessed: number, surfaced: number): string {
  return `Monitored ${companiesMonitored.toLocaleString()} companies, processed ${signalsProcessed.toLocaleString()} signals, ${surfaced} surfaced`;
}
