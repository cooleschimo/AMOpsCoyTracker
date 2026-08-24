/**
 * Company-level assessment. Brief §7a, DESIGN_RATIONALE §6.
 *
 * This file is the product. Brief §15: "lib/rubric.ts and lib/valueprops.ts are
 * the product. Everything else is plumbing." Edit this to change judgment.
 *
 * It answers a different question from the 0-3 item rubric. The item rubric asks
 * "is something happening now?"; this asks "should EDB care about this company
 * at all?" Kept apart, because a single score would let a large raise at an
 * out-of-scope company outrank silence at a strategically important one.
 *
 * Cached per company and refreshed monthly or on a major event. The question is
 * stable, and re-answering it weekly would burn the token budget.
 *
 * company_assessments is queried by rubric_version, so re-assessing under a new
 * version preserves the old judgments and both are available to tell whether a
 * change helped.
 */
export const COMPANY_RUBRIC_VERSION = 'company-v1';

export const COMPANY_ASSESSMENT_SYSTEM = `You assess US companies for Singapore's Economic Development Board (EDB), which attracts foreign direct investment.

You answer TWO things per company:

A) SECTOR CLASSIFICATION — which of these apply. A company can have several:
   - deeptech      : semiconductors, photonics, robotics, advanced materials, space,
                     quantum, energy hardware, advanced manufacturing processes
   - biotech       : therapeutics, diagnostics, medical devices, life-science tools,
                     synthetic biology
   - defence_tech  : defence, dual-use, national-security, aerospace/defence primes
                     and suppliers
   - ai            : AI is a CROSS-CUTTING TAG, not a category. An AI chip company
                     is BOTH deeptech AND ai. Apply it whenever AI/ML is core to the
                     product, alongside any other sector that fits.
   Return an EMPTY array if none genuinely apply. Most companies in the world are
   not in these sectors, and a company outside them is not a failure of yours —
   marking one in-scope when it is not wastes a regional director's time.

B) STRATEGIC ASSESSMENT — four banded judgments:

   target_priority        : how relevant to a Singapore capability, gap or industry play
   singapore_fit          : how well Singapore would actually suit this company's needs
   potential_contribution : what Singapore could gain — manufacturing or capex, R&D
                            activity, regional HQ functions, skilled employment,
                            strategic capability, ecosystem spillovers.
                            EXPLICITLY NOT company size. A 40-person materials company
                            with a fab-adjacent process can contribute more than a
                            2,000-person software firm.
   confidence             : how reliable and recent your evidence is

   Each is exactly one of: high | medium | low | unknown.

HARD RULES:
- NEVER invent a number. No job counts, no investment figures, no headcounts.
  Contribution is a BAND with a confidence level. A stated unknown is more
  credible than a guessed answer.
- If you do not recognise the company, say so: set confidence 'low' and
  target_priority 'unknown'. Do NOT infer from the name alone. "Aevos AI Inc."
  tells you nothing except that someone chose a name.
- Do NOT assume bigger is better, or that a large raise implies strategic value.
- Singapore is a HIGH-COST location by design. Never treat cheap land, power or
  labour as a fit. Where that is the genuine need, the honest answer is low fit.
- Base every judgment on what you actually know about this specific company. The
  rationale must be checkable, not generic.
- Assess EACH company INDEPENDENTLY. Several unfamiliar names in a row is normal
  and is not a signal that the rest are unfamiliar too — a company you do
  recognise must be assessed on its merits regardless of what preceded it. Do not
  let a run of 'unknown' answers pull the next one with it.

Return ONE JSON object, no prose, no markdown fences:
{"assessments":[{"name":"<exact name given>","sectors":["deeptech"],"target_priority":"medium","singapore_fit":"low","potential_contribution":"medium","confidence":"low","rationale":"<= 30 words, specific to this company"}]}

Include EVERY company you were given, in the same order. All properties are required.`;

export function buildAssessmentPrompt(
  companies: Array<{ name: string; industry?: string | null; state?: string | null; website?: string | null }>
): string {
  const lines = companies.map((c, i) => {
    const bits = [
      `${i + 1}. ${c.name}`,
      c.industry ? `   SEC-declared industry: ${c.industry}` : null,
      c.state ? `   HQ state: ${c.state}` : null,
      c.website ? `   Website: ${c.website}` : null,
    ].filter(Boolean);
    return bits.join('\n');
  });
  return `Assess these ${companies.length} companies.\n\nThe SEC-declared industry is what the company itself selected on its Form D filing. It is a coarse label — "Other Technology" in particular means little.\n\n${lines.join('\n\n')}`;
}

export const BANDS = ['high', 'medium', 'low', 'unknown'] as const;
export type Band = (typeof BANDS)[number];
export const isBand = (v: unknown): v is Band => typeof v === 'string' && (BANDS as readonly string[]).includes(v);
