/**
 * Ground-truth cases for ACRA name matching, all verified by hand against
 * data.gov.sg on 2026-08-24.
 *
 * This exists because the matcher was tuned four times by eye and each fix
 * broke a previously-working case. Run: npx tsx tests/acra-match.test.ts
 */
import { matchStrength } from '../lib/acra';

type Case = { company: string; acra: string; expect: 'confirmed' | 'probable' | null; why: string; collisions?: number };

const CASES: Case[] = [
  // TRUE matches — the ACRA entity really is this company's Singapore arm.
  { collisions: 1, company: 'Anthropic', acra: 'ANTHROPIC SINGAPORE PTE. LTD.', expect: 'confirmed', why: 'exact core + geo suffix' },
  { collisions: 1, company: 'Anthropic', acra: 'ANTHROPIC PBC ASIA PACIFIC PTE. LTD.', expect: 'confirmed', why: 'core + legal form PBC' },
  { collisions: 1, company: 'Databricks', acra: 'DATABRICKS PTE. LTD.', expect: 'confirmed', why: 'exact core' },
  { collisions: 1, company: 'Anysphere', acra: 'ANYSPHERE SINGAPORE PTE. LTD.', expect: 'confirmed', why: 'exact core + geo' },
  { collisions: 1, company: 'SambaNova Systems', acra: 'SAMBANOVA SYSTEMS SINGAPORE PTE. LTD.', expect: 'confirmed', why: 'full name contiguous' },
  { collisions: 1, company: 'Anduril Industries', acra: 'ANDURIL PTE. LTD.', expect: 'confirmed', why: 'distinctive identity token, descriptive word dropped by the company' },
  { collisions: 1, company: 'Anduril Industries', acra: 'ANDURIL SYSTEMS PTE. LTD.', expect: 'confirmed', why: 'distinctive identity + different descriptive word' },
  { collisions: 1, company: 'Perplexity', acra: 'PERPLEXITY PTE. LTD.', expect: 'confirmed', why: 'exact core' },
  { collisions: 1, company: 'Luma AI', acra: 'LUMA AI (SG) PTE. LTD.', expect: 'confirmed', why: 'full name + geo marker' },
  { collisions: 1, company: 'Cognition AI', acra: 'COGNITION AI PTE. LTD.', expect: 'confirmed', why: 'exact core' },
  { collisions: 1, company: 'Figma', acra: 'FIGMA SINGAPORE PTE. LIMITED', expect: 'confirmed', why: 'exact core + geo' },

  // FALSE matches — a different company that shares a word.
  { collisions: 12, company: 'Twelve Labs', acra: 'TWELVE DEGREES PTE. LTD.', expect: null, why: 'shares only the generic word "twelve"' },
  { collisions: 12, company: 'Twelve Labs', acra: 'TWELVE DATA PTE. LTD.', expect: null, why: 'different company' },
  { collisions: 12, company: 'Twelve Labs', acra: 'TWELVE STABLES PTE. LTD.', expect: null, why: 'different company' },
  { collisions: 3, company: 'Decagon', acra: 'DECAGON CONSULTING PTE. LTD.', expect: null, why: 'single-word identity + unrelated descriptive word' },
  { collisions: 3, company: 'Decagon', acra: 'DECAGON PROJECTS PTE. LTD.', expect: null, why: 'different company' },
  { collisions: 18, company: 'Harvey', acra: 'HARVEY NORMAN SINGAPORE PTE LTD', expect: null, why: 'Australian retailer, not the AI company' },
  { collisions: 18, company: 'Harvey', acra: 'HARVEY CONSTRUCTION PTE. LTD.', expect: null, why: 'different company' },
  { collisions: 39, company: 'Parallel', acra: 'PARALLEL MINDS PTE. LTD.', expect: null, why: 'common word' },

  // Exact single-word matches ARE legitimate.
  // Corrected 2026-08-24: 'Decagon' collides with 3 registry entities, so even
  // an exact match is 'probable' pending human review. That is the tri-state
  // working as §5.3 intends, not a matcher failure.
  { collisions: 3, company: 'Decagon', acra: 'DECAGON PTE. LTD.', expect: 'probable', why: 'exact but collides with namesakes' },
  { collisions: 18, company: 'Harvey', acra: 'HARVEY PTE LTD', expect: 'probable', why: 'exact but short; flag for review' },
];

let pass = 0, fail = 0;
for (const c of CASES) {
  const got = matchStrength(c.company, c.acra, c.collisions);
  const ok = got === c.expect;
  if (ok) pass++; else fail++;
  if (!ok) {
    console.log(`FAIL  "${c.company}" vs "${c.acra}"`);
    console.log(`      expected ${c.expect}, got ${got}  (${c.why})`);
  }
}
console.log(`\n${pass}/${CASES.length} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
