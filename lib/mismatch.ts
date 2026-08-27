/**
 * Adjudicating items the company-name filter dropped. Brief §7 stage 4.
 *
 * Stage 4 keeps an item only when the company's name appears in the headline or
 * snippet. That is the right default — a query for "Hadrian" returns Roman
 * archaeology, and one for "Field AI" returns agriculture — and a looser rule
 * would fill the digest with them.
 *
 * But it also drops the story where the headline names the place, the customer
 * or the founder instead:
 *
 *   Skydio     "California drone maker to spend billions as it expands manufacturing"
 *   Castelion  "Missile facility on track to open in Rio Rancho by the end of the year"
 *   Apex Space "New Satellite Tech Factory Shows Space Market Open to Startups"
 *
 * Every one is a siting decision, which is the single thing the expansion axis
 * exists to catch, and around 150 of them are dropped per run. There is nothing
 * more to match on: Google News RSS puts the headline in the snippet and appends
 * the source, so the text the filter already rejected is all the text there is.
 * Only reading it settles the question.
 *
 * So the model is asked, and only about the items worth the tokens: an item
 * whose headline carries expansion vocabulary, from a company-directed feed
 * where the association is already Google's. The rest stay dropped.
 *
 * The prompt is built to say no. Recovering a story that is really about a
 * competitor is worse than losing one of ours — it puts a claim about the wrong
 * company in front of an RD, and §15's rule is that a claim has to survive being
 * checked.
 */
import { callJson } from './llm';
import type { Budget } from './budget';

/**
 * Headlines worth paying to adjudicate: a siting, building or committing event.
 * Deliberately narrower than the scoring rubric — this decides what is worth
 * spending tokens on, not what is worth surfacing.
 */
export const EXPANSION_RE =
  /\b(facilit|factor(y|ies)|plant\b|fab\b|campus|headquarter|hq\b|open(s|ed|ing)?\b|expand|expansion|manufactur|production|build(s|ing)?\b|invest(s|ed|ment)?\b|site\b|siting|relocat|footprint|capacity|award(s|ed)?\b|contract|acquir|acquisition)\b/i;

export type MismatchCandidate = {
  itemId: number;
  companyId: number;
  companyName: string;
  title: string;
  source: string;
  /** What the company does, so the model can tell it from a same-named other. */
  description: string | null;
};

export type Verdict = {
  itemId: number;
  /** Is the story about this company. */
  about: boolean;
  /** Reason, one clause. Kept for the audit trail on a restored item. */
  why: string;
};

export const MISMATCH_VERSION = 'mismatch-v1';

export const MISMATCH_SYSTEM = `You decide whether a news headline is about a particular company.

The headline was returned by a news search for that company but does not name it. Sometimes that is because the headline names the city, the customer or the founder instead, and the story is genuinely about the company. Sometimes the search simply matched something else with a similar name — a Roman emperor, a common word, a different firm.

Answer no unless the headline gives you a positive reason to think it is the same company. A description that fits — the right industry, the right kind of event, a place the company is known to operate — is a reason. A headline that merely could be about them is not.

Getting this wrong in the direction of yes is worse than in the direction of no: a wrong yes puts a claim about the wrong company in front of someone who will repeat it.

Return JSON only: {"verdicts":[{"itemId":<number>,"about":<true|false>,"why":"<one clause, under twelve words>"}]}`;

export function buildMismatchPrompt(batch: MismatchCandidate[]): string {
  const lines = batch.map((c) => {
    const desc = c.description ? ` — ${c.description}` : '';
    return `itemId ${c.itemId}
  company: ${c.companyName}${desc}
  headline: ${c.title}
  outlet: ${c.source}`;
  });
  return `For each, is the headline about the named company?

${lines.join('\n\n')}

Return one verdict per itemId, ${batch.length} in total.`;
}

type Out = { verdicts?: Array<{ itemId?: number; about?: boolean; why?: string }> };

/**
 * Adjudicate one batch. A model failure returns no verdicts rather than
 * throwing: the items stay dropped, which is where they already were.
 */
export async function adjudicate(
  batch: MismatchCandidate[],
  budget?: Budget,
): Promise<{ verdicts: Verdict[]; tokensIn: number; tokensOut: number; error: string | null }> {
  const res = await callJson<Out>({
    system: MISMATCH_SYSTEM,
    user: buildMismatchPrompt(batch),
    budget,
  });
  if (!res.ok || !res.data?.verdicts) {
    return { verdicts: [], tokensIn: res.tokensIn, tokensOut: res.tokensOut, error: res.error ?? 'no verdicts' };
  }

  // Only ids that were actually asked about — a model that invents one would
  // otherwise restore an item nobody adjudicated.
  const asked = new Set(batch.map((b) => b.itemId));
  const verdicts: Verdict[] = [];
  for (const v of res.data.verdicts) {
    if (typeof v.itemId !== 'number' || !asked.has(v.itemId)) continue;
    verdicts.push({
      itemId: v.itemId,
      about: v.about === true,
      why: (v.why ?? '').trim().slice(0, 120),
    });
  }
  return { verdicts, tokensIn: res.tokensIn, tokensOut: res.tokensOut, error: null };
}
