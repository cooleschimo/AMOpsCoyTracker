/**
 * Market-entry signals from authoritative registries.
 *
 * These establish what a company has legally done, which news cannot. A
 * Singapore subsidiary named in an SEC filing or a trial site registered on
 * ClinicalTrials.gov is planning already executed — visible before any
 * announcement, and checkable against a primary source.
 *
 * All endpoints are documented public APIs. SEC requires a descriptive
 * User-Agent and holds a 10 requests/second ceiling.
 */

const SEC_UA = () => process.env.SEC_USER_AGENT ?? 'AMOpsCoyTracker research';

/* ------------------------------------------------------------------ */
/* EDGAR full-text search                                              */
/* ------------------------------------------------------------------ */

/**
 * Searches the TEXT of every filing since 2001, where the daily index carries
 * only metadata. A company describing an Asian subsidiary or a new facility
 * does so in prose inside an 8-K or S-1, and this is the only free way to find
 * it.
 */
export type FilingHit = {
  companyName: string;
  cik: string | null;
  formType: string | null;
  filedAt: string | null;
  url: string | null;
  /** The phrase that matched, for the digest line. */
  phrase: string;
};

/** Phrases that indicate Asian market entry in filing prose. */
export const ENTRY_PHRASES = [
  '"Singapore subsidiary"',
  '"subsidiary in Singapore"',
  '"our Singapore operations"',
  '"Singapore Pte"',
  '"APAC headquarters"',
  '"Asia-Pacific headquarters"',
  '"regional headquarters in Singapore"',
];

export async function searchFilings(
  phrase: string,
  opts: { forms?: string; startDate?: string; endDate?: string } = {},
): Promise<FilingHit[]> {
  const params = new URLSearchParams({ q: phrase });
  if (opts.forms) params.set('forms', opts.forms);
  if (opts.startDate && opts.endDate) {
    params.set('dateRange', 'custom');
    params.set('startdt', opts.startDate);
    params.set('enddt', opts.endDate);
  }

  try {
    const res = await fetch(`https://efts.sec.gov/LATEST/search-index?${params}`, {
      headers: { 'User-Agent': SEC_UA(), Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    return (json?.hits?.hits ?? []).map((h: any) => {
      const display: string = h?._source?.display_names?.[0] ?? '';
      // "Company Name  (TICK)  (CIK 0001234567)" — the CIK is the reliable key.
      const cik = display.match(/CIK\s*(\d{7,10})/)?.[1] ?? null;
      const companyName = display.replace(/\s*\([^)]*\)\s*/g, '').trim();
      const id: string = h?._id ?? '';
      // _id is "accession:filename"; both halves are needed for the URL.
      const [accession, filename] = id.split(':');
      const url = cik && accession
        ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${filename ?? ''}`
        : null;
      return {
        companyName,
        cik,
        formType: h?._source?.file_type ?? null,
        filedAt: h?._source?.file_date ?? null,
        url,
        phrase,
      };
    });
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* ClinicalTrials.gov                                                  */
/* ------------------------------------------------------------------ */

/**
 * A US sponsor registering a Singapore trial site is a market-entry signal well
 * ahead of any announcement, and the brief names it the primary discovery route
 * for biotech. A first Asian site in particular scores as a decision window.
 */
export type TrialSite = {
  nctId: string;
  title: string;
  sponsor: string;
  /** Countries the trial runs in, so a FIRST Asian site is distinguishable. */
  countries: string[];
  phase: string | null;
  status: string | null;
  url: string;
};

export async function findSingaporeTrials(pageSize = 50): Promise<TrialSite[]> {
  const params = new URLSearchParams({
    'query.locn': 'Singapore',
    pageSize: String(pageSize),
    'filter.overallStatus': 'RECRUITING|NOT_YET_RECRUITING',
  });
  try {
    const res = await fetch(`https://clinicaltrials.gov/api/v2/studies?${params}`, {
      headers: { 'User-Agent': SEC_UA(), Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    return (json?.studies ?? []).map((s: any) => {
      const p = s?.protocolSection ?? {};
      const countries: string[] = [
        ...new Set<string>((p?.contactsLocationsModule?.locations ?? [])
          .map((l: any) => l?.country).filter(Boolean)),
      ];
      const nctId = p?.identificationModule?.nctId ?? '';
      return {
        nctId,
        title: p?.identificationModule?.briefTitle ?? '',
        sponsor: p?.sponsorCollaboratorsModule?.leadSponsor?.name ?? '',
        countries,
        phase: (p?.designModule?.phases ?? [])[0] ?? null,
        status: p?.statusModule?.overallStatus ?? null,
        url: nctId ? `https://clinicaltrials.gov/study/${nctId}` : '',
      };
    }).filter((t: TrialSite) => t.nctId && t.sponsor);
  } catch {
    return [];
  }
}

/**
 * Sponsors that are Singapore institutions themselves. A local hospital running
 * a local trial is domestic research, not foreign market entry, and these
 * dominate any location-based search of the registry.
 */
const LOCAL_SPONSOR = /\b(singapore|nanyang|ntu|nus\b|duke-nus|a\*star|astar|sengkang|tan tock seng|changi general|khoo teck puat|kk women|national (heart|university|cancer|dental|skin|neuroscience)|singhealth|nhg\b|synapxe)\b/i;

export function isLocalSponsor(sponsor: string): boolean {
  return LOCAL_SPONSOR.test(sponsor ?? '');
}

/**
 * A foreign sponsor whose only Asian site is Singapore is entering the region
 * here, which is a stronger signal than one adding Singapore to an existing
 * Asian footprint.
 */
const ASIAN = new Set(['Singapore', 'Japan', 'Korea, Republic of', 'China', 'Taiwan',
  'Hong Kong', 'India', 'Malaysia', 'Thailand', 'Indonesia', 'Viet Nam', 'Philippines']);

export function isFirstAsianSite(t: TrialSite): boolean {
  if (isLocalSponsor(t.sponsor)) return false;
  const asian = t.countries.filter((c) => ASIAN.has(c));
  return asian.length === 1 && asian[0] === 'Singapore';
}
