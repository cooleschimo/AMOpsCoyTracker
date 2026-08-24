/**
 * Digest placement. Brief §7a (the matrix) and §10 (the sections).
 *
 * THE POINT OF THE MATRIX (RATIONALE §6): the item rubric answers "is something
 * happening now?" and the company assessment answers "should EDB care about
 * this company at all?". Ranking on the item score alone produces a specific,
 * predictable failure — a large raise at an out-of-scope company outranks
 * silence at a strategically important one. Crossing the two axes keeps both
 * honest.
 *
 * THE OTHER HALF OF THE RULE, equally load-bearing: presence in the digest
 * always requires a *why now*. A strategically vital company with no trigger
 * goes on the watchlist, never into the featured section — there is nothing an
 * RD can act on this week.
 *
 *                 | high priority        | medium            | low / unknown
 *   trigger 3     | worth_a_conversation | worth/track       | new_on_the_radar
 *   trigger 2     | track                | track             | usually omitted
 *   trigger 0-1   | watchlist            | watchlist         | drop
 */
import type { Band } from './company-rubric';

export const SECTIONS = [
  'worth_a_conversation',
  'track',
  'expansion_signals',
  'new_on_the_radar',
  'context',
  'exploration',
  'watchlist',
  'omitted',
] as const;
export type Section = (typeof SECTIONS)[number];

/**
 * Caps per section. RATIONALE §1: the consistent failure mode of signal tools
 * is not bad data but too much of it, and the PoliteMail finding is that more
 * links REDUCE total clicks. §10 fixes these counts, so they are not a
 * preference — a digest that exceeds them is the failure the design predicts.
 */
export const SECTION_CAPS: Partial<Record<Section, number>> = {
  worth_a_conversation: 4,
  track: 6,
  expansion_signals: 4,
  new_on_the_radar: 3,
  context: 3,
  exploration: 1,   // exactly one, always — see pickExploration()
};

export type PlacementInput = {
  itemId: number;
  companyId: number | null;
  companyName: string;
  score: number;
  signalType: string;
  sourceType: string;
  /** null when the company has never been assessed — a real third state. */
  targetPriority: Band | null;
  singaporeFit: Band | null;
  publishedAt: Date | null;
  /** Cluster size: how many outlets carried this story. A weak corroboration signal. */
  clusterSize: number;
};

export type Placed = PlacementInput & { section: Section; rank: number };

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
const priorityScore = (b: Band | null) => (b ? PRIORITY_RANK[b] ?? 0 : 0);

/**
 * Which cell of the matrix an item falls in, before caps are applied.
 *
 * `expansion_signals` is a §10 section rather than a matrix cell: job postings
 * and exec hires get their own block regardless of company priority, because
 * they are the signal class RATIONALE §4 calls the most direct expansion
 * evidence public data contains, and burying them among funding news wastes
 * the one source no competitor digest has.
 */
export function assignSection(it: PlacementInput): Section {
  const p = priorityScore(it.targetPriority);
  const isExpansionSignal =
    it.sourceType === 'ats' || it.signalType === 'hiring' || it.signalType === 'leadership';

  if (it.score >= 3) {
    if (isExpansionSignal) return 'expansion_signals';
    if (p >= 3) return 'worth_a_conversation';
    if (p === 2) return 'worth_a_conversation';
    // Strong trigger, low or unknown priority: a genuine discovery, but it has
    // not earned the top section. §10 gives it its own block.
    return 'new_on_the_radar';
  }

  if (it.score === 2) {
    if (isExpansionSignal) return 'expansion_signals';
    if (p >= 2) return 'track';
    return 'omitted';           // moderate trigger, low priority: "usually omit"
  }

  // Weak trigger. A high-priority company still earns a watchlist line, but
  // NEVER a featured slot — there is no why-now.
  if (p >= 2) return 'watchlist';
  return 'omitted';
}

/**
 * Sort key within a section. Higher is better.
 *
 * Deliberately NOT a learned or weighted model — brief §14 excludes learned
 * ranking ("log the data, do not model it"). This is a transparent tiebreak an
 * RD can predict: trigger strength, then company priority, then Singapore fit,
 * then how widely the story was carried, then recency.
 */
export function rankScore(it: PlacementInput): number {
  return (
    it.score * 1_000_000 +
    priorityScore(it.targetPriority) * 100_000 +
    priorityScore(it.singaporeFit) * 10_000 +
    Math.min(it.clusterSize, 40) * 100 +
    (it.publishedAt ? Math.max(0, 60 - daysOld(it.publishedAt)) : 30)
  );
}

const daysOld = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86400_000);

/**
 * ONE company appears at most once in the featured sections.
 *
 * Clustering already collapses one story into one item, but a company can have
 * two genuinely different stories in a week — a raise AND an APAC hire. Both in
 * the digest reads as padding, and §1's cap makes every slot expensive. The
 * strongest one is kept; the other is available on the dashboard.
 *
 * expansion_signals is EXEMPT: a company appearing there for a Singapore role
 * and in 'worth a conversation' for a raise is the co-occurrence the design is
 * hunting for (§7: "an APAC job posting plus a recent raise is a 3"), not
 * repetition.
 */
const FEATURED: Section[] = ['worth_a_conversation', 'track', 'new_on_the_radar', 'context'];

export function dedupeByCompany(items: Placed[]): { kept: Placed[]; dropped: Placed[] } {
  const seen = new Set<number>();
  const kept: Placed[] = [];
  const dropped: Placed[] = [];
  for (const it of items) {
    if (!FEATURED.includes(it.section) || it.companyId === null) { kept.push(it); continue; }
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
 * RATIONALE §10 calls this "the only defence against the ranking going
 * permanently blind to a category". So it is deliberately NOT the best of the
 * cut items — that would just extend the ranking. It favours a signal type that
 * did not otherwise make the digest, which is what makes it a probe rather than
 * an overflow slot.
 */
export function pickExploration(cut: PlacementInput[], featuredSignalTypes: Set<string>): PlacementInput | null {
  const eligible = cut.filter((c) => c.score >= 1 && c.score <= 2);
  if (!eligible.length) return null;

  const unrepresented = eligible.filter((c) => !featuredSignalTypes.has(c.signalType));
  const pool = unrepresented.length ? unrepresented : eligible;
  return pool.sort((a, b) => rankScore(b) - rankScore(a))[0];
}

export type DigestPlan = {
  sections: Record<Section, Placed[]>;
  exploration: Placed | null;
  counts: {
    scored: number;
    placed: number;
    omitted: number;
    capped: number;
    company_deduped: number;
  };
};

/** Build the full plan: assign, sort, dedupe, cap, then add the exploration slot. */
export function planDigest(input: PlacementInput[]): DigestPlan {
  const assigned: Placed[] = input
    .map((it) => ({ ...it, section: assignSection(it), rank: rankScore(it) }))
    .sort((a, b) => b.rank - a.rank);

  const { kept, dropped } = dedupeByCompany(assigned);

  const sections = Object.fromEntries(SECTIONS.map((s) => [s, [] as Placed[]])) as Record<Section, Placed[]>;
  let capped = 0;
  for (const it of kept) {
    const cap = SECTION_CAPS[it.section];
    const bucket = sections[it.section];
    if (cap !== undefined && bucket.length >= cap) {
      // Over the cap: it is NOT deleted, it moves to omitted so the count is
      // visible and the dashboard can still show it.
      sections.omitted.push({ ...it, section: 'omitted' });
      capped++;
      continue;
    }
    bucket.push(it);
  }

  // Exploration is chosen from everything that did not make a featured section.
  const featuredTypes = new Set(
    FEATURED.flatMap((s) => sections[s]).concat(sections.expansion_signals).map((i) => i.signalType),
  );
  const cutPool = [...sections.omitted, ...sections.watchlist, ...dropped];
  const explore = pickExploration(cutPool, featuredTypes);
  const exploration = explore
    ? { ...explore, section: 'exploration' as Section, rank: rankScore(explore) }
    : null;

  return {
    sections,
    exploration,
    counts: {
      scored: input.length,
      placed: FEATURED.concat('expansion_signals').reduce((n, s) => n + sections[s].length, 0) + (exploration ? 1 : 0),
      omitted: sections.omitted.length,
      capped,
      company_deduped: dropped.length,
    },
  };
}

/** §10 header line. "monitored/processed", never "screened" — that would overclaim. */
export function coverageLine(companiesMonitored: number, signalsProcessed: number, surfaced: number): string {
  return `Monitored ${companiesMonitored.toLocaleString()} companies, processed ${signalsProcessed.toLocaleString()} signals, ${surfaced} surfaced`;
}
