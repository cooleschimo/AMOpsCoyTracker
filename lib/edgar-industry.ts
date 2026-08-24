/**
 * EDGAR Form D "Industry Group" (Item 4) -> our sector scope.
 *
 * The full enumeration is printed on the official Form D
 * (https://www.sec.gov/files/formd.pdf, Item 4). It is a fixed list from which
 * the filer selects one, so this is a lookup against a label the SEC already
 * applied rather than fuzzy classification.
 *
 * Three outcomes:
 *
 *  'organization'  The filer is a fund, so it belongs in `organizations` rather
 *                  than `companies` — a VC fund raising from its LPs is not a
 *                  company raising money. This is routing, not filtering.
 *
 *  'out_of_scope'  Confidently outside deeptech/biotech/defence_tech/ai. Hotels,
 *                  restaurants, retail, insurance. Persisted and labelled, since
 *                  DESIGN_RATIONALE §15.4 needs this set to answer "is the
 *                  filter wrong?" later.
 *
 *  'in_scope'      Either a direct sector match (Biotechnology is biotech) or a
 *                  generic technology bucket that needs assessment. `sectors`
 *                  carries the confident mapping; an empty array means the
 *                  company-level assessment (§7a) decides.
 *
 * The generic buckets are why an empty `sectors` matters. 'Other Technology' is
 * EDGAR's catch-all and holds both real targets (Standard Cognition — computer
 * vision) and non-targets (Bidbus — used-car auctions), so it resolves to
 * in_scope with no sectors and the assessment classifies it.
 */
import type { Sector } from './scope';

export type IndustryRouting = {
  disposition: 'organization' | 'out_of_scope' | 'in_scope';
  /** Confident sector mapping. Empty = needs the company-level assessment. */
  sectors: Sector[];
  /** Why, for the audit trail. */
  reason: string;
};

const M: Record<string, IndustryRouting> = {
  // ── Funds: route to organizations rather than companies ─────────────────
  'Pooled Investment Fund': { disposition: 'organization', sectors: [], reason: 'fund, not an operating company' },
  'Investing':              { disposition: 'organization', sectors: [], reason: 'investing entity' },
  'Investment Banking':     { disposition: 'organization', sectors: [], reason: 'investment bank' },

  // ── Direct sector matches: EDGAR's label is our sector ──────────────────
  'Biotechnology':  { disposition: 'in_scope', sectors: ['biotech'], reason: 'EDGAR Biotechnology = biotech' },
  'Pharmaceuticals':{ disposition: 'in_scope', sectors: ['biotech'], reason: 'EDGAR Pharmaceuticals = biotech' },
  'Computers':      { disposition: 'in_scope', sectors: ['deeptech'], reason: 'EDGAR Computers = deeptech; AI tag needs assessment' },
  'Telecommunications': { disposition: 'in_scope', sectors: ['deeptech'], reason: 'EDGAR Telecommunications = deeptech' },

  // ── In scope, but sector needs judgment ─────────────────────────────────
  // Manufacturing spans advanced manufacturing (in scope) and commodity
  // production (not). Assessment decides.
  'Manufacturing':      { disposition: 'in_scope', sectors: [], reason: 'may be advanced manufacturing; needs assessment' },
  'Other Technology':   { disposition: 'in_scope', sectors: [], reason: "EDGAR's tech catch-all; needs assessment" },
  'Other Health Care':  { disposition: 'in_scope', sectors: [], reason: 'may be biotech/medtech; needs assessment' },
  'Environmental Services': { disposition: 'in_scope', sectors: [], reason: 'may be climate deeptech; needs assessment' },
  'Energy Conservation':{ disposition: 'in_scope', sectors: [], reason: 'may be energy deeptech; needs assessment' },
  'Other Energy':       { disposition: 'in_scope', sectors: [], reason: 'may be energy deeptech; needs assessment' },
  'Business Services':  { disposition: 'in_scope', sectors: [], reason: 'may be AI/software; needs assessment' },
  'Other':              { disposition: 'in_scope', sectors: [], reason: 'unlabelled; needs assessment' },

  // ── Confidently out of scope ────────────────────────────────────────────
  'Agriculture':            { disposition: 'out_of_scope', sectors: [], reason: 'agriculture' },
  'Commercial Banking':     { disposition: 'out_of_scope', sectors: [], reason: 'banking' },
  'Insurance':              { disposition: 'out_of_scope', sectors: [], reason: 'insurance' },
  'Other Banking & Financial Services': { disposition: 'out_of_scope', sectors: [], reason: 'financial services' },
  'Other Banking and Financial Services': { disposition: 'out_of_scope', sectors: [], reason: 'financial services' },
  'Electric Utilities':     { disposition: 'out_of_scope', sectors: [], reason: 'utilities' },
  'Coal Mining':            { disposition: 'out_of_scope', sectors: [], reason: 'extractive' },
  'Oil & Gas':              { disposition: 'out_of_scope', sectors: [], reason: 'extractive' },
  'Health Insurance':       { disposition: 'out_of_scope', sectors: [], reason: 'insurance' },
  'Hospitals & Physicians': { disposition: 'out_of_scope', sectors: [], reason: 'care delivery, not biotech' },
  'Commercial':             { disposition: 'out_of_scope', sectors: [], reason: 'commercial real estate' },
  'Construction':           { disposition: 'out_of_scope', sectors: [], reason: 'construction' },
  'REITS & Finance':        { disposition: 'out_of_scope', sectors: [], reason: 'real estate finance' },
  'REITS and Finance':      { disposition: 'out_of_scope', sectors: [], reason: 'real estate finance' },
  'Residential':            { disposition: 'out_of_scope', sectors: [], reason: 'residential real estate' },
  'Other Real Estate':      { disposition: 'out_of_scope', sectors: [], reason: 'real estate' },
  'Retailing':              { disposition: 'out_of_scope', sectors: [], reason: 'retail' },
  'Restaurants':            { disposition: 'out_of_scope', sectors: [], reason: 'restaurants' },
  'Airlines & Airports':    { disposition: 'out_of_scope', sectors: [], reason: 'travel' },
  'Lodging & Conventions':  { disposition: 'out_of_scope', sectors: [], reason: 'travel' },
  'Lodging and Conventions':{ disposition: 'out_of_scope', sectors: [], reason: 'travel' },
  'Tourism & Travel Services': { disposition: 'out_of_scope', sectors: [], reason: 'travel' },
  'Other Travel':           { disposition: 'out_of_scope', sectors: [], reason: 'travel' },
};

/**
 * Unknown values default to in_scope-pending-assessment. Erring toward keeping
 * is the cheaper mistake: a wrongly kept company costs one assessment call, and
 * a wrongly dropped one is invisible forever.
 */
export function routeIndustry(industryGroup: string | null | undefined): IndustryRouting {
  if (!industryGroup) {
    return { disposition: 'in_scope', sectors: [], reason: 'no industry group stated; needs assessment' };
  }
  const hit = M[industryGroup.trim()];
  if (hit) return hit;
  const loose = M[industryGroup.trim().replace(/&/g, 'and')] ?? M[industryGroup.trim().replace(/\band\b/g, '&')];
  if (loose) return loose;
  return { disposition: 'in_scope', sectors: [], reason: `unrecognised industry '${industryGroup}'; needs assessment` };
}

export const KNOWN_INDUSTRIES = Object.keys(M);
