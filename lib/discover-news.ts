/**
 * Finding companies in news that names nobody we track. Brief §5.5, step 16.
 *
 * Company-directed search can only find news about companies already on the
 * list: it asks Google for `"Etched"` and gets back Etched. That makes it a
 * monitor, not a discovery route, and it is why 69 of 71 companies scored in a
 * week came from the hand-imported list.
 *
 * Meanwhile the untargeted feeds — press wires and the sector trade press —
 * carry exactly the companies nobody has heard of yet:
 *
 *   "Quintessent Raises $40 Million Series A and Begins Sampling First Product"
 *   "Celera Semiconductor Announces the Closing of a $30M Series B Financing"
 *   "Agentrys Raises $24.5 Million to Build Agentic Design Automation"
 *
 * Those sat in the database as `no_company_match` drops. The subject of the
 * sentence is a company worth knowing about, and reading it out is the cheapest
 * discovery route available.
 *
 * A fundraise headline is the case worth mining, for two reasons. It names the
 * company as the grammatical subject, which is what makes extraction reliable
 * without a model; and the round size says whether the company is at the stage
 * an approach can still influence.
 *
 * Nothing here decides a company is in scope. It proposes a name, a round and a
 * source, and the ordinary assessment decides — the same bar every Form D
 * discovery passes.
 */
import { parseFundraise, type Fundraise } from './fundraise';

export type NewsCandidate = {
  name: string;
  /** "City, ST" or "City, Country" when the model could tell. */
  hq?: string | null;
  round: string | null;
  amountUsd: number | null;
  valuationUsd: number | null;
  itemId: number;
  title: string;
  source: string;
  url: string;
};

/**
 * Words that end a company name. A headline is "X raises $40M to do Y", so the
 * name is what precedes the verb — but only when the verb is the company's.
 */
/**
 * The verb that ends the subject. Everything before it is the company.
 *
 * Going public is here alongside raising: a listing is a financing event the
 * round vocabulary has no word for, and the headline puts the company in the
 * same place — "Perplexity Files to Go Public", "Freenome Goes Public in $310M
 * SPAC Deal". Without it, lib/fundraise.ts recognised the event and this
 * returned null for the name, so nothing was created either way.
 */
const RAISE_VERB =
  /\s+\b(raises?|raised|raising|secures?|secured|closes?|closed|lands?|landed|nets?|netted|banks?|announces?|announced|completes?|completed|emerges?|emerged|launches?|launched|(?:to\s+)?(?:goes?|go) public|going public|files?|filed|prices?|priced|(?:to\s+)?debuts?|debuted|(?:to\s+)?lists?|listed|begins? trading)\b/i;

/**
 * Openers that mean the subject is not the company: a publication crediting
 * itself, or a story about someone else's money.
 */
const NOT_THE_COMPANY =
  /^(exclusive|breaking|update|report|opinion|analysis|watch|video|podcast|interview|profile|q&a|explainer|sponsored|paid post)\b[:\s-]*/i;

/**
 * Descriptive lead-ins a headline puts before the name — "Fashion startup
 * Atorie raises…", "Antler-backed Indian space startup InspeCity raises…".
 * The name is the proper noun at the end, and everything before it is the
 * outlet telling its readers who this is.
 */
const LEAD_IN =
  /^(?:[\w.-]+-backed\s+)?(?:[\w-]+\s+){0,5}?\b(startup|start-up|company|firm|maker|manufacturer|developer|platform|scaleup|scale-up|unicorn|venture|lab|group)\s+/i;

/**
 * A name that is only a category — "Defense startup", "Austin startup", "SG
 * travel startup". LEAD_IN cannot catch these: it requires something after the
 * category word to strip down to, and here there is nothing after it.
 *
 * This is what let "Defense startup" become a company row that then collected
 * 88 stories about a dozen different firms — Aitan, Ursa Major, Quantum
 * Systems — and read as one company with remarkable momentum.
 *
 * Anchored at the end, so a real name CONTAINING one of these words survives:
 * ARCH Venture Partners and Martin & Company are companies, "Defense startup"
 * is a description of one.
 */
const CATEGORY_WORD =
  /^(startup|start-up|company|firm|maker|manufacturer|developer|scaleup|scale-up|unicorn|venture|ventures|business)s?$/i;

/**
 * Words that describe a company without identifying it — the modifiers an
 * outlet puts in front of "startup" when it has not named the company.
 */
const DESCRIPTOR =
  /^(a|an|the|new|young|early|late|first|second|largest|biggest|top|local|foreign|domestic|global|regional|leading|emerging|stealth|sg|us|uk|eu|ai|defen[cs]e|fintech|biotech|healthtech|edtech|insurtech|proptech|agritech|cleantech|deeptech|space|quantum|robot|robotics|humanoid|drone|chip|semiconductor|travel|fashion|energy|mobility|logistics|austin|boston|seattle|london|berlin|paris|singapore|indian|chinese|japanese|korean|german|french|british|american|european|asian)$/i;

/**
 * Whether a name is a category rather than a company, for callers that get a
 * name from somewhere other than the headline parser — the model's extraction
 * returns a string, and telling it not to return a category is not the same as
 * enforcing it.
 */
export function isCategoryName(name: string): boolean {
  const words = name.trim().split(/\s+/);
  // The last word has to be the category itself — "Defense startup", not
  // "Anduril".
  if (!words.length || !CATEGORY_WORD.test(words[words.length - 1])) return false;
  // And every word before it has to be a descriptor rather than a name. This is
  // what separates "Defense startup" and "SG travel startup" from "Uplift
  // Ventures" and "Martin & Company", which are the names companies actually
  // registered.
  return words.slice(0, -1).every((w) => DESCRIPTOR.test(w));
}

/** A name that is really a country, a sector or a publication. */
const NOT_A_COMPANY =
  /^(the|a|an|this|these|those|new|top|best|why|how|what|when|where|india|china|singapore|us|uk|eu|europe|asia|apac|africa|startup|startups|vc|vcs|investors?|founders?|report|study|survey|market|markets|sector|industry)\b/i;

/**
 * A remnant that is only a corporate suffix, and so cannot be the whole name.
 * "Partners", "Technologies", "Labs" — each is the tail of a name, never one.
 */
const BARE_SUFFIX =
  /^(partners?|technologies|technology|systems|labs?|holdings?|group|ventures?|capital|industries|solutions|networks|sciences?)$/i;

/** Corporate suffixes worth keeping attached, so "Acme Inc" is not cut to "Acme". */
const KEEP_SUFFIX = /\b(inc|corp|corporation|llc|ltd|limited|plc|ag|sa|bv|gmbh|labs?|technologies|technology|systems|robotics|bio|biosciences|therapeutics|semiconductor|semiconductors|networks|health|medical|space|ai)\b\.?$/i;

/**
 * Read the company name out of a fundraise headline.
 *
 * Deliberately conservative: a headline whose shape is not "Company raises $X"
 * returns null rather than a guess. A wrong name here creates a company row
 * that then has to be found and merged, which costs more than the miss.
 */
export function companyFromHeadline(title: string): string | null {
  let t = title.trim().replace(NOT_THE_COMPANY, '');

  const m = t.match(RAISE_VERB);
  if (!m || m.index === undefined) return null;
  let name = t.slice(0, m.index).trim();

  /*
   * Strip a descriptive lead-in — "Fashion startup Atorie" is Atorie.
   *
   * When NOTHING survives the strip, the headline named a category rather than
   * a company: "Defense startup raises $61 million" has no name in it at all.
   * Keeping the unstripped text was how "Defense startup" became a company row
   * that then collected 88 stories about a dozen different firms — Aitan, Ursa
   * Major, Quantum Systems — each of which looked like momentum at one company.
   *
   * A lead-in that leaves a lowercase remnant is also a miss rather than a
   * name, so both cases return null instead of falling back.
   *
   * The strip is declined when the remnant is a bare corporate suffix: "ARCH
   * Venture Partners" would otherwise be cut to "Partners", because 'venture'
   * is a lead-in word in one company's description and part of another's actual
   * name. Keeping the whole thing is right whenever the tail alone is not a
   * name someone would recognise.
   */
  if (LEAD_IN.test(name)) {
    const stripped = name.replace(LEAD_IN, '').trim();
    if (!stripped || !/^[A-Z]/.test(stripped)) return null;
    if (!BARE_SUFFIX.test(stripped)) name = stripped;
  }

  // A possessive means the subject is a unit of something else — "Xpeng's
  // robotics unit" is not a company we can resolve, so it is left alone.
  if (/['’]s\b/.test(name)) return null;
  // A comma or colon before the verb means the subject was qualified, and what
  // remains before it is usually not the plain name.
  name = name.split(/[,:;–—]/)[0].trim();
  name = name.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}.'’&-]+$/u, '');
  // A trailing auxiliary or preposition belongs to the sentence, not the name.
  name = name.replace(/\s+\b(has|have|had|is|are|was|were|will|just|now|also|reportedly|said|says|to|set|plans?|prepares?)$/i, '').trim();

  if (!name) return null;
  if (NOT_A_COMPANY.test(name)) return null;
  if (isCategoryName(name)) return null;
  // A real name is short. Anything long is a sentence fragment.
  const words = name.split(/\s+/);
  if (words.length > 5) return null;
  if (name.length < 2 || name.length > 60) return null;
  // Must look like a proper noun: an initial capital somewhere.
  if (!/[A-Z]/.test(name)) return null;
  // A single lowercase word is a common noun, not a company.
  if (words.length === 1 && !/^[A-Z]/.test(name) && !KEEP_SUFFIX.test(name)) return null;

  return name;
}

/**
 * Headlines worth asking the model about.
 *
 * A fundraise is extractable without a model because its grammar is fixed —
 * "Company raises $X" puts the name in the subject and the figure confirms the
 * event. Every other event type is looser: "Japan seeks more H3 rocket
 * launches" and "CADDi Launches ITAR Support" are the same shape, and only one
 * of them names a company. Regex reads the first as a company called Japan.
 *
 * So the pattern below decides only what is WORTH READING, and the model
 * decides who the company is. Casting wide here is cheap; being wrong about a
 * name is not, because a bad row flows into assessment, scoring and the digest
 * before anyone notices it is a country.
 */
export const EVENT_RE =
  /\b(opens?|opening|expands?|expansion|new (plant|facility|factory|site|campus|centre|center)|breaks? ground|manufactur|production line|partners?|partnership|teams? up|collaborat|joint venture|alliance|signs? (a )?(deal|mou|agreement)|acquires?|acquisition|acquired|merges?|buys?|takeover|launches?|launched|unveils?|debuts?|introduces?|rolls? out|appoints?|names? (a )?(new )?(ceo|cto|cfo|president|head)|hires?|taps?|wins?|won|awarded|selected (by|for)|contract|fda (approval|clearance)|approval|cleared|certification|explores?|in talks|weighs?|plans? to|eyes?|considers?|to (build|open|invest|set up|establish|enter)|invests?|investment|backs?|scales?|doubles?|triples?|adds? \d+|hiring|IPO|files? for|valuation|stake)\b/i;

/**
 * Headlines in a language this pattern cannot read.
 *
 * The wires carry the same story in several languages — a FlightSafety
 * acquisition appeared in Chinese, French and Spanish on the same day. The
 * English version is usually present too, so these are passed to the model
 * rather than pattern-matched: it reads them, and the deduplicate-by-name step
 * keeps whichever arrives first.
 */
const NON_LATIN_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/** Items worth an extraction call: an event, and not already a fundraise. */
export function eventCandidates(
  items: Array<{ id: number; title: string; snippet: string | null; source: string; url: string }>,
): typeof items {
  return items.filter((it) => {
    if (!EVENT_RE.test(it.title) && !NON_LATIN_RE.test(it.title)) return false;
    // Fundraises are handled without a model; no point paying for them twice.
    const f = parseFundraise(it.title, it.snippet);
    if (f && (f.round !== null || f.amountUsd !== null)) return false;
    return true;
  });
}

export const EXTRACT_SYSTEM = `You read a news headline and name the company it is about.

Return the company only when the headline is about a specific, named, operating company — the kind an investment promotion agency could approach. Return null for everything else.

Name the company whether it is a household name or one nobody has heard of. Micron opening a fab and a seed-stage startup opening its first office are both worth knowing; they are handled differently later, not filtered out here.

Return null when the subject is:
- a country, city, region or government ("Japan seeks more rocket launches")
- a ministry, agency, regulator or multilateral body ("World Bank centre opens")
- a university, college, hospital or research institute
- an industry, market or sector in general ("India D2C firms raised $6b")
- a publication writing about others
- a division or unit described only by its parent ("Xpeng's robotics unit")
- a person

If two companies are named — a partnership or an acquisition — return the one the headline is ABOUT: the one doing the acquiring, opening, or launching. If that is genuinely ambiguous, return null.

Give the company's own name as it would write it, not the headline's description of it: "Antler-backed Indian space startup InspeCity" is InspeCity.

When the headline never names the company — "Defense startup raises $61 million", "Austin startup raises $10.3M" — return null. A category is not a name, and one row called "Defense startup" ends up collecting stories about dozens of unrelated companies.

Also give the company's headquarters when the headline, the outlet or your own knowledge of the company supports it. Give "city, ST" for a US company and "City, Country" otherwise. Return null for hq when you do not know — a guessed location is worse than an absent one, because it decides whether the company is in scope at all.

Return JSON only: {"results":[{"id":<number>,"company":"<name or null>","hq":"<city, ST | City, Country | null>","event":"<expansion|partnership|acquisition|product|leadership|contract|regulatory|other>"}]}`;

export function buildExtractPrompt(
  batch: Array<{ id: number; title: string; source: string }>,
): string {
  return `Name the company each headline is about, or null.

${batch.map((b) => `id ${b.id}: ${b.title}  [${b.source}]`).join('\n')}

Return one result per id, ${batch.length} in total.`;
}

/**
 * Candidates from a batch of untargeted items.
 *
 * `known` is the set of normalised names already in the database, so a company
 * we already track is not proposed again — the item simply belongs to it, which
 * is the entity-resolution step's job rather than this one's.
 */
export function candidatesFrom(
  items: Array<{ id: number; title: string; snippet: string | null; source: string; url: string }>,
  known: (name: string) => boolean,
): NewsCandidate[] {
  const out = new Map<string, NewsCandidate>();

  for (const it of items) {
    const f: Fundraise | null = parseFundraise(it.title, it.snippet);
    if (!f) continue;
    // A round or an amount is the evidence that this is a company raising
    // money. A headline with neither is about something else.
    if (f.round === null && f.amountUsd === null) continue;

    // A roundup is not a company. "Fierce Biotech Fundraising Tracker '26"
    // names several companies and is itself none of them.
    if (/\b(tracker|roundup|round-up|weekly|daily|digest|newsletter|this week in|top \d+|list of|deals? of the)\b/i.test(it.title)) continue;

    // The headline has to be about money coming IN. A results story states
    // figures in the same shapes — "narrows H2 net loss to S$19.5 million" —
    // and reads as a raise to anything looking only for a number.
    if (/\b(loss|losses|profit|revenue|earnings|writedown|write-down|impairment|deficit|fine|settlement|lawsuit|damages|valuation of its stake)\b/i.test(it.title)) continue;

    const name = companyFromHeadline(it.title);
    if (!name || known(name)) continue;

    // The same round is reported by several outlets; keep the first, which the
    // caller has ordered by recency.
    const key = name.toLowerCase();
    if (out.has(key)) continue;

    out.set(key, {
      name,
      round: f.round,
      amountUsd: f.amountUsd,
      valuationUsd: f.valuationUsd,
      itemId: it.id,
      title: it.title,
      source: it.source,
      url: it.url,
    });
  }
  return [...out.values()];
}
