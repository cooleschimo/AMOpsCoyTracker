/** Does the rubric work when the model DOES know the company? Seeded co's as control. */
import '../../lib/loadenv';
import { callJson } from '../../lib/llm';
import { COMPANY_ASSESSMENT_SYSTEM, buildAssessmentPrompt } from '../../lib/company-rubric';
import { env } from '../../lib/env';

(async () => {
  const res = await callJson<{ assessments: any[] }>({
    system: COMPANY_ASSESSMENT_SYSTEM,
    user: buildAssessmentPrompt([
      { name: 'Anthropic', industry: null, state: 'CA', website: 'anthropic.com' },
      { name: 'Standard Cognition, Corp.', industry: 'Other Technology', state: 'CA', website: null },
      { name: 'Bidbus, Inc.', industry: 'Other Technology', state: 'CA', website: null },
      { name: 'Universal Graphene Products, Inc.', industry: 'Other Technology', state: 'OR', website: null },
      { name: 'Ensysce Biosciences, Inc.', industry: 'Other Health Care', state: 'CA', website: null },
    ]),
    model: env.groqModelScoring(), temperature: 0.1,
  });
  if (!res.ok) { console.error('FAILED:', res.error); return; }
  for (const a of res.data!.assessments) {
    console.log(`\n  ${a.name}`);
    console.log(`    sectors: ${(a.sectors ?? []).join(', ') || '(none)'}`);
    console.log(`    priority: ${a.target_priority}  fit: ${a.singapore_fit}  contrib: ${a.potential_contribution}  conf: ${a.confidence}`);
    console.log(`    ${a.rationale}`);
  }
})();
