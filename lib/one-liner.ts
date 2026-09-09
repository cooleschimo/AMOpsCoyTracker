/**
 * One line on what a company does, for the dashboard card.
 *
 * This is compression, not research. Everything the model needs is already in
 * the row — a scraped website blurb, the sectors, the headline that surfaced
 * the company — and the job is to turn 300 characters of marketing into six
 * words a regional director can read while scanning.
 *
 * The hard part is not brevity but ABSTENTION. The evidence is often about the
 * wrong entity: enrich-websites stores whatever the search snippet said, so
 * Rolls-Royce arrives as a chauffeur hire service in Greenwich and Tesla as a
 * Dutch fan page. A model asked to always produce a line will happily describe
 * the wrong company confidently, and a wrong line under a company name is worse
 * than no line — the reader has no way to tell it is wrong. So null is a
 * first-class answer here, and the prompt asks for it by name.
 */

/** The longest line that still sits on one row under a company name. */
export const ONE_LINER_MAX = 80;

export const ONE_LINER_SYSTEM = `You write one-line descriptions of companies for an investment-promotion dashboard. Each line sits under a company name and is read in about a second.

RULES

1. Say what the company MAKES OR SELLS, and for whom if it fits. Nothing else.
2. At most ${ONE_LINER_MAX} characters. Aim for 40-60.
3. No marketing language. Not "leading", "innovative", "world-class", "revolutionary", "trusted by". If the evidence is all marketing, extract the underlying product and drop the adjectives.
4. No company name, no "The company", no full stop at the end. Write the predicate only.
5. Lower case except for proper nouns and acronyms.

ABSTAIN WHEN THE EVIDENCE IS NOT ABOUT THIS COMPANY

The evidence comes from automated web searches and is frequently about a
different entity with a similar name — a dealership rather than the manufacturer,
a fan site rather than the company, a consultancy that merely mentions it.

If the evidence does not clearly describe THIS company's own product, return null
for that company. Do the same when the evidence says only that something happened
to the company (a funding round, a lawsuit, an appointment) without saying what
the company does.

Returning null is the correct answer in those cases and costs nothing. A
confident description of the wrong company is a serious error — the reader
cannot tell it is wrong.

GOOD
  "clinical-stage cell therapy for blood and immune disease"
  "video-understanding AI models"
  "buy now, pay later instalments at point of sale"
  "autonomous home robots"

BAD
  "Orca Bio is a leading clinical-stage biotechnology company." (name, marketing, full stop)
  "chauffeur-driven car hire in Greenwich, CT" (wrong entity — should be null)
  "raised $5.3M to expand its platform" (an event, not what it does)

Return JSON: {"lines":[{"name":"<exact name given>","line":"<text or null>"}]}`;

export type OneLinerInput = {
  name: string;
  /** Sectors already classified, which narrow what the company could be. */
  sectors: string[];
  /** The raw capture from enrich-websites: meta tag or search snippet. */
  description: string | null;
  website: string | null;
  /** Headlines that surfaced the company — context, not a description. */
  headlines: string[];
};

export function buildOneLinerPrompt(companies: OneLinerInput[]): string {
  const blocks = companies.map((c) => {
    const parts = [`NAME: ${c.name}`];
    if (c.website) parts.push(`WEBSITE: ${c.website}`);
    if (c.sectors.length) parts.push(`SECTORS: ${c.sectors.join(', ')}`);
    /*
     * Labelled by provenance rather than merged. "Website blurb" is the
     * company's own words about itself; a search snippet is a third party's,
     * and is where the wrong-entity results come from. The model weighs them
     * differently, and cannot if they arrive as one undifferentiated blob.
     */
    if (c.description) {
      const raw = c.description;
      const label = raw.startsWith('Website:')
        ? 'WEBSITE BLURB'
        : raw.startsWith('Web search:')
          ? 'SEARCH SNIPPETS (may be about a different entity)'
          : raw.startsWith('Form D industry group:')
            ? 'FILED INDUSTRY CATEGORY (a category, not a description)'
            : 'NOTE';
      const body = raw.replace(/^(Website|Web search|Form D industry group):\s*/, '');
      parts.push(`${label}: ${body.slice(0, 500)}`);
    }
    if (c.headlines.length) {
      parts.push(`RECENT HEADLINES: ${c.headlines.slice(0, 2).map((h) => h.slice(0, 120)).join(' | ')}`);
    }
    return parts.join('\n');
  });

  return `Write one line for each company below.\n\n${blocks.join('\n\n---\n\n')}`;
}

/**
 * What the model returns, checked rather than trusted.
 *
 * A model told to abstain still sometimes writes "unknown" or "not clear from
 * the evidence", which would render as a description. Those are abstentions
 * spelled differently, so they are read as null rather than shown.
 */
const NON_ANSWERS = [
  'unknown', 'unclear', 'not clear', 'n/a', 'na', 'none', 'null', 'no information',
  'not enough information', 'cannot determine', 'not specified', 'not stated',
];

export function cleanOneLiner(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;

  // Models return typographic punctuation the rest of the dashboard does not
  // use — a non-breaking hyphen sets differently from every other line on the
  // card, and the difference is visible at this size.
  s = s.replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
       .replace(/[\u2018\u2019]/g, "'")
       .replace(/[\u201c\u201d]/g, '"')
       .replace(/[\u00a0\u2009\u202f]/g, ' ')
       .replace(/\s+/g, ' ');
  // Trailing full stop only: an internal one may be separating two clauses.
  s = s.replace(/\.$/, '').trim();
  // Models occasionally return the line already quoted.
  s = s.replace(/^["'`]|["'`]$/g, '').trim();

  if (!s) return null;
  if (NON_ANSWERS.includes(s.toLowerCase())) return null;
  // Over the limit means the model ignored the brief rather than that the line
  // needs cutting: truncating mid-word would show a fragment as though it were
  // the answer, so it is dropped and the company simply has no line.
  if (s.length > ONE_LINER_MAX) return null;
  return s;
}
