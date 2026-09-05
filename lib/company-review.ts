/**
 * The last check before a company reaches a reader. Brief §7b.
 *
 * Every earlier stage judges a company in isolation, and the failures that
 * actually reach the dashboard are the ones only visible from the finished set:
 *
 *   - Lambda arrived three times — as itself, as "Nvidia-backed Lambda", and as
 *     "Neocloud Lambda". Each row was individually fine. `normalized_name` did
 *     not catch it because the descriptive prefix survives normalisation.
 *   - "Defense startup" collected 88 stories about a dozen different companies
 *     and read, on its own, as a company with strong momentum.
 *   - "As AI security concerns rise" is a sentence fragment the extractor took
 *     for a name.
 *
 * None of these are scoring mistakes. They are the set being wrong about what
 * counts as one company, which is a question you can only ask once you have the
 * set.
 *
 * The review is deliberately conservative. A company reaching this point has
 * already cleared discovery, scoring, assessment and placement, so the prior is
 * that it belongs; the reviewer is looking for the specific defects above, not
 * re-litigating whether the company is interesting. 'ok' is the common answer.
 */

export const COMPANY_REVIEW_VERSION = 'review-v1';

export const REVIEW_VERDICTS = [
  'ok', 'malformed_name', 'duplicate', 'weak_evidence', 'not_a_company',
] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const isReviewVerdict = (v: string): v is ReviewVerdict =>
  (REVIEW_VERDICTS as readonly string[]).includes(v);

/**
 * Which verdicts hold a company back from the dashboard.
 *
 * A duplicate is NOT among them: the merge target may be wrong, and hiding a
 * real company on a guess is worse than showing it twice for a week. It is
 * raised for a person instead. The two that hide are the ones where there is no
 * company to show — a headline fragment and a bucket of unrelated stories.
 */
export const HIDING_VERDICTS: readonly ReviewVerdict[] = ['malformed_name', 'not_a_company'];

export const COMPANY_REVIEW_SYSTEM = `You are checking a finished list of companies before it is shown to an investment promotion officer. Each entry has already passed several filters, so assume it belongs unless you find one of the specific defects below. "ok" is the expected answer for most entries.

You are looking for four things, and nothing else. Do not comment on whether a company is interesting, well-scored, or a good fit — that has been decided.

1. malformed_name — the name is not a company name. It is a headline fragment ("As AI security concerns rise"), a category ("Defense startup", "SG travel startup"), or a description the outlet wrote rather than the company's own name ("Netherlands-based AI startup Wonderful", where the real name is Wonderful). When the real name is recoverable from the evidence, give it as suggested_name.

2. duplicate — two entries in THIS list are the same company. Descriptive prefixes are the usual cause: "Nvidia-backed Lambda" and "Lambda" are one company. So are "Neocloud Lambda" and "Lambda". Give duplicate_of as the id of the entry that carries the cleaner name — usually the shorter, unprefixed one. Only call this when you are confident they are the same company, not merely similar: "Anyon Systems" and "Blue Canyon Technologies" are different companies, and so are "HyImpulse" and "Impulse".

3. not_a_company — the entry collects stories about several different companies rather than one. The tell is evidence naming other companies: an entry called "Defense startup" whose evidence mentions Aitan, Ursa Major and Quantum Systems is a bucket, not a company.

4. weak_evidence — the why-now says something the evidence does not support, is empty or placeholder text, or describes a different company than the one named. This is about the evidence contradicting itself, not about the news being unexciting.

A real company with an unusual name is fine. "AI Fiesta" is an Indian consumer AI app and "AI Score" is a UK governance startup — both are real companies whose names happen to start with AI. Judge by whether the evidence describes ONE identifiable company doing something, not by whether the name looks odd.

Return JSON only:
{"reviews":[{"id":<number>,"verdict":"ok|malformed_name|duplicate|weak_evidence|not_a_company","duplicate_of":<number or null>,"suggested_name":"<string or null>","reason":"<one sentence, only when the verdict is not ok>"}]}

Every id you were given must appear exactly once.`;

export type ReviewInput = {
  id: number;
  name: string;
  sectors: string[];
  hq: string | null;
  description: string | null;
  why: string | null;
  headline: string | null;
  itemCount: number;
};

/**
 * The whole set in one prompt, because duplicates are only visible when the
 * candidates sit beside each other. Splitting into batches would put Lambda and
 * "Nvidia-backed Lambda" in different calls and lose the very thing the pass
 * exists to catch.
 */
export function buildReviewPrompt(companies: ReviewInput[]): string {
  const lines = companies.map((c) => {
    const parts = [
      `id ${c.id}: ${c.name}`,
      c.hq ? `  location: ${c.hq}` : null,
      c.sectors.length ? `  sectors: ${c.sectors.join(', ')}` : null,
      c.description ? `  description: ${c.description.slice(0, 200)}` : null,
      c.headline ? `  leads with: ${c.headline.slice(0, 160)}` : null,
      c.why ? `  why now: ${c.why.slice(0, 400)}` : null,
      `  items in window: ${c.itemCount}`,
    ];
    return parts.filter(Boolean).join('\n');
  });
  return `Review these ${companies.length} companies.\n\n${lines.join('\n\n')}`;
}
