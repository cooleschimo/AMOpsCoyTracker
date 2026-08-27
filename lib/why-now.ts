/**
 * Merging why-now points across a company's items.
 *
 * Company scoring produces one set of points per company. Where points still
 * arrive per item — a rescore under an older rubric version, or a company whose
 * signal has not been computed yet — this assembles them into one list, ordered
 * so the featured item leads and hiring evidence follows.
 *
 * Every merged point was checked against its own source when that item was
 * scored, so composition costs no model call and invents nothing.
 */

export type ContextPoint = {
  text: string;
  /** The item this point came from, so the merged list stays checkable. */
  itemId: number;
  sourceType: string;
  publishedAt: Date | null;
  /** True for the item being featured; those points lead. */
  primary: boolean;
};

export type WhyNowInput = {
  itemId: number;
  why: string;
  sourceType: string;
  publishedAt: Date | null;
};

/** The stored `why` is ' · '-joined points. */
export const splitPoints = (why: string): string[] =>
  (why ?? '').split(' · ').map((w) => w.trim()).filter(Boolean);

/**
 * Near-duplicate detection across points from different items.
 *
 * Several outlets covering one raise produce several near-identical points, and
 * a merged list that says "Raised $360M" three times is worse than one that
 * says it once. Compared on significant words rather than characters, so
 * "Raised $360M credit facility" and "Secured $360M revolving credit" collapse.
 */
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'to', 'for', 'at', 'on', 'and',
  'or', 'with', 'as', 'is', 'are', 'no', 'not', 'its', 'it', 'this', 'that', 'by', 'from']);

function signature(point: string): Set<string> {
  return new Set(
    point.toLowerCase()
      .replace(/[^a-z0-9$%. ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function similar(a: string, b: string): boolean {
  const sa = signature(a), sb = signature(b);
  if (!sa.size || !sb.size) return false;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / Math.min(sa.size, sb.size) >= 0.6;
}

/**
 * Merge the featured item's points with points from the company's other items.
 *
 * Ordering is deliberate:
 *  1. the featured item's own points — it is why this is in the digest
 *  2. hiring evidence — the signal class no competing digest has (RATIONALE §4),
 *     and the other half of the co-occurrence rule
 *  3. everything else, most recent first
 *
 * `maxPoints` is a ceiling, not a quota. A company with one fact gets one
 * point; padding is what this module exists to prevent.
 */
export function assembleWhyNow(
  featured: WhyNowInput,
  others: WhyNowInput[],
  maxPoints = 4,
): ContextPoint[] {
  const out: ContextPoint[] = [];

  const push = (text: string, from: WhyNowInput, primary: boolean) => {
    if (out.length >= maxPoints) return;
    if (out.some((p) => similar(p.text, text))) return;
    out.push({
      text, itemId: from.itemId, sourceType: from.sourceType,
      publishedAt: from.publishedAt, primary,
    });
  };

  for (const p of splitPoints(featured.why)) push(p, featured, true);

  // Hiring first among the rest: an APAC posting alongside a raise is the
  // co-occurrence §7 scores as a 3, and it is invisible from one item alone.
  const rest = [...others].sort((a, b) => {
    const ah = a.sourceType === 'ats' ? 0 : 1;
    const bh = b.sourceType === 'ats' ? 0 : 1;
    if (ah !== bh) return ah - bh;
    return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  });

  for (const o of rest) {
    for (const p of splitPoints(o.why)) push(p, o, false);
  }
  return out;
}

/**
 * Whether the merged list shows co-occurrence — hiring evidence alongside a
 * corporate event. §7 lifts that to a 3, and the digest should say so rather
 * than leaving a reader to notice.
 */
export function hasCoOccurrence(points: ContextPoint[]): boolean {
  const hiring = points.some((p) => p.sourceType === 'ats');
  const other = points.some((p) => p.sourceType !== 'ats');
  return hiring && other;
}
