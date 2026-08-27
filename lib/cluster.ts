/**
 * Near-duplicate clustering. Brief §7 stage 6.
 *
 * Character trigrams with Jaccard above ~0.7. RATIONALE §5 is explicit that 0.7
 * is "a starting point from general text-similarity practice, not tuned for news
 * clustering at this scale; expect to calibrate", so the threshold is a named
 * constant and the per-cluster sizes are logged.
 *
 * Only cluster heads get scored, which is what keeps the token budget viable:
 * eight outlets running the same funding story is one decision window.
 */

/** Normalise a headline before comparison: case, punctuation, and the
 *  publication suffix Google News appends. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function trigrams(s: string): Set<string> {
  const t = ` ${normalizeTitle(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export const JACCARD_THRESHOLD = 0.7;

/* ------------------------------------------------------------------ */
/* Key-term similarity — the second, stronger signal                  */
/* ------------------------------------------------------------------ */

/**
 * TRIGRAMS ALONE UNDER-MERGE NEWS. Outlets covering one story share its facts
 * and almost none of its phrasing:
 *   "Nvidia said to weigh Perplexity investment at $30B valuation"
 *   "NVIDIA Eyes Major Investment in Perplexity at Over $30 Billion Valuation"
 * Character overlap between those is near the level where genuinely unrelated
 * stories start merging, so no trigram threshold separates them.
 *
 * Key terms — proper nouns and money/number tokens — do: the set a human would
 * use to say "same story" is {nvidia, perplexity, investment, valuation,
 * num:30b}, and it is stable across rewordings.
 *
 * RATIONALE §5: the 0.7 figure is "a starting point from general
 * text-similarity practice, not tuned for news clustering at this scale."
 */
const STOPWORDS = new Set([
  'the','a','an','of','in','to','for','at','on','and','or','with','as','is','are',
  'be','by','from','its','it','this','that','new','could','may','said','says',
  'report','reports','plus','over','under','about','after','before','into','amid',
  'has','have','will','would','why','how','what','when','more','than','but','not',
]);

/**
 * Distinctive terms from a headline: capitalised words (entities) and
 * money/quantity tokens. `$30 billion`, `$30B` and `30 Billion` all normalise
 * to `num:30b`, because outlets write the same figure many ways.
 */
export function keyTerms(title: string): Set<string> {
  const out = new Set<string>();
  const s = (title || '').replace(/[’']s\b/g, '');

  for (const m of s.matchAll(/\$?\d[\d.,]*\s?(?:billion|million|bn|b|m)?\b/gi)) {
    let v = m[0].toLowerCase().replace(/[,\s$]/g, '');
    v = v.replace(/billion$/, 'b').replace(/million$/, 'm').replace(/bn$/, 'b');
    // Drop bare small integers: "3 reasons", "top 5" are not facts.
    if (/^\d+$/.test(v) && Number(v) < 100) continue;
    if (/\d/.test(v)) out.add(`num:${v}`);
  }
  for (const w of s.split(/[^A-Za-z0-9]+/)) {
    const lw = w.toLowerCase();
    if (w.length > 2 && !STOPWORDS.has(lw) && /^[A-Z]/.test(w)) out.add(lw);
  }
  return out;
}

export function keyTermJaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Two items are the same story when EITHER measure is convincing:
 *  - character trigrams above JACCARD_THRESHOLD (near-identical wording, e.g.
 *    a syndicated wire copy), or
 *  - key terms above KEYTERM_THRESHOLD (same entities and figures, different
 *    words) AND published within SAME_STORY_DAYS of each other.
 *
 * The date window is what keeps the key-term rule honest: a company's Series B
 * in March and Series C in August share {company, funding, valuation} but are
 * different events. Items with no date are compared on terms alone, since an
 * ATS aggregate has no publication date by construction.
 */
export const KEYTERM_THRESHOLD = 0.4;
export const SAME_STORY_DAYS = 5;

/**
 * Relaxed key-term threshold, used ONLY when two items are independently known
 * to describe the same KIND of event at the same company within the window.
 *
 * Coverage of one funding round splits between the raise ("Raises $1 Billion
 * Series C"), the valuation ("hits $13B valuation") and the effect ("Funding
 * will supercharge Blackbeard"), which share few key terms. Lowering the global
 * threshold far enough to catch them merges a company's genuinely distinct
 * stories — an outage, an S-1, a product launch — instead.
 *
 * Signal type breaks the tie: two 'funding' items about one company in one week
 * are the same round; a 'funding' item and a 'product_launch' item are not,
 * however similar the wording.
 */
export const KEYTERM_THRESHOLD_SAME_SIGNAL = 0.15;

/**
 * Source authority for choosing a cluster head. Brief §7: "keep the most
 * authoritative source as cluster head".
 *
 * Higher wins. The ordering is a judgment, not a measurement — an original
 * report beats an aggregator, and a wire beats a blog. Ties break on the
 * earliest publication, because the first outlet to carry a story is usually
 * the one that reported it.
 */
/**
 * Sources behind a hard paywall.
 *
 * A digest link an RD cannot open is worse than a slightly less authoritative
 * one, because checking the claim is the whole point (§15). Clustering already
 * collects the same story from many outlets, so when one of them is readable
 * that is the one to link — the authority ranking is about which report to
 * trust, and an unreadable report cannot be checked at all.
 *
 * Deliberately a SHORT list of hard paywalls, not metered or registration
 * walls: over-listing would push genuinely better reporting out of the head
 * position for no gain.
 */
const PAYWALLED = /wall street journal|wsj\b|financial times|\bft\.com|bloomberg|the information|the economist|barron|new york times|nytimes|washington post|nikkei|business insider/i;

export function isPaywalled(source: string): boolean {
  return PAYWALLED.test(source || '');
}

const AUTHORITY: Array<{ re: RegExp; rank: number }> = [
  { re: /reuters|bloomberg|financial times|wall street journal|the economist/i, rank: 100 },
  { re: /business wire|pr newswire|globenewswire/i, rank: 90 },
  { re: /techcrunch|the information|axios|forbes|cnbc|wired|ars technica/i, rank: 80 },
  { re: /job board/i, rank: 75 },
  { re: /venturebeat|the verge|engadget|fierce|endpoints|stat news/i, rank: 70 },
  { re: /prweb|einpresswire|openpr/i, rank: 10 },
];

export function sourceAuthority(source: string): number {
  let rank = 50;
  for (const { re, rank: r } of AUTHORITY) if (re.test(source)) { rank = r; break; }
  // A paywalled source drops below every open one. It stays IN the cluster —
  // nothing is dropped — it simply does not become the link the digest shows.
  return isPaywalled(source) ? rank - 60 : rank;
}

export type Clusterable = {
  id: number;
  title: string;
  source: string;
  publishedAt: Date | null;
  companyId: number | null;
  /**
   * Signal type from a PREVIOUS scoring pass, when one exists. Optional by
   * design: on a first run nothing is scored yet and clustering falls back to
   * the strict threshold, which is the safe direction — under-merging shows up
   * as repetition, over-merging silently hides a story.
   */
  signalType?: string | null;
};

/**
 * Group items into near-duplicate clusters and pick a head for each.
 *
 * Comparison is scoped by company: two items about different companies are
 * never the same story even when the headlines rhyme ("X raises $40M" and
 * "Y raises $40M" share a lot of trigrams). Untargeted wire items are compared
 * only against each other.
 */
export function clusterItems(list: Clusterable[]): Map<number, number[]> {
  const byCompany = new Map<string, Clusterable[]>();
  for (const it of list) {
    const key = it.companyId === null ? 'none' : String(it.companyId);
    const arr = byCompany.get(key);
    if (arr) arr.push(it); else byCompany.set(key, [it]);
  }

  /** head id -> member ids (including the head) */
  const clusters = new Map<number, number[]>();

  for (const group of byCompany.values()) {
    const grams = new Map<number, Set<string>>();
    const terms = new Map<number, Set<string>>();
    for (const it of group) {
      grams.set(it.id, trigrams(it.title));
      terms.set(it.id, keyTerms(it.title));
    }

    const sameStory = (a: Clusterable, b: Clusterable): boolean => {
      if (jaccard(grams.get(a.id)!, grams.get(b.id)!) >= JACCARD_THRESHOLD) return true;
      // Same company, same event type, same week: relax the term threshold,
      // because coverage of one event splits between the raise, the valuation
      // and the consequence, which share few words.
      const sameSignal = Boolean(a.signalType && b.signalType && a.signalType === b.signalType);
      const threshold = sameSignal ? KEYTERM_THRESHOLD_SAME_SIGNAL : KEYTERM_THRESHOLD;
      if (keyTermJaccard(terms.get(a.id)!, terms.get(b.id)!) < threshold) return false;
      // Key terms matched: require the dates to be close, so a Series B and a
      // Series C at one company do not merge on {company, funding, valuation}.
      if (!a.publishedAt || !b.publishedAt) return true;
      const days = Math.abs(a.publishedAt.getTime() - b.publishedAt.getTime()) / 86400_000;
      return days <= SAME_STORY_DAYS;
    };

    const assigned = new Set<number>();
    for (const it of group) {
      if (assigned.has(it.id)) continue;
      const members = [it];
      assigned.add(it.id);
      for (const other of group) {
        if (assigned.has(other.id)) continue;
        // Compare against ANY member already in the cluster, not just the seed:
        // coverage of one story drifts in wording across outlets, so a chain of
        // pairwise matches captures it where seed-only comparison would not.
        if (members.some((m) => sameStory(m, other))) {
          members.push(other);
          assigned.add(other.id);
        }
      }
      // Head = highest authority, earliest publication as the tiebreak.
      members.sort((a, b) => {
        const d = sourceAuthority(b.source) - sourceAuthority(a.source);
        if (d !== 0) return d;
        const at = a.publishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bt = b.publishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return at - bt;
      });
      clusters.set(members[0].id, members.map((m) => m.id));
    }
  }
  return clusters;
}
