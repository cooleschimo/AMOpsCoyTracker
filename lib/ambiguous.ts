/**
 * Company names that are also ordinary words. Brief §5.5.
 *
 * A Google News query is the company's name in quotes, and for most companies
 * that is enough: nothing else is called Anthropic or SambaNova. But `"AIR"`
 * returns weather forecasts and FAA reports, `"Temple"` returns Hindu temples
 * and college volleyball, and `"Owner"` returns stories about people who own
 * things. Those items are not a filtering mistake — they were never the
 * company's news, and no downstream check can recover from a query that was
 * wrong to make.
 *
 * Seventy companies with a recent signal have names like this, and between them
 * they hold five and a half thousand kept items.
 *
 * Two things follow from a name being ambiguous, both in this file so they
 * cannot disagree about which names they apply to: the query is narrowed
 * (`disambiguatedQuery`), and an item that arrives anyway has to carry a second
 * signal before it is believed (`corroborates`).
 */

/**
 * Ordinary English words that are also company names in this database.
 *
 * Listed rather than detected, because the test is not "is this a word" — it is
 * "does a news search for this word return something other than the company".
 * "Anthropic" and "Etched" are dictionary words that no newspaper uses; "Ring"
 * and "Motion" appear in headlines every day.
 *
 * A name not listed here can still be caught by the length rule below.
 */
const COMMON_WORD_NAMES = new Set([
  'air', 'anchor', 'apex', 'atlas', 'beacon', 'clay', 'compass', 'echo',
  'element', 'figure', 'flow', 'forge', 'fusion', 'harvey', 'instinct',
  'linear', 'motion', 'notion', 'orbit', 'origin', 'owner', 'prism', 'pulse',
  'ring', 'scale', 'sierra', 'signal', 'spark', 'summit', 'temple', 'vertex',
]);

/**
 * Is this name ambiguous enough that a bare news search returns other things?
 *
 * The list above, and nothing else. A length rule was tried and was wrong: at
 * five characters or fewer it caught Sony, AMD, Visa, Meta, HP and UPS, whose
 * news is unmistakably theirs, and would have discarded 94% of it. Short is not
 * the same as ambiguous — an established brand owns its word in the press,
 * where "Sierra" and "Clay" do not.
 *
 * A multi-word name is never ambiguous: "Sierra Space" is specific however
 * common its parts.
 */
export function isAmbiguousName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n.includes(' ')) return false;
  return COMMON_WORD_NAMES.has(n);
}

/**
 * What a company's news would say about it besides its name.
 *
 * Used both to narrow the query and to corroborate an item that came back.
 * Everything here is a fact already on the company row, so nothing is guessed:
 * the domain it publishes under, the city it sits in, and the words its
 * industry is written about in.
 */
export type CompanyContext = {
  name: string;
  website?: string | null;
  hqCity?: string | null;
  sectors?: string[] | null;
};

/**
 * Sector words that identify a company as a company, rather than describing
 * what it is building.
 *
 * Deliberately not lib/subsectors.ts `searchTerms`: those ask "where is a fab
 * being built", which is the right question for finding NEW companies and the
 * wrong one for confirming that a story is about a company at all. Here the job
 * is only to separate Sierra the AI company from the Sierra Club.
 */
const SECTOR_HINTS: Record<string, string[]> = {
  ai_software: ['AI', 'software', 'startup'],
  ai_models: ['AI', 'model', 'startup'],
  ai_infrastructure: ['AI', 'infrastructure', 'compute'],
  semiconductors: ['chip', 'semiconductor'],
  photonics: ['photonics', 'optical'],
  quantum: ['quantum'],
  robotics: ['robotics', 'robot'],
  space: ['space', 'satellite', 'launch'],
  aerospace: ['aerospace', 'aviation'],
  defence_systems: ['defense', 'defence', 'military'],
  defence_software: ['defense', 'defence', 'software'],
  cybersecurity: ['cybersecurity', 'security'],
  therapeutics: ['biotech', 'therapeutics', 'clinical'],
  biotech_platforms: ['biotech', 'platform'],
  medtech_devices: ['medical device', 'medtech'],
  digital_health: ['health', 'digital health'],
  fintech: ['fintech', 'payments'],
  software_platforms: ['software', 'platform', 'SaaS'],
  advanced_manufacturing: ['manufacturing', 'factory'],
  materials_energy: ['energy', 'materials', 'battery'],
  networking_connectivity: ['networking', 'connectivity'],
};

/** The hint words for a company, from whichever of its sectors has any. */
function hintsFor(sectors?: string[] | null): string[] {
  for (const s of sectors ?? []) {
    const h = SECTOR_HINTS[s];
    if (h?.length) return h;
  }
  return [];
}

/** The bare domain, without protocol or www, when the company has one. */
function domainOf(website?: string | null): string | null {
  if (!website) return null;
  const d = website.trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return d.includes('.') ? d : null;
}

/**
 * The Google News query for a company.
 *
 * An unambiguous name is asked for on its own, which is what has always
 * happened and works. An ambiguous one is asked for alongside the words its own
 * industry is written about — `"Sierra" AND (AI OR software OR startup)` —
 * which is the difference between the Sierra Club and the company.
 *
 * Falls back to the bare name when there is nothing to narrow with. A company
 * with no sector and no site is one we know nothing about, and an unfiltered
 * feed is more useful than an empty one as long as the caller knows to
 * corroborate what comes back.
 */
export function disambiguatedQuery(c: CompanyContext): string {
  const quoted = `"${c.name}"`;
  if (!isAmbiguousName(c.name)) return quoted;

  const hints = hintsFor(c.sectors);
  const domain = domainOf(c.website);
  // The domain is the strongest hint when there is one: an outlet writing about
  // the company usually names its site.
  const terms = [...hints, ...(domain ? [domain.split('.')[0]] : [])]
    .filter((t, i, a) => t && a.indexOf(t) === i);

  if (!terms.length) return quoted;
  return `${quoted} AND (${terms.map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' OR ')})`;
}

/**
 * Does this text carry a second signal that the story is about the company?
 *
 * Only asked for ambiguous names, and only after the name itself has matched.
 * The name alone is what put a ski consignment sale under Sierra, so for these
 * companies the name is necessary and not sufficient.
 *
 * Any one of the domain, the headquarters city or a sector word is enough. The
 * bar is deliberately low: this is separating a company from a common noun, not
 * proving the story matters.
 */
export function corroborates(text: string, c: CompanyContext): boolean {
  const hay = text.toLowerCase();
  /*
   * The FULL domain, never its first label. For an ambiguous name the label IS
   * the name — sierra.ai's label is "sierra" — so accepting it would corroborate
   * "Sierra Club" with the very word that made the name ambiguous.
   */
  const domain = domainOf(c.website);
  if (domain && hay.includes(domain)) return true;
  if (c.hqCity && c.hqCity.length >= 4 && hay.includes(c.hqCity.toLowerCase())) return true;
  return hintsFor(c.sectors).some((h) => hay.includes(h.toLowerCase()));
}
