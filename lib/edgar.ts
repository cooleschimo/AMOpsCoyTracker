/**
 * SEC EDGAR Form D client. Brief §5.1.
 *
 * VERIFIED 2026-08-21 against live endpoints:
 *  - daily-index: https://www.sec.gov/Archives/edgar/daily-index/{YYYY}/QTR{n}/form.{YYYYMMDD}.idx
 *  - primary_doc: https://www.sec.gov/Archives/edgar/data/{cik}/{accession_nodash}/primary_doc.xml
 *  - relatedPersonsList carries names + relationship (Executive Officer/Director/Promoter)
 *  - offeringSalesAmounts.totalAmountSold and typesOfSecuritiesOffered both present
 *
 * TWO HONESTY RULES (brief §5.1, DESIGN_RATIONALE §8) enforced by callers:
 *  1. A director's name does NOT establish which fund they represent. Write the
 *     role edge (person->company) from the filing; NEVER infer an affiliation
 *     (person->fund) from it. Until both edges exist from independent sources
 *     the connection is an ASSOCIATION, not a path.
 *  2. "Amount sold" is NOT cumulative venture funding. It can cover debt, pooled
 *     funds and multi-issuer structures. Stored with its security type; never
 *     displayed as "total raised".
 *
 * Absence of a Form D is NOT evidence of absence of a raise — issuers sometimes
 * fail to file, or file partially.
 *
 * Rate limit: SEC documents 10 req/s and blocks IPs that exceed it. We throttle
 * to 8/s deliberately.
 */
import { env } from './env';

const SEC_BASE = 'https://www.sec.gov';
const MIN_INTERVAL_MS = 125; // 8 req/s, under the documented 10/s ceiling
let lastFetch = 0;

async function secFetch(url: string, tries = 3): Promise<string> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastFetch);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetch = Date.now();

    const res = await fetch(url, {
      headers: {
        // SEC REQUIRES a descriptive UA of the form "Name email@domain".
        'User-Agent': env.secUserAgent(),
        'Accept-Encoding': 'gzip, deflate',
      },
    });
    if (res.status === 429 || res.status === 403) {
      const backoff = 2 ** attempt * 2000;
      console.warn(`[edgar] ${res.status} on ${url}; backing off ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    if (!res.ok) throw new Error(`SEC ${res.status} for ${url}`);
    return res.text();
  }
  throw new Error(`SEC rate-limited after ${tries} attempts: ${url}`);
}

export type FormDIndexEntry = {
  companyName: string;
  cik: string;
  formType: string;
  dateFiled: string;
  fileName: string;      // edgar/data/CIK/ACCESSION.txt
  accession: string;     // 0001234567-26-000001
};

/** Parse a daily form index. Fixed-width columns; the last field is the path. */
export function parseFormIdx(text: string): FormDIndexEntry[] {
  const out: FormDIndexEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('D ') && !line.startsWith('D/A ')) continue;
    // Fixed-width-ish: Form Type / Company Name / CIK / Date Filed / File Name.
    // VERIFIED against a live .idx: the date is YYYYMMDD with NO dashes.
    const m = line.match(/^(D|D\/A)\s+(.+?)\s+(\d+)\s+(\d{8})\s+(\S+)\s*$/);
    if (!m) continue;
    const [, formType, companyName, cik, rawDate, fileName] = m;
    const dateFiled = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    const acc = fileName.match(/(\d{10}-\d{2}-\d{6})/)?.[1] ?? '';
    out.push({ formType, companyName: companyName.trim(), cik, dateFiled, fileName, accession: acc });
  }
  return out;
}

export async function fetchDailyIndex(d: Date): Promise<FormDIndexEntry[]> {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  const stamp = `${y}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const url = `${SEC_BASE}/Archives/edgar/daily-index/${y}/QTR${q}/form.${stamp}.idx`;
  try {
    return parseFormIdx(await secFetch(url));
  } catch (e) {
    // Weekends and holidays have no index. Not an error worth halting a run for.
    console.warn(`[edgar] no index for ${stamp}: ${(e as Error).message}`);
    return [];
  }
}

/**
 * Entity-vs-human heuristic for related persons. Errs toward calling something
 * an entity: a missed human costs one graph edge, a fund LLC stored as a person
 * fabricates a warm path.
 */
export function looksLikeEntity(name: string): boolean {
  return /\b(LLC|L\.L\.C|LP|L\.P|LLP|INC|CORP|CORPORATION|COMPANY|CO|LTD|LIMITED|TRUST|PARTNERS|CAPITAL|VENTURES|HOLDINGS|MANAGEMENT|FUND|GROUP|ASSOCIATES|ADVISORS)\b\.?$/i.test(name.trim())
    || /\b(LLC|LP|LLP|INC|CORP|LTD)\b/i.test(name);
}

const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
};
const allBlocks = (xml: string, name: string): string[] => {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
};

export type RelatedPerson = {
  name: string;
  relationships: string[];   // Executive Officer | Director | Promoter
  clarification: string | null;
  city: string | null;
  stateOrCountry: string | null;
  /**
   * True when the "person" is really an entity (fund LLC, holding company).
   * Prefer FALSE SPLITS over FALSE MERGES (DESIGN_RATIONALE §8): an entity
   * wrongly stored as a person would generate warm paths that do not exist.
   */
  isLikelyEntity: boolean;
};

export type FormDFiling = {
  accession: string;
  cik: string;
  entityName: string;
  formType: string;
  filedAt: string;
  url: string;
  street1: string | null;
  city: string | null;
  stateOrCountry: string | null;
  jurisdiction: string | null;
  entityType: string | null;
  yearOfInc: string | null;
  industryGroup: string | null;
  /** As filed. NOT cumulative funding — see honesty rule 2. */
  totalOfferingAmount: number | null;
  totalAmountSold: number | null;
  /** equity | debt | pooled_fund | option_warrant_other | other */
  securityType: string;
  isAmendment: boolean;
  dateOfFirstSale: string | null;
  relatedPersons: RelatedPerson[];
};

/** Derive a security type from the typesOfSecuritiesOffered block. */
function deriveSecurityType(xml: string): string {
  const block = tag(xml, 'typesOfSecuritiesOffered') ?? '';
  const on = (n: string) => new RegExp(`<${n}>true</${n}>`).test(block);
  const types: string[] = [];
  if (on('isEquityType')) types.push('equity');
  if (on('isDebtType')) types.push('debt');
  if (on('isPooledInvestmentFundType')) types.push('pooled_fund');
  if (on('isOptionToAcquireType') || on('isSecurityToBeAcquiredType')) types.push('option_warrant_other');
  if (on('isMineralPropertyType')) types.push('mineral');
  if (on('isTenantInCommonType')) types.push('tenant_in_common');
  if (on('isOtherType')) types.push('other');
  return types.length ? types.join('+') : 'unspecified';
}

export async function fetchFiling(cik: string, accession: string): Promise<FormDFiling | null> {
  const nodash = accession.replace(/-/g, '');
  const cikTrim = String(Number(cik));
  const url = `${SEC_BASE}/Archives/edgar/data/${cikTrim}/${nodash}/primary_doc.xml`;
  let xml: string;
  try {
    xml = await secFetch(url);
  } catch (e) {
    console.warn(`[edgar] fetch failed ${accession}: ${(e as Error).message}`);
    return null;
  }

  const issuer = tag(xml, 'primaryIssuer') ?? '';
  const addr = tag(issuer, 'issuerAddress') ?? '';
  const offering = tag(xml, 'offeringData') ?? '';
  const sales = tag(offering, 'offeringSalesAmounts') ?? '';

  const persons: RelatedPerson[] = [];
  for (const b of allBlocks(tag(xml, 'relatedPersonsList') ?? '', 'relatedPersonInfo')) {
    const nameBlock = tag(b, 'relatedPersonName') ?? '';
    // EDGAR uses 'N/A' as a firstName placeholder when the related person is an
    // ENTITY (a fund LLC filing as promoter), not a human. Strip the placeholder
    // and flag the row so callers can avoid creating people rows for entities.
    const parts = [tag(nameBlock, 'firstName'), tag(nameBlock, 'middleName'), tag(nameBlock, 'lastName')]
      .filter((p): p is string => !!p && p.length > 0 && p.toUpperCase() !== 'N/A');
    const name = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const relBlock = tag(b, 'relatedPersonRelationshipList') ?? '';
    const relationships = [...relBlock.matchAll(/<relationship>([\s\S]*?)<\/relationship>/g)]
      .map((m) => m[1].trim()).filter(Boolean);
    const pAddr = tag(b, 'relatedPersonAddress') ?? '';
    persons.push({
      name, relationships,
      clarification: tag(b, 'relationshipClarification') || null,
      city: tag(pAddr, 'city'),
      stateOrCountry: tag(pAddr, 'stateOrCountry'),
      isLikelyEntity: looksLikeEntity(name),
    });
  }

  const num = (v: string | null) => {
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    accession,
    cik: cikTrim,
    entityName: tag(issuer, 'entityName') ?? '(unknown)',
    formType: tag(xml, 'submissionType') ?? 'D',
    filedAt: tag(tag(offering, 'signatureBlock') ?? '', 'signatureDate')
      ?? tag(tag(offering, 'dateOfFirstSale') ?? '', 'value') ?? '',
    url: `${SEC_BASE}/Archives/edgar/data/${cikTrim}/${nodash}/primary_doc.xml`,
    street1: tag(addr, 'street1'),
    city: tag(addr, 'city'),
    stateOrCountry: tag(addr, 'stateOrCountry'),
    jurisdiction: tag(issuer, 'jurisdictionOfInc'),
    entityType: tag(issuer, 'entityType'),
    yearOfInc: tag(tag(issuer, 'yearOfInc') ?? '', 'value'),
    industryGroup: tag(tag(offering, 'industryGroup') ?? '', 'industryGroupType'),
    totalOfferingAmount: num(tag(sales, 'totalOfferingAmount')),
    totalAmountSold: num(tag(sales, 'totalAmountSold')),
    securityType: deriveSecurityType(offering),
    isAmendment: /<isAmendment>true<\/isAmendment>/.test(offering),
    dateOfFirstSale: tag(tag(offering, 'dateOfFirstSale') ?? '', 'value'),
    relatedPersons: persons,
  };
}

/** Map a Form D relationship string to the roles.role enum. */
export function mapRole(relationship: string): string {
  const r = relationship.toLowerCase();
  if (r.includes('executive officer')) return 'officer';
  if (r.includes('director')) return 'director';
  if (r.includes('promoter')) return 'promoter';
  return 'officer';
}

/** West-coast + in-scope states. Brief §2 geography. */
export const TARGET_STATES = new Set(['CA', 'WA', 'OR', 'NV', 'AZ', 'CO', 'UT', 'ID', 'NM']);

export function regionForState(st: string | null): string | null {
  if (!st) return null;
  if (st === 'WA') return 'seattle';
  if (st === 'CA') return 'bay_area'; // refined by city below
  if (['OR', 'NV', 'AZ', 'UT', 'ID', 'NM', 'CO'].includes(st)) return 'other_west';
  return 'other_us';
}

const SOCAL = new Set(['los angeles', 'santa monica', 'pasadena', 'irvine', 'long beach', 'el segundo', 'burbank', 'culver city', 'torrance', 'anaheim', 'goleta', 'santa barbara']);
const SD = new Set(['san diego', 'la jolla', 'carlsbad']);

export function refineCaRegion(city: string | null): string {
  const c = (city ?? '').toLowerCase().trim();
  if (SD.has(c)) return 'san_diego';
  if (SOCAL.has(c)) return 'socal';
  return 'bay_area';
}
