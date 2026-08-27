/**
 * Executive hires into international and expansion roles.
 *
 * The strongest single signal available to an investment promotion agency,
 * because it names a decision-maker and demonstrates intent at the same time.
 * A company posting a Head of APAC has decided to have an APAC, and the person
 * who will own that decision is being recruited now.
 *
 * The distinction that matters is whether the role OWNS A REGION or merely
 * touches international work. "Compute Country Lead, Japan" owns Japan;
 * "Director, US International Tax" is a US finance role that happens to handle
 * cross-border filings, and "Head of Global Renewals" is sales operations.
 * Both would match a naive keyword search, and neither says anything about
 * where a company is going.
 */

/** Seniority high enough that the role carries a mandate. */
const EXEC_TITLE = /\b(chief|c[teo]o|cfo|cro|cso|president|vp|vice[\s-]president|svp|evp|head of|general manager|\bgm\b|managing director|country (lead|manager|head)|regional (lead|director|head|manager))\b/i;

/** A named region or market the role would own. */
const REGION = /\b(apac|asia[\s-]?pacific|asia|apj|aseanm?|southeast asia|japan|korea|china|india|singapore|taiwan|hong kong|australia|international|emea|latam|global)\b/i;

/**
 * Functions where "international" or "global" describes the paperwork rather
 * than a market mandate. A tax director handling cross-border filings, a
 * renewals lead covering global accounts, a payroll manager — none of these
 * indicate a company deciding where to operate.
 */
const BACK_OFFICE = /\b(tax|payroll|accounting|audit|compliance|treasury|order[\s-]to[\s-]cash|renewals|billing|procurement|deal desk|revenue operations|revops|controller|bookkeep)\b/i;

/**
 * Functions that carry a genuine expansion mandate. Supply chain is included
 * deliberately: a Chief Supply Chain Officer decides where things are made.
 */
const EXPANSION_FUNCTION = /\b(expansion|market entry|go[\s-]to[\s-]market|gtm|business development|country|regional|operations|supply chain|manufacturing|site|facilit|partnerships?|commercial)\b/i;

export type ExecHire = {
  title: string;
  location: string | null;
  url: string;
  /** The region the role owns, where one is named. */
  region: string | null;
  /** Why this counts, for the digest line. */
  basis: 'regional_mandate' | 'expansion_function';
};

export function classifyExecHire(title: string, location: string | null): ExecHire | null {
  const t = (title ?? '').trim();
  if (!t || !EXEC_TITLE.test(t)) return null;

  // A senior title in a back-office function is not an expansion signal, even
  // when the word "international" appears in it.
  if (BACK_OFFICE.test(t)) return null;

  const regionMatch = t.match(REGION) ?? (location ?? '').match(REGION);
  const region = regionMatch ? regionMatch[0] : null;

  // A role naming a region it owns is the clearest case.
  if (REGION.test(t)) {
    return { title: t, location, url: '', region, basis: 'regional_mandate' };
  }
  // Otherwise a senior expansion-function role sited outside the US still
  // indicates a company standing up something new somewhere.
  if (EXPANSION_FUNCTION.test(t) && region) {
    return { title: t, location, url: '', region, basis: 'expansion_function' };
  }
  return null;
}

/**
 * Rank a set of executive hires so the digest can name the most consequential.
 * A role owning APAC or a named Asian market outranks one owning "global",
 * which is often a headquarters role with a broad remit rather than a presence
 * somewhere new.
 */
const REGION_WEIGHT: Array<[RegExp, number]> = [
  [/\bsingapore\b/i, 100],
  [/\b(apac|asia[\s-]?pacific|apj|asean|southeast asia|asia)\b/i, 90],
  [/\b(japan|korea|china|india|taiwan|hong kong|australia)\b/i, 80],
  [/\binternational\b/i, 60],
  [/\b(emea|latam)\b/i, 40],
  [/\bglobal\b/i, 30],
];

export function execHireWeight(h: ExecHire): number {
  const hay = `${h.title} ${h.location ?? ''}`;
  for (const [re, w] of REGION_WEIGHT) if (re.test(hay)) return w;
  return 10;
}

export function rankExecHires(hires: ExecHire[]): ExecHire[] {
  return [...hires].sort((a, b) => execHireWeight(b) - execHireWeight(a));
}
