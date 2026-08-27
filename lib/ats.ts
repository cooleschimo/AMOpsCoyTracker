/**
 * ATS job boards — Greenhouse, Lever, Ashby. Brief §5.5, RATIONALE §4.
 *
 * A first-class source (RATIONALE §4): the only signal in the design that is
 * free, unrestricted, absent from the existing manual digest and invisible to
 * news feeds. A Bay Area company posting a Singapore role is about as direct an
 * expansion-intent signal as public data contains, and it normally precedes any
 * announcement.
 *
 * All three serve JSON without a key:
 *   Greenhouse  boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 *   Lever       api.lever.co/v0/postings/{slug}?mode=json
 *   Ashby       api.ashbyhq.com/posting-api/job-board/{slug}
 *
 * A Lever 404 means the company does not use Lever rather than that the API is
 * broken. Slug probing therefore fails most of the time by design, and a 404 is
 * recorded as 'not this ATS' rather than as a source-health failure.
 *
 * Guessing the slug from the company name fails whenever the board is filed
 * under something else — Hadrian posts as `hadrian-automation`, Apex Space as
 * `apex-technology-inc`, Amp Robotics as `ampsortation`. No amount of guessing
 * reaches those, so when probing comes up empty the company's own careers page
 * is read and the board link taken from it. That recovered 11 of 45 boards
 * probing had missed.
 */

export type AtsType = 'greenhouse' | 'lever' | 'ashby' | 'rippling';
export const ATS_TYPES: AtsType[] = ['greenhouse', 'lever', 'ashby', 'rippling'];

export type AtsJob = {
  externalId: string;
  title: string;
  location: string | null;
  url: string;
  postedAt: Date | null;
  /** Board's own department label. More reliable than a title regex when present. */
  department: string | null;
  /** Raw posting body. Carries salary bands and, occasionally, a PTE. LTD. entity name. */
  content: string | null;
};

export type AtsResult =
  | { ok: true; jobs: AtsJob[] }
  | { ok: false; reason: 'not_found' | 'error'; detail: string };

const UA = 'Mozilla/5.0 (compatible; AMOpsCoyTracker/1.0; +research)';

async function getJson(url: string): Promise<{ ok: true; json: unknown } | { ok: false; status: number; detail: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, status: res.status, detail: `HTTP ${res.status}` };
    return { ok: true, json: await res.json() };
  } catch (e) {
    return { ok: false, status: 0, detail: (e as Error).message };
  }
}

const asDate = (v: unknown): Date | null => {
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

export async function fetchGreenhouse(slug: string): Promise<AtsResult> {
  const r = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`);
  if (!r.ok) return { ok: false, reason: r.status === 404 ? 'not_found' : 'error', detail: r.detail };
  const jobs = (r.json as { jobs?: unknown[] })?.jobs ?? [];
  if (!Array.isArray(jobs)) return { ok: false, reason: 'error', detail: 'unexpected shape' };
  return {
    ok: true,
    jobs: jobs.map((j) => {
      const job = j as Record<string, unknown>;
      return {
        externalId: String(job.id ?? ''),
        title: String(job.title ?? '').trim(),
        location: (job.location as { name?: string } | undefined)?.name?.trim() ?? null,
        url: String(job.absolute_url ?? ''),
        postedAt: asDate(job.updated_at ?? job.first_published),
        department: (job.departments as Array<{ name?: string }> | undefined)?.[0]?.name ?? null,
        content: typeof job.content === 'string' ? job.content : null,
      };
    }).filter((j) => j.title && j.url),
  };
}

export async function fetchLever(slug: string): Promise<AtsResult> {
  const r = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
  if (!r.ok) return { ok: false, reason: r.status === 404 ? 'not_found' : 'error', detail: r.detail };
  const jobs = r.json;
  if (!Array.isArray(jobs)) return { ok: false, reason: 'error', detail: 'unexpected shape' };
  return {
    ok: true,
    jobs: jobs.map((j) => {
      const job = j as Record<string, unknown>;
      const cat = job.categories as Record<string, unknown> | undefined;
      return {
        externalId: String(job.id ?? ''),
        title: String(job.text ?? '').trim(),
        location: (cat?.location as string | undefined)?.trim() ?? null,
        url: String(job.hostedUrl ?? job.applyUrl ?? ''),
        postedAt: asDate(job.createdAt),
        department: (cat?.team as string | undefined) ?? (cat?.department as string | undefined) ?? null,
        content: [job.descriptionPlain, job.additionalPlain].filter((x) => typeof x === 'string').join(' ') || null,
      };
    }).filter((j) => j.title && j.url),
  };
}

export async function fetchAshby(slug: string): Promise<AtsResult> {
  const r = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`);
  if (!r.ok) return { ok: false, reason: r.status === 404 ? 'not_found' : 'error', detail: r.detail };
  const jobs = (r.json as { jobs?: unknown[] })?.jobs ?? [];
  if (!Array.isArray(jobs)) return { ok: false, reason: 'error', detail: 'unexpected shape' };
  return {
    ok: true,
    jobs: jobs.map((j) => {
      const job = j as Record<string, unknown>;
      return {
        externalId: String(job.id ?? ''),
        title: String(job.title ?? '').trim(),
        location: (job.location as string | undefined)?.trim() ?? null,
        url: String(job.jobUrl ?? job.applyUrl ?? ''),
        postedAt: asDate(job.publishedAt),
        department: (job.department as string | undefined) ?? (job.team as string | undefined) ?? null,
        content: typeof job.descriptionPlain === 'string' ? job.descriptionPlain
               : typeof job.descriptionHtml === 'string' ? job.descriptionHtml : null,
      };
    }).filter((j) => j.title && j.url),
  };
}

export function fetchAts(type: AtsType, slug: string): Promise<AtsResult> {
  if (type === 'greenhouse') return fetchGreenhouse(slug);
  if (type === 'lever') return fetchLever(slug);
  if (type === 'rippling') return fetchRippling(slug);
  return fetchAshby(slug);
}

/**
 * Candidate ATS slugs for a company name. Boards are usually the company name
 * lowercased with punctuation removed; some use the domain's second-level label.
 */
/**
 * Rippling's board API. Used by several defence and hardware companies that
 * probing never reaches, because the slug rarely resembles the company name.
 *
 * A job open in several places is returned once per location, all sharing one
 * uuid. Since a posting is keyed on that uuid, the locations are joined onto a
 * single posting — one role in three cities is one role, and leaving the
 * duplicates in both triples the job count and makes the upsert touch the same
 * row twice in a batch, which Postgres rejects outright.
 */
async function fetchRippling(slug: string): Promise<AtsResult> {
  const r = await getJson(`https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(slug)}/jobs`);
  if (!r.ok) return { ok: false, reason: r.status === 404 ? 'not_found' : 'error', detail: r.detail };
  const raw = Array.isArray(r.json) ? r.json : (r.json as any)?.items;
  if (!Array.isArray(raw)) return { ok: false, reason: 'not_found', detail: 'unexpected shape' };

  const byId = new Map<string, AtsJob>();
  const seenLocation = new Map<string, Set<string>>();
  for (const j of raw as any[]) {
    const externalId = String(j.uuid ?? j.id ?? '');
    const title = String(j.name ?? j.title ?? '');
    if (!externalId || !title) continue;
    const loc = j.workLocation?.label ?? j.location ?? null;

    const existing = byId.get(externalId);
    if (existing) {
      const seen = seenLocation.get(externalId)!;
      if (loc && !seen.has(loc)) {
        seen.add(loc);
        existing.location = existing.location ? `${existing.location}; ${loc}` : loc;
      }
      continue;
    }
    byId.set(externalId, {
      externalId, title, location: loc,
      url: j.url ?? `https://ats.rippling.com/${slug}/jobs/${externalId}`,
      postedAt: asDate(j.createdAt ?? j.publishedAt),
      department: j.department?.label ?? j.department ?? null,
      content: j.jobDescription ?? j.description ?? null,
    });
    seenLocation.set(externalId, new Set(loc ? [loc] : []));
  }
  return { ok: true, jobs: [...byId.values()] };
}

/**
 * Read the company's own careers page and take the board link it points at.
 * The fallback when slug probing fails: a link on the company's site is the
 * company's own statement of where it posts, which no guess can beat.
 */
export async function discoverFromCareersPage(
  website: string,
): Promise<{ type: AtsType; slug: string } | null> {
  const host = website.replace(/^https?:\/\//, '').replace(/\/+$/, '').split('/')[0];
  const patterns: Array<[RegExp, AtsType]> = [
    [/(?:job-boards|boards)\.greenhouse\.io\/(?!embed)([a-z0-9_-]+)/i, 'greenhouse'],
    [/boards\.greenhouse\.io\/embed\/job_board\?for=([a-z0-9_-]+)/i, 'greenhouse'],
    [/jobs\.lever\.co\/([a-z0-9_-]+)/i, 'lever'],
    [/jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i, 'ashby'],
    [/ats\.rippling\.com\/([a-z0-9_-]+)/i, 'rippling'],
  ];
  for (const path of ['careers', 'jobs', 'company/careers', 'about/careers', '']) {
    try {
      const res = await fetch(`https://${host}/${path}`, {
        headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      for (const [re, type] of patterns) {
        const m = html.match(re);
        // A board link can point at a careers-page host rather than a real
        // slug, so the candidate is confirmed against the API before it counts.
        if (m?.[1] && (await fetchAts(type, m[1])).ok) return { type, slug: m[1] };
      }
    } catch { /* try the next path */ }
  }
  return null;
}

export function candidateSlugs(name: string, website?: string | null): string[] {
  const out: string[] = [];
  const base = (name || '').toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\b(inc|corp|corporation|llc|ltd|limited|co|company|holdings|group|technologies|technology|labs|pbc)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (base) {
    out.push(base.replace(/[\s-]/g, ''));
    out.push(base.replace(/\s+/g, '-'));
  }
  if (website) {
    const host = website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const label = host.split('.')[0];
    if (label && label.length > 1) out.push(label.toLowerCase());
  }
  return [...new Set(out.filter((s) => s.length >= 2))];
}

/* ------------------------------------------------------------------ */
/* Signal rules — brief §5.5                                          */
/* ------------------------------------------------------------------ */

/**
 * Titles that themselves indicate international/APAC intent.
 * Brief §5.5 gives this exact pattern.
 */
export const APAC_TITLE_RE = /(APAC|Asia|International|Singapore)/i;

/**
 * US location detection. An item is emitted for any non-US posting, so this has
 * to decide what counts as US from a free-text location string.
 *
 * Conservative: an unrecognised location counts as US and emits nothing. A
 * missed signal is recoverable, while a fabricated one wastes an RD's time, and
 * RATIONALE §15.2 makes this hypothesis the thing under test — inflated inputs
 * would corrupt the measurement.
 */
const US_STATES = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;
const US_WORDS = /\b(united states|usa|u\.s\.|us remote|remote - us|remote \(us\)|san francisco|new york|seattle|boston|austin|los angeles|san diego|chicago|denver|atlanta|washington|palo alto|mountain view|sunnyvale|santa clara|menlo park|redwood city|cupertino|bay area|silicon valley)\b/i;

/** Locations that are explicitly multi-region and so prove nothing either way. */
const AMBIGUOUS = /\b(remote|anywhere|global|worldwide|multiple locations|various)\b/i;

export function isNonUsLocation(location: string | null): boolean {
  if (!location) return false;
  const s = location.trim();
  if (!s) return false;
  if (US_WORDS.test(s)) return false;
  if (US_STATES.test(s)) return false;
  // "Remote" alone is not evidence of anything.
  if (AMBIGUOUS.test(s) && !/[,-]/.test(s)) return false;
  // Anything naming a recognisable non-US place. The list is explicit so a new
  // country is a config change rather than a surprise.
  return /\b(singapore|japan|tokyo|korea|seoul|china|shanghai|beijing|shenzhen|hong kong|taiwan|taipei|india|bangalore|bengaluru|mumbai|delhi|hyderabad|australia|sydney|melbourne|new zealand|indonesia|jakarta|malaysia|kuala lumpur|thailand|bangkok|vietnam|hanoi|ho chi minh|philippines|manila|united kingdom|uk|london|england|ireland|dublin|germany|berlin|munich|france|paris|netherlands|amsterdam|spain|madrid|barcelona|italy|milan|rome|sweden|stockholm|switzerland|zurich|geneva|israel|tel aviv|canada|toronto|vancouver|montreal|brazil|sao paulo|mexico|poland|warsaw|portugal|lisbon|denmark|copenhagen|norway|oslo|finland|helsinki|austria|vienna|belgium|brussels|czech|prague|romania|bucharest|uae|dubai|abu dhabi|saudi|riyadh|south africa|cape town|nigeria|lagos|kenya|nairobi|egypt|cairo|turkey|istanbul|argentina|chile|colombia|peru)\b/i.test(s);
}

/** Is this posting in APAC specifically? Drives the strongest signal class. */
export function isApacLocation(location: string | null): boolean {
  if (!location) return false;
  return /\b(singapore|japan|tokyo|korea|seoul|china|shanghai|beijing|shenzhen|hong kong|taiwan|taipei|india|bangalore|bengaluru|mumbai|delhi|hyderabad|australia|sydney|melbourne|new zealand|indonesia|jakarta|malaysia|kuala lumpur|thailand|bangkok|vietnam|hanoi|ho chi minh|philippines|manila|apac|asia[- ]pacific|asia)\b/i.test(location);
}

/**
 * The volume trigger — brief §5.5, applied exactly as written:
 *   "a job-count rise above 25% week over week with an absolute floor:
 *    at least 5 new postings on a base of at least 20"
 *
 * All three conditions are required. RATIONALE §4: percentage-only thresholds
 * fire on trivial bases — three jobs becoming four is a 33% rise and means
 * nothing.
 *
 * A missing prior snapshot returns false. A base of zero is not 25% growth, and
 * counting a first observation as growth-from-zero would fabricate the very
 * signal this rule guards against.
 */
export function volumeTriggerFires(prevCount: number | null, currCount: number): boolean {
  if (prevCount === null) return false;      // no baseline yet
  if (prevCount < 20) return false;          // absolute floor on the base
  const delta = currCount - prevCount;
  if (delta < 5) return false;               // absolute floor on new postings
  return delta / prevCount > 0.25;           // and the 25% rate
}
