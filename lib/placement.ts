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
 *     (target_priority, singapore_fit) and on account status: a company EDB
 *     already holds as an account does not belong in a discovery list.
 *     'in_conversation' stays in, since active discussions still need
 *     surfacing, while 'existing_account' and 'not_pursuing' drop out.
 *
 *   Trending — activity-centred. "What just happened that we could build on?"
 *     Still a company, selected on its activity rather than its profile: ranks
 *     on `momentum` and how widely the story was carried. Account status is ignored here: a fast-moving
 *     company EDB already meets is exactly where a joint R&D project, testbed
 *     or commercial deployment becomes possible, so excluding existing accounts
 *     would hide the best openings.
 *
 * The §7a matrix governs discovery, which is what stops a large raise at an
 * out-of-scope company outranking a strategically important one. Trending is
 * the scoped exception: momentum never lifts a company into discovery.
 */
import type { Band } from './company-rubric';
import { ENGAGED, type AccountStatus } from './accounts';

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
  'worth_a_conversation', 'new_on_the_radar', 'already_in_play',
  'monitoring', 'exploration', 'to_watch', 'omitted',
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
  new_on_the_radar: 15,
  already_in_play: 15,
  exploration: 1,
};

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
  accountStatus: AccountStatus | null;
  publishedAt: Date | null;
  /** How many outlets carried this story — corroboration, and a momentum input. */
  clusterSize: number;
};

export type Placed = PlacementInput & { section: Section; rank: number };

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
const priorityScore = (b: Band | null) => (b ? PRIORITY_RANK[b] ?? 0 : 0);
const daysOld = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86400_000);

/**
 * Account statuses that DISQUALIFY an item from discovery.
 *
 * 'in_conversation' is deliberately absent: talks in progress are still a
 * company worth putting in front of an RD. Only a held account (nothing to
 * discover) and an explicit decision not to pursue are excluded.
 */
const NOT_DISCOVERABLE: AccountStatus[] = ['existing_account', 'in_conversation', 'not_pursuing'];

/**
 * Which discovery tier, or null if not a discovery candidate at all.
 *
 * The dividing line is whether the tool can make an ARGUMENT: a company with an
 * assessed priority earns the full treatment, an unassessed or low-priority one
 * with a strong trigger is a find worth showing but not yet worth arguing for.
 */
export function discoveryTier(it: PlacementInput): 'worth_a_conversation' | 'new_on_the_radar' | null {
  if (!isDiscovery(it)) return null;
  const p = priorityScore(it.targetPriority);
  // High or medium priority with a real trigger: we can say why EDB cares.
  if (p >= 2) return 'worth_a_conversation';
  // Otherwise it is a strong trigger at a company we cannot yet argue for.
  return 'new_on_the_radar';
}

/** A discovery candidate needs a real why-now AND a company worth pursuing. */
export function isDiscovery(it: PlacementInput): boolean {
  if (it.companyId === null) return false;
  if (it.accountStatus && NOT_DISCOVERABLE.includes(it.accountStatus)) return false;
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
 * Companies EDB already holds or is talking to. Ranked on momentum, because
 * what matters at a company already in hand is what just moved — a growth event
 * is where a joint project becomes possible.
 */
export function isAlreadyInPlay(it: PlacementInput): boolean {
  if (!it.accountStatus) return false;
  if (!ENGAGED.includes(it.accountStatus)) return false;
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
    (it.accountStatus === 'in_conversation' ? -5_000 : 0) +
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
    already_in_play_candidates: number;
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
    already_in_play_candidates: 0,
    excluded_existing_account: 0,
    capped: 0,
    company_deduped: 0,
    partnership_led: input.filter((i) => i.partnership > i.expansion).length,
  };

  counts.excluded_existing_account = input.filter(
    (i) => i.accountStatus && NOT_DISCOVERABLE.includes(i.accountStatus),
  ).length;

  // ---- Discovery: company-centred, account-status aware, two tiers --------
  const discoveryPool = input
    .map((it) => ({ it, tier: discoveryTier(it) }))
    .filter((x): x is { it: PlacementInput; tier: 'worth_a_conversation' | 'new_on_the_radar' } => x.tier !== null)
    .map(({ it, tier }) => ({ ...it, section: tier as Section, rank: discoveryRank(it) }))
    .sort((a, b) => b.rank - a.rank);
  counts.discovery_candidates = discoveryPool.length;
  // Deduped ACROSS both tiers: one company should not appear as both a
  // conversation and a radar entry.
  const discovery = dedupeByCompany(discoveryPool);
  counts.company_deduped += discovery.dropped.length;

  // ---- Already in play: companies EDB holds or is talking to ---------------
  const inPlayPool = input.filter(isAlreadyInPlay)
    .map((it) => ({ ...it, section: 'already_in_play' as Section, rank: trendingRank(it) }))
    .sort((a, b) => b.rank - a.rank);
  counts.already_in_play_candidates = inPlayPool.length;
  const inPlay = dedupeByCompany(inPlayPool);
  counts.company_deduped += inPlay.dropped.length;

  const buckets: Array<[Section, Placed[]]> = [
    ['worth_a_conversation', discovery.kept.filter((d) => d.section === 'worth_a_conversation')],
    ['new_on_the_radar', discovery.kept.filter((d) => d.section === 'new_on_the_radar')],
    ['already_in_play', inPlay.kept],
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
    [...sections.worth_a_conversation, ...sections.new_on_the_radar, ...sections.already_in_play]
      .map((i) => i.itemId),
  );
  for (const it of input) {
    if (placedIds.has(it.itemId)) continue;
    if (priorityScore(it.targetPriority) >= 2 && Math.max(it.expansion, it.partnership) < 2) {
      sections.to_watch.push({ ...it, section: 'to_watch', rank: discoveryRank(it) });
    }
  }

  const represented = new Set(
    [...sections.worth_a_conversation, ...sections.new_on_the_radar, ...sections.already_in_play]
      .map((i) => i.signalType),
  );
  const cutPool = input.filter((i) => !placedIds.has(i.itemId));
  const explore = pickExploration(cutPool, represented);
  const exploration = explore
    ? { ...explore, section: 'exploration' as Section, rank: trendingRank(explore) }
    : null;

  counts.placed = sections.worth_a_conversation.length + sections.new_on_the_radar.length
    + sections.already_in_play.length + (exploration ? 1 : 0);
  return { sections, exploration, counts };
}

/** §10 header line. "monitored/processed", never "screened" — that would overclaim. */
export function coverageLine(companiesMonitored: number, signalsProcessed: number, surfaced: number): string {
  return `Monitored ${companiesMonitored.toLocaleString()} companies, processed ${signalsProcessed.toLocaleString()} signals, ${surfaced} surfaced`;
}
