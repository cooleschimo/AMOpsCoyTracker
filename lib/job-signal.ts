/**
 * Turning job postings into one hiring-pattern item per company. Brief §5.5.
 *
 * The item is an aggregated read on a company's hiring trend. A row per posting
 * would put every individual job into the digest as its own candidate line —
 * 231 of them for Databricks alone, each restating a single fact — and a batch
 * of near-identical postings is exactly the uniform batch that drives the
 * scoring model to answer 'unknown' for everything in it (§7).
 *
 * Individual postings stay in `job_postings` with their URLs, so every claim in
 * a digest line remains checkable (§15: an edge without a source_url is
 * worthless).
 *
 * What kind of role matters as much as how many. Fourteen Singapore account
 * executives is a company selling into the market; fourteen process engineers is
 * a company siting operations there. Those are different FDI propositions, and a
 * bare head count flattens them together.
 */

/**
 * Function buckets. Deterministic, no tokens, editable — brief §12a names
 * config files as safe for a non-TypeScript maintainer to change.
 *
 * Order matters: the first match wins, so the more specific patterns come first.
 * Seniority is a separate axis, handled below, because a Director of Engineering
 * belongs to both.
 */
export const FUNCTION_BUCKETS = [
  { key: 'manufacturing', re: /\b(manufactur|production|fab\b|cleanroom|process engineer|supply chain|logistics|assembly|hardware technician|facilities|plant\b)/i },
  { key: 'rnd',           re: /\b(research scientist|research engineer|scientist|r&d|principal investigator|computational|bioinformatic|chemist|biolog|physicist|phd\b)/i },
  { key: 'engineering',   re: /\b(engineer|developer|architect|sre\b|devops|infrastructure|data (scientist|engineer)|machine learning|software|technical staff|security)/i },
  { key: 'sales_gtm',     re: /\b(sales|account (executive|manager|director)|business development|bd\b|partnership|channel|revenue|marketing|growth|customer success|solutions consultant|pre-?sales|gtm|go.to.market)/i },
  { key: 'support',       re: /\b(support|success|operations|program manager|project manager|recruit|people|hr\b|talent|finance|legal|counsel|accounting|administrat|office manager)/i },
] as const;

export type FunctionKey = (typeof FUNCTION_BUCKETS)[number]['key'] | 'other';

/**
 * Classify a posting. The board's own department field is checked first, since a
 * company that says "Field Engineering" knows better than a title regex; the
 * title is the fallback.
 */
export function classifyFunction(title: string, department?: string | null): FunctionKey {
  const hay = `${department ?? ''} ${title}`;
  for (const b of FUNCTION_BUCKETS) if (b.re.test(hay)) return b.key;
  return 'other';
}

/**
 * Seniority from the title. Free, present on every posting where salary is not,
 * and a good commitment signal: a company hiring an APJ director is more
 * committed to the region than one hiring two junior account executives.
 */
export type Seniority = 'exec' | 'director' | 'manager' | 'senior' | 'ic' | 'junior';

export function classifySeniority(title: string): Seniority {
  const t = title.toLowerCase();
  if (/\b(chief|cto|ceo|cfo|coo|vp\b|vice president|head of|general manager|country manager|managing director)\b/.test(t)) return 'exec';
  if (/\b(director|principal|distinguished|fellow)\b/.test(t)) return 'director';
  if (/\b(manager|lead\b|leader|supervisor)\b/.test(t)) return 'manager';
  if (/\b(senior|sr\.?|staff|iii|iv)\b/.test(t)) return 'senior';
  if (/\b(junior|jr\.?|intern|graduate|entry|associate|i{1,2}\b)\b/.test(t)) return 'junior';
  return 'ic';
}

/**
 * Salary extraction from posting content.
 *
 * Coverage is sharply asymmetric, so it travels with the figure (brief §5.5).
 * Measured on live boards: Anthropic disclosed pay on 460/469 US postings but
 * 12/58 non-US; Databricks on 90/101 US but 355/723 non-US, and none of its 28
 * Singapore roles. US pay-transparency law (CA/CO/NY) drives the US figure and
 * almost nothing compels it in APAC, so a salary figure here is usually a US
 * figure. §15 applies: show what the number covers rather than letting a partial
 * sample stand in for the picture.
 */
export type SalaryRange = { min: number; max: number; currency: string; period: 'year' | 'hour' };

const CURRENCY_RE = /(?:(US)?\$|USD|SGD|EUR|GBP|£|€|S\$)/i;

export function extractSalary(content: string): SalaryRange | null {
  // Greenhouse bodies arrive double-escaped: the HTML tags are themselves
  // entity-encoded (&lt;div class=&quot;pay-range&quot;&gt;) and the range
  // separator is an &mdash; sitting between two <span> elements. Decode twice
  // and strip tags only after both passes; stripping first hides every figure on
  // a board where 433 of 824 postings carry one.
  const decode = (t: string) => t
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&mdash;|&ndash;/gi, '-')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
  const text = decode(decode(content))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  // "$150,000 - $200,000" / "S$120,000 to S$160,000" / "USD 150000-200000"
  const m = text.match(
    /(US\$|S\$|\$|USD|SGD|EUR|GBP|£|€)\s*([\d,]{4,12})(?:\s*(?:-|–|—|to)\s*)(US\$|S\$|\$|USD|SGD|EUR|GBP|£|€)?\s*([\d,]{4,12})/i,
  );
  if (!m) return null;

  const min = Number(m[2].replace(/,/g, ''));
  const max = Number(m[4].replace(/,/g, ''));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return null;
  // Reject implausible ranges rather than emit a wrong number (§15).
  if (max > 10_000_000) return null;

  const sym = (m[1] || m[3] || '').toUpperCase();
  const currency =
    sym.includes('S$') || sym === 'SGD' ? 'SGD' :
    sym === '£' || sym === 'GBP' ? 'GBP' :
    sym === '€' || sym === 'EUR' ? 'EUR' : 'USD';

  // An hourly rate is a different fact from an annual band, so they stay apart.
  const period: 'year' | 'hour' = min < 500 || /per hour|hourly|\/ ?hr/i.test(text) ? 'hour' : 'year';
  return { min, max, currency, period };
}

/**
 * Singapore entity names hiding in posting metadata or content.
 *
 * Databricks' Greenhouse metadata carries, for example:
 *   "Company Assignment": "Databricks Asiapac Unified Analytics PTE.LTD."
 *
 * A PTE. LTD. is a Singapore-registered private limited company, so a posting
 * can name a Singapore entity outright — a free corroboration route for
 * sg_links, independent of the other sources.
 *
 * §5.3 still binds: a registration is a registration, not operational presence.
 * These are written with match_status 'probable' and the posting URL as the
 * source, and want ACRA status and incorporation date before anything treats
 * them as confirmed.
 */
export function extractSgEntity(text: string): string | null {
  if (!text) return null;
  const m = text.match(/([A-Z][A-Za-z0-9&.\- ]{2,60}?)\s*(PTE\.?\s?LTD\.?|PRIVATE LIMITED)/i);
  if (!m) return null;
  const name = `${m[1].trim()} ${m[2].trim()}`.replace(/\s+/g, ' ').trim();
  return name.length >= 8 ? name : null;
}

/* ------------------------------------------------------------------ */
/* The aggregate                                                       */
/* ------------------------------------------------------------------ */

export type PostingLite = {
  title: string;
  location: string | null;
  department: string | null;
  content: string | null;
  isNonUs: boolean;
  isApac: boolean;
  url: string;
};

export type HiringPattern = {
  total: number;
  nonUs: number;
  apac: number;
  /** country -> count, non-US only, most common first */
  countries: Array<[string, number]>;
  /** function -> count, APAC roles only — the "what kind" half of the signal */
  apacFunctions: Array<[FunctionKey, number]>;
  apacSeniority: Array<[Seniority, number]>;
  apacTitles: string[];
  /** function -> count for SINGAPORE roles only. The headline uses this when
   *  Singapore roles exist: the APAC-wide mix can be engineering-led while the
   *  Singapore roles are all sales, and it is Singapore the digest is about. */
  sgFunctions: Array<[FunctionKey, number]>;
  singaporeCount: number;
  singaporeTitles: string[];
  salary: { disclosed: number; of: number; sample: SalaryRange | null };
  sgEntities: string[];
};

/** Country from a free-text location. Best effort; unknown stays unknown. */
const COUNTRY_RE: Array<[string, RegExp]> = [
  ['Singapore', /\bsingapore\b/i],
  ['Japan', /\b(japan|tokyo|osaka)\b/i],
  ['India', /\b(india|bengaluru|bangalore|mumbai|delhi|hyderabad|pune|chennai)\b/i],
  ['China', /\b(china|shanghai|beijing|shenzhen)\b/i],
  ['Hong Kong', /\bhong kong\b/i],
  ['Taiwan', /\b(taiwan|taipei)\b/i],
  ['South Korea', /\b(korea|seoul)\b/i],
  ['Australia', /\b(australia|sydney|melbourne|canberra|australian capital)\b/i],
  ['New Zealand', /\bnew zealand\b/i],
  ['Indonesia', /\b(indonesia|jakarta)\b/i],
  ['Malaysia', /\b(malaysia|kuala lumpur)\b/i],
  ['Thailand', /\b(thailand|bangkok)\b/i],
  ['Vietnam', /\b(vietnam|hanoi|ho chi minh)\b/i],
  ['Philippines', /\b(philippines|manila)\b/i],
  ['United Kingdom', /\b(united kingdom|uk\b|london|england|scotland)\b/i],
  ['Ireland', /\b(ireland|dublin)\b/i],
  ['Germany', /\b(germany|berlin|munich|hamburg)\b/i],
  ['France', /\b(france|paris)\b/i],
  ['Netherlands', /\b(netherlands|amsterdam)\b/i],
  ['Spain', /\b(spain|madrid|barcelona)\b/i],
  ['Switzerland', /\b(switzerland|zurich|geneva)\b/i],
  ['Israel', /\b(israel|tel aviv)\b/i],
  ['Canada', /\b(canada|toronto|vancouver|montreal|ontario)\b/i],
  ['Poland', /\b(poland|warsaw|krakow)\b/i],
  ['Brazil', /\b(brazil|sao paulo)\b/i],
  ['Mexico', /\bmexico\b/i],
  ['UAE', /\b(uae|dubai|abu dhabi)\b/i],
];

export function countryOf(location: string | null): string | null {
  if (!location) return null;
  for (const [name, re] of COUNTRY_RE) if (re.test(location)) return name;
  return null;
}

const tally = <T extends string>(xs: T[]): Array<[T, number]> => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

export function summarisePostings(postings: PostingLite[]): HiringPattern {
  const nonUs = postings.filter((p) => p.isNonUs);
  const apac = postings.filter((p) => p.isApac);
  const sg = postings.filter((p) => /\bsingapore\b/i.test(p.location ?? ''));

  const countries = tally(
    nonUs.map((p) => countryOf(p.location)).filter((c): c is string => c !== null),
  );

  // Salary is measured over non-US postings, the population the FDI question is
  // about. Measured over all postings, the near-complete US disclosure rate
  // masks the APAC gap.
  let disclosed = 0;
  let sample: SalaryRange | null = null;
  for (const p of nonUs) {
    const s = p.content ? extractSalary(p.content) : null;
    if (s) { disclosed++; if (!sample) sample = s; }
  }

  const sgEntities = new Set<string>();
  for (const p of postings) {
    const e = extractSgEntity(`${p.content ?? ''}`);
    if (e) sgEntities.add(e);
  }

  return {
    total: postings.length,
    nonUs: nonUs.length,
    apac: apac.length,
    countries,
    apacFunctions: tally(apac.map((p) => classifyFunction(p.title, p.department))),
    apacSeniority: tally(apac.map((p) => classifySeniority(p.title))),
    apacTitles: apac.map((p) => p.title).slice(0, 25),
    sgFunctions: tally(sg.map((p) => classifyFunction(p.title, p.department))),
    singaporeCount: sg.length,
    singaporeTitles: sg.map((p) => p.title).slice(0, 15),
    salary: { disclosed, of: nonUs.length, sample },
    sgEntities: [...sgEntities],
  };
}

const FUNCTION_LABEL: Record<FunctionKey, string> = {
  manufacturing: 'manufacturing/operations',
  rnd: 'R&D/science',
  engineering: 'engineering',
  sales_gtm: 'sales/GTM',
  support: 'support/admin',
  other: 'other',
};

/**
 * MATERIALITY FLOOR for a hiring item.
 *
 * §5.5 puts an absolute floor under the VOLUME trigger (>=5 new roles on a base
 * of >=20) precisely because a percentage on a trivial base means nothing. The
 * location rule had no equivalent guard, and the first scored run showed why it
 * needs one: "LangChain has 1 open APAC role" was scored a 3 — a single sales
 * hire read as a decision window.
 *
 * One overseas role is a data point, not a moment. Two or more, or any role in
 * Singapore specifically, or a senior regional appointment (director+ carrying
 * an APAC/regional remit) clears the bar. Below it the postings are still
 * stored in job_postings and still counted in the snapshot — they simply do not
 * become a digest candidate on their own.
 */
export function hiringItemIsMaterial(h: HiringPattern): boolean {
  if (h.singaporeCount >= 1) return true;          // Singapore is the whole point
  if (h.apac >= 2) return true;                    // a pattern, not a single hire
  const seniorApac = h.apacSeniority.some(([s, n]) => (s === 'director' || s === 'exec') && n > 0);
  if (h.apac >= 1 && seniorApac) return true;      // a regional leader is material alone
  return false;
}

/** The digest-candidate headline. One line, specific, no invented numbers. */
export function buildHiringTitle(company: string, h: HiringPattern): string {
  if (h.singaporeCount > 0) {
    // The Singapore mix, which can differ from the APAC-wide one.
    const top = h.sgFunctions[0];
    const kind = top ? `, mostly ${FUNCTION_LABEL[top[0]]}` : '';
    return `${company} is hiring ${h.singaporeCount} role${h.singaporeCount === 1 ? '' : 's'} in Singapore${kind}, and ${h.apac} across APAC`;
  }
  if (h.apac > 0) {
    const where = h.countries.filter(([c]) => COUNTRY_RE.slice(0, 14).some(([n]) => n === c)).slice(0, 3).map(([c, n]) => `${c} ${n}`).join(', ');
    const top = h.apacFunctions[0];
    const kind = top ? `, mostly ${FUNCTION_LABEL[top[0]]}` : '';
    return `${company} has ${h.apac} open APAC roles${where ? ` (${where})` : ''}${kind}`;
  }
  return `${company} has ${h.nonUs} open roles outside the US, none in APAC`;
}

/** The snippet the model scores on. Facts only — every number is counted, never estimated. */
export function buildHiringSnippet(company: string, h: HiringPattern): string {
  const parts: string[] = [];
  parts.push(`${company} has ${h.total} open roles, ${h.nonUs} outside the US and ${h.apac} in APAC.`);

  if (h.countries.length) {
    parts.push(`Non-US locations: ${h.countries.slice(0, 6).map(([c, n]) => `${c} ${n}`).join(', ')}.`);
  }
  if (h.singaporeCount > 0) {
    parts.push(`Singapore roles (${h.singaporeCount}): ${h.singaporeTitles.slice(0, 8).join('; ')}.`);
  }
  if (h.sgFunctions.length) {
    parts.push(`Singapore role mix: ${h.sgFunctions.map(([f, n]) => `${FUNCTION_LABEL[f]} ${n}`).join(', ')}.`);
  }
  if (h.apacFunctions.length) {
    parts.push(`APAC role mix: ${h.apacFunctions.map(([f, n]) => `${FUNCTION_LABEL[f]} ${n}`).join(', ')}.`);
  }
  if (h.apacSeniority.length) {
    parts.push(`APAC seniority: ${h.apacSeniority.map(([s, n]) => `${s} ${n}`).join(', ')}.`);
  }
  // Coverage travels with the salary figure (§15).
  if (h.salary.disclosed > 0 && h.salary.sample) {
    const s = h.salary.sample;
    const fmt = (n: number) => n.toLocaleString('en-US');
    parts.push(`Pay disclosed on ${h.salary.disclosed} of ${h.salary.of} non-US postings (e.g. ${s.currency} ${fmt(s.min)}-${fmt(s.max)} per ${s.period}); most APAC postings disclose none.`);
  } else if (h.salary.of > 0) {
    parts.push(`No pay disclosed on any of the ${h.salary.of} non-US postings.`);
  }
  if (h.sgEntities.length) {
    parts.push(`Singapore entity named in postings: ${h.sgEntities.slice(0, 2).join('; ')}.`);
  }
  return parts.join(' ');
}
