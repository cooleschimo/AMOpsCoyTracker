/**
 * Conference exhibitor and speaker lists. Brief §5.4, §12 step 17.
 *
 * Every other source in this pipeline puts a company somewhere in the past: a
 * filing, a round, a headline about a decision already taken. An exhibitor list
 * puts a named person in a known city on a known date, in the future, which is
 * the one shape of fact an RD can act on directly — *who from our list will be
 * at SEMICON West, and can we get a meeting?*
 *
 * That is also what makes it a warm path rather than a signal. `lib/paths.ts`
 * reads these rows as `kind: 'event'` and scores them alongside shared
 * investors and shared board seats; nothing here feeds the rubric.
 *
 * Exhibitor lists are worth reading roughly six weeks out, which is when a
 * company actively seeking expansion commits to a stand. Earlier the list is
 * half-empty and later the meeting cannot be arranged.
 *
 * Two rules the parsing turns on:
 *
 *  1. **The list is the source of truth about attendance, and nothing else.**
 *     An exhibitor page names companies in the show's own vocabulary — "Applied
 *     Materials Inc.", "AMAT", a booth number, a track name. Matching one of
 *     those to a company in the graph is entity resolution, and it is done
 *     against the existing table by normalised name only. A company that is not
 *     already tracked is not created from an exhibitor list: a stand at a trade
 *     show says a company exists, which we knew, and nothing about whether it
 *     is in scope.
 *
 *  2. **A wrong participant is worse than a missing one.** The row becomes
 *     "Ana Cheng is speaking at SEMICON West on 8 July" on a page an RD reads
 *     before flying somewhere. Sponsor logos, media partners and the organiser's
 *     own staff all sit in the same markup as exhibitors, so a name that cannot
 *     be tied to a participation kind is dropped rather than guessed.
 */
import { callJson } from './llm';
import type { Budget } from './budget';
import { looksLikePersonName } from './people-scrape';

const UA = 'Mozilla/5.0 (compatible; AMOpsCoyTracker/1.0; +research)';

export type Participation = 'speaker' | 'exhibitor' | 'sponsor' | 'attendee';

export const PARTICIPATIONS: Participation[] = ['speaker', 'exhibitor', 'sponsor', 'attendee'];

export const isParticipation = (v: string): v is Participation =>
  (PARTICIPATIONS as string[]).includes(v);

/**
 * The shows worth reading, by sector.
 *
 * Kept as config rather than discovered, for the same reason `lib/funds.ts` is:
 * a conference is a known, stable thing with an annual cadence, and the cost of
 * guessing at one is a scrape of somebody's unrelated events calendar. The
 * dates move each year, so `listUrl` points at the show's own exhibitor or
 * speaker directory and the year is read off the page rather than assumed.
 *
 * `sectors` uses the broad ids in `lib/subsectors.ts`. It is what decides which
 * companies a show is worth checking against, and it goes onto the event row so
 * the digest's events calendar can be filtered.
 */
export type Conference = {
  name: string;
  /** Short form as the show brands itself; used for matching an existing row. */
  aliases: string[];
  sectors: string[];
  city: string;
  /** The exhibitor, speaker or agenda directory — not the show's homepage. */
  listUrl: string;
  kind: Participation;
  /** Sites whose robots.txt or terms prohibit it, or that block automation. */
  scrape: boolean;
  notes?: string;
};

export const CONFERENCES: Conference[] = [
  /*
   * The directory usually lives on a portal subdomain, not on the show's own
   * site. Marketing hosts increasingly sit behind Cloudflare while the platform
   * underneath — SmallWorldLabs, MapYourShow — serves the same list as plain
   * HTML: www.semiconsea.org returns 403 to every client, where
   * southeastasia2026.smallworldlabs.com serves the exhibitors outright. When a
   * www host refuses, the portal is where to look rather than another path on
   * the blocked domain.
   *
   * Reachable is not the same as permitted, and the two are decided separately.
   * SEMICON West's portal serves its whole list and its robots.txt is a blanket
   * Disallow, so it is marked unscrapable while sitting among the wins.
   *
   * These hosts carry the year, so the URLs need an annual pass. A stale one
   * fails visibly — a 404 recorded against the source rather than a silent
   * empty list — which is the reason `editionDates` reads the year off the page
   * instead of trusting the URL it came from.
   */
  { name: 'SEMICON West', aliases: ['SEMICON'], sectors: ['compute'], city: 'San Francisco, CA',
    listUrl: 'https://portal2026.semiconwest.org/exhibitors', kind: 'exhibitor', scrape: false,
    notes: 'The show a semiconductor company takes a stand at when it is looking for capacity partners, '
      + 'and the exhibitor portal serves the full list as plain HTML — but its robots.txt is a blanket '
      + 'Disallow: /, so the list stays unread.' },
  { name: 'SEMICON Southeast Asia', aliases: ['SEMICON SEA'], sectors: ['compute'], city: 'Kuala Lumpur',
    listUrl: 'https://southeastasia2026.smallworldlabs.com/exhibitors', kind: 'exhibitor', scrape: true,
    notes: 'The regional edition; an exhibitor here is already committing travel to the region.' },
  { name: 'ATxSG', aliases: ['Asia Tech x Singapore', 'ATx Summit'], sectors: ['ai', 'digital'], city: 'Singapore',
    listUrl: 'https://asiatechxsg.com/sponsors/sponsor-exhibitor-list/', kind: 'exhibitor', scrape: true,
    notes: 'The directory across BroadcastAsia, CommunicAsia, SatelliteAsia and TechXLR8Asia. '
      + '/exhibitors/ is the sales page and lists a dozen past sponsors as a sampler.' },
  { name: 'AUSA Annual Meeting', aliases: ['AUSA'], sectors: ['defence'], city: 'Washington, DC',
    listUrl: 'https://meetings.ausa.org/annual/2026/exhibitor_exhibitor_list.cfm', kind: 'exhibitor', scrape: true,
    notes: 'The year is a path segment, and prior editions stay reachable at their own.' },

  /*
   * Shows whose lists exist but cannot be read from here. Each is left in the
   * config with the reason, because the reasons differ and so do the fixes: a
   * Cloudflare block would yield to a different egress, a JavaScript directory
   * never will, and a login is settled. Deleting them would lose that.
   */
  { name: 'Sea Air Space', aliases: ['SAS Expo'], sectors: ['defence', 'aerospace'], city: 'National Harbor, MD',
    listUrl: 'https://sas27.mapyourshow.com/8_0/explore/exhibitor-gallery.cfm', kind: 'exhibitor', scrape: true,
    notes: 'Portal is live but unpopulated until nearer the show; it reports no exhibitors rather than failing.' },
  { name: 'BIO International Convention', aliases: ['BIO Convention', 'BIO'], sectors: ['health'],
    city: 'San Diego, CA', listUrl: 'https://bio2026.mapyourshow.com/8_0/exhibitor/exhibitor-list.cfm',
    kind: 'exhibitor', scrape: false,
    notes: 'Every HTML view is a JavaScript shell. The roster is served only as PDF at ?export=pdf, which needs a text extractor this pipeline does not have.' },
  { name: 'GTC', aliases: ['NVIDIA GTC', 'GPU Technology Conference'], sectors: ['ai', 'compute'],
    city: 'San Jose, CA', listUrl: 'https://www.nvidia.com/gtc/sponsors/', kind: 'exhibitor', scrape: false,
    notes: 'Rendered entirely in JavaScript; the sponsors page serves no names to any fetch.' },
  { name: 'Automate', aliases: ['Automate Show'], sectors: ['industrial'], city: 'Chicago, IL',
    listUrl: 'https://www.automateshow.com/exhibitors', kind: 'exhibitor', scrape: false,
    notes: 'Server-rendered with booth numbers, but Cloudflare 403s every request from here. An edge block, not a JS one.' },
  { name: 'Space Symposium', aliases: ['Space Foundation Symposium'], sectors: ['aerospace'],
    city: 'Colorado Springs, CO', listUrl: 'https://www.spacesymposium.org/exhibitors/', kind: 'exhibitor',
    scrape: false, notes: 'Cloudflare 403 on every path, and no portal host serves the list.' },
  { name: 'Singapore Airshow', aliases: ['SG Airshow'], sectors: ['aerospace', 'defence'], city: 'Singapore',
    listUrl: 'https://www.singaporeairshow.com/exhibit/exhibitor-listing', kind: 'exhibitor', scrape: false,
    notes: 'Moved behind the business-matching login. Next edition February 2028.' },
  { name: 'JP Morgan Healthcare Conference', aliases: ['JPM Healthcare', 'JPMHC'], sectors: ['health'],
    city: 'San Francisco, CA', listUrl: 'https://www.jpmorgan.com/healthcare-conference', kind: 'speaker',
    scrape: false, notes: 'Presenting-company list is behind registration.' },
  { name: 'Web Summit', aliases: ['Websummit'], sectors: ['digital', 'ai'], city: 'Lisbon',
    listUrl: 'https://websummit.com/startups/', kind: 'exhibitor', scrape: false,
    notes: 'Startup directory is behind a login.' },
];

/**
 * Read a page's robots.txt group for '*' and say whether this path is allowed.
 * Unreachable robots.txt is treated as permission, matching the fund scraper.
 */
export async function robotsAllows(url: string): Promise<{ allowed: boolean; note: string }> {
  try {
    const u = new URL(url);
    const res = await fetch(`${u.origin}/robots.txt`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { allowed: true, note: 'no robots.txt' };
    const txt = (await res.text()).slice(0, 20000);
    const lines = txt.split('\n').map((l) => l.replace(/#.*$/, '').trim());
    let inStar = false;
    const disallows: string[] = [];
    for (const l of lines) {
      const m = l.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
      if (!m) continue;
      const [, k, v] = m;
      if (k.toLowerCase() === 'user-agent') inStar = v.trim() === '*';
      else if (inStar && k.toLowerCase() === 'disallow' && v.trim()) disallows.push(v.trim());
    }
    const path = u.pathname || '/';
    const blocked = disallows.find((d) => d === '/' || path.startsWith(d));
    return blocked
      ? { allowed: false, note: `robots.txt disallows "${blocked}"` }
      : { allowed: true, note: 'robots.txt allows' };
  } catch {
    return { allowed: true, note: 'robots.txt unreachable' };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
}

/**
 * The text an exhibitor directory carries, as lines.
 *
 * Directories are lists rather than prose, and the useful unit is one entry —
 * a company name with a booth number, or a session title with a speaker and
 * their employer. Flattening to a single paragraph loses the boundary between
 * entries and lets a booth number attach to the wrong company, so block-level
 * tags become newlines and the model reads one entry per line.
 *
 * Attribute values carry the name as often as the text does: exhibitor grids
 * are commonly a logo per cell with the company only in the `alt` or `title`.
 */
export function directoryLines(html: string): string[] {
  const cleaned = stripHtml(html)
    // Keep the alt/title text, which is where a logo-grid hides its names.
    .replace(/<img[^>]*\b(?:alt|title)=["']([^"']{2,80})["'][^>]*>/gi, ' $1 ')
    .replace(/<\/(?:div|li|tr|td|p|h[1-6]|section|article|a)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ');

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of cleaned.split('\n')) {
    const line = raw.replace(/[ \t]+/g, ' ').trim();
    if (line.length < 2 || line.length > 300) continue;
    // Navigation chrome repeats on every directory and carries no entries.
    if (/^(home|menu|search|login|register|sign in|cookie|privacy|terms|back to top|filter|sort by|show more|load more|next|previous|page \d+)$/i.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export type FetchedDirectory = {
  ok: boolean;
  url: string;
  lines: string[];
  error: string | null;
};

export async function fetchDirectory(url: string): Promise<FetchedDirectory> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow', signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, url, lines: [], error: `HTTP ${res.status}` };
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) return { ok: false, url, lines: [], error: `content-type ${ct.slice(0, 40)}` };
    const html = (await res.text()).slice(0, 900_000);
    const lines = directoryLines(html);
    return { ok: true, url, lines, error: lines.length ? null : 'no lines parsed' };
  } catch (e) {
    return { ok: false, url, lines: [], error: (e as Error).message };
  }
}

/**
 * Dates as a show states them.
 *
 * Directories head themselves with the edition — "SEMICON West 2026 · July
 * 7–9, 2026 · Phoenix, AZ" — and that line is the only place the year is
 * stated. Reading it matters more than it looks: an exhibitor list scraped in
 * March against last year's dates produces a path to a show that has already
 * happened, which reads as current on the company page.
 *
 * Ranges are the common form and both endpoints are wanted, since the digest
 * shows a window and `paths.ts` filters on the start.
 */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function parseDateRange(text: string): { startsOn: string; endsOn: string } | null {
  const t = text.replace(/\s+/g, ' ');
  const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';

  // "July 7–9, 2026" — one month, a day range.
  const sameMonth = t.match(new RegExp(`\\b${mon}\\.?\\s+(\\d{1,2})\\s*[–—\\-]\\s*(\\d{1,2}),?\\s+(\\d{4})`, 'i'));
  if (sameMonth) {
    const m = MONTHS[sameMonth[1].slice(0, 3).toLowerCase()];
    const [d1, d2, y] = [Number(sameMonth[2]), Number(sameMonth[3]), Number(sameMonth[4])];
    if (m && d1 >= 1 && d1 <= 31 && d2 >= d1 && d2 <= 31) return { startsOn: iso(y, m, d1), endsOn: iso(y, m, d2) };
  }

  // "June 30 – July 2, 2026" — the range crosses a month boundary.
  const crossMonth = t.match(new RegExp(`\\b${mon}\\.?\\s+(\\d{1,2})\\s*[–—\\-]\\s*${mon}\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i'));
  if (crossMonth) {
    const m1 = MONTHS[crossMonth[1].slice(0, 3).toLowerCase()];
    const m2 = MONTHS[crossMonth[3].slice(0, 3).toLowerCase()];
    const [d1, d2, y] = [Number(crossMonth[2]), Number(crossMonth[4]), Number(crossMonth[5])];
    // A December-to-January edition belongs to two years; the later month is
    // the one that rolls over.
    const y2 = m2 < m1 ? y + 1 : y;
    if (m1 && m2 && d1 >= 1 && d2 >= 1) return { startsOn: iso(y, m1, d1), endsOn: iso(y2, m2, d2) };
  }

  // "30 June – 2 July 2026" — day-first, crossing a month.
  const dayFirstCross = t.match(new RegExp(`\\b(\\d{1,2})\\s+${mon}\\.?\\s*[–—\\-]\\s*(\\d{1,2})\\s+${mon}\\.?,?\\s+(\\d{4})`, 'i'));
  if (dayFirstCross) {
    const m1 = MONTHS[dayFirstCross[2].slice(0, 3).toLowerCase()];
    const m2 = MONTHS[dayFirstCross[4].slice(0, 3).toLowerCase()];
    const [d1, d2, y] = [Number(dayFirstCross[1]), Number(dayFirstCross[3]), Number(dayFirstCross[5])];
    // The year is stated once, at the end, so it belongs to the later month and
    // the earlier one rolls back across a December-to-January boundary.
    const y1 = m2 < m1 ? y - 1 : y;
    if (m1 && m2 && d1 >= 1 && d2 >= 1) return { startsOn: iso(y1, m1, d1), endsOn: iso(y, m2, d2) };
  }

  // "26 - 28 May 2027" — day-first range, how shows outside the US write it.
  // Checked before the single-day forms, which would otherwise match the tail
  // of it and record the last day as the whole show.
  const dayFirstRange = t.match(new RegExp(`\\b(\\d{1,2})\\s*[–—\\-]\\s*(\\d{1,2})\\s+${mon}\\.?,?\\s+(\\d{4})`, 'i'));
  if (dayFirstRange) {
    const m = MONTHS[dayFirstRange[3].slice(0, 3).toLowerCase()];
    const [d1, d2, y] = [Number(dayFirstRange[1]), Number(dayFirstRange[2]), Number(dayFirstRange[4])];
    if (m && d1 >= 1 && d2 >= d1 && d2 <= 31) return { startsOn: iso(y, m, d1), endsOn: iso(y, m, d2) };
  }

  // "12 May 2026" and "May 12, 2026" — a single day.
  const dayFirst = t.match(new RegExp(`\\b(\\d{1,2})\\s+${mon}\\.?,?\\s+(\\d{4})`, 'i'));
  if (dayFirst) {
    const m = MONTHS[dayFirst[2].slice(0, 3).toLowerCase()];
    const [d, y] = [Number(dayFirst[1]), Number(dayFirst[3])];
    if (m && d >= 1 && d <= 31) return { startsOn: iso(y, m, d), endsOn: iso(y, m, d) };
  }
  const monthFirst = t.match(new RegExp(`\\b${mon}\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i'));
  if (monthFirst) {
    const m = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()];
    const [d, y] = [Number(monthFirst[2]), Number(monthFirst[3])];
    if (m && d >= 1 && d <= 31) return { startsOn: iso(y, m, d), endsOn: iso(y, m, d) };
  }

  return null;
}

/**
 * The show's dates, read from the head of its own directory.
 *
 * Only the first lines are considered. A conference site is dense with other
 * dates — registration deadlines, last year's recap, the next edition's
 * save-the-date — and the edition banner is what sits at the top.
 */
export function editionDates(lines: string[]): { startsOn: string; endsOn: string } | null {
  for (const line of lines.slice(0, 40)) {
    const d = parseDateRange(line);
    if (d) return d;
  }
  return null;
}

/**
 * The names on an exhibitor or speaker list, read by a model.
 *
 * A directory is a list of names with no grammar, which is why this is a model
 * call rather than a regex. "Applied Materials · Booth 1423" and "Panel: Scaling
 * Advanced Packaging — Dr. Ana Cheng, VP Operations, Amkor" are both one entry,
 * and only one of them contains a person. Nothing in the layout distinguishes an
 * exhibitor from a media partner or the organiser's own staff either, and both
 * appear in the same grid.
 *
 * The prompt is written to refuse. Every row it returns becomes a claim that a
 * specific person will be in a specific city on a specific date, shown to
 * someone deciding whether to travel, so an entry that does not clearly state
 * both a company and its participation is dropped.
 */
export const EVENT_PARTICIPANTS_SYSTEM = `You read a conference exhibitor, speaker or agenda listing and extract who is taking part.

Each line is one fragment of the listing. Most are navigation, sponsorship tiers, session times or venue detail and contain nobody; that is expected, and an empty list is a correct answer for a page that turned out to be a landing page rather than a directory.

Return one entry per organisation taking part. For each, give:
- company: the organisation's name as the listing writes it, without the booth number, tier label or trailing punctuation
- person: the individual named alongside it, or empty when the listing names none. Exhibitor grids usually name nobody, and an empty person is normal.
- person_title: their role as the listing states it, or empty
- participation: exhibitor, speaker, sponsor or attendee — whichever the listing says this organisation is doing

Leave out the organiser, the venue, media partners, the conference itself, and any association or publication listed as a supporting body rather than a participant. These sit in the same part of the page as real exhibitors and are not companies attending.

Do not infer a person from a company name, or a company from a person's name. Do not carry a name from one line onto another. If a line names a person with no employer, skip it — a person with no company cannot be attached to anything.

Being wrong costs more than being silent. Each entry becomes a statement that this organisation will be at this event on a stated date, read by someone deciding whether to travel there. When a line is ambiguous, leave it out.

Return JSON only: {"participants":[{"company":"...","person":"","person_title":"","participation":"exhibitor"}]}`;

export type ExtractedParticipant = {
  company: string;
  person: string;
  personTitle: string;
  participation: Participation;
};

type ExtractOut = {
  participants?: Array<{
    company?: string; person?: string; person_title?: string; participation?: string;
  }>;
};

/**
 * A conference's own name in the participant list is the organiser echoing
 * itself, and a "media partner" row is a publication rather than an attendee.
 * Both survive the prompt often enough to be worth a second pass.
 */
const NOT_A_PARTICIPANT = /\b(media partner|supporting (organisation|organization|association)|host(ed by)?|organiser|organizer|venue|convention cent(re|er)|association|society|magazine|journal|press|conference|expo|summit|symposium|show daily)\b/i;

export function plausibleParticipant(p: ExtractedParticipant, eventName: string): boolean {
  const company = p.company.trim();
  if (company.length < 2 || company.length > 90) return false;
  if (NOT_A_PARTICIPANT.test(company)) return false;
  // The show listing itself, in any of the forms it writes its own name.
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fold(company) === fold(eventName)) return false;
  if (p.person && !looksLikePersonName(p.person)) return false;
  return true;
}

/**
 * Directories run to hundreds of lines, so they arrive in chunks; a chunk that
 * fails costs its own names and not the page.
 *
 * `maxChunks` is what keeps one show from spending the stage. AUSA lists around
 * twelve hundred exhibitors and SEMICON West several hundred, which at this
 * chunk size is a meaningful share of a day's allowance for a single
 * conference — and the shows further down the list would find nothing left. The
 * cap costs the tail of the largest directories, which is alphabetical rather
 * than ranked, so what it drops is arbitrary but bounded; the alternative is
 * one show deciding what every other show gets.
 */
export async function extractParticipants(
  lines: string[],
  event: { name: string; kind: Participation },
  opts: { budget?: Budget; chunkSize?: number; maxChunks?: number } = {},
): Promise<{
  participants: ExtractedParticipant[]; chunks: number; failedChunks: number; truncated: boolean;
}> {
  const chunkSize = opts.chunkSize ?? 120;
  const maxChunks = opts.maxChunks ?? 8;
  const out = new Map<string, ExtractedParticipant>();
  let chunks = 0;
  let failedChunks = 0;
  let truncated = false;

  for (let i = 0; i < lines.length; i += chunkSize) {
    if (opts.budget?.halted) break;
    if (chunks >= maxChunks) { truncated = true; break; }
    chunks++;
    const chunk = lines.slice(i, i + chunkSize);
    const user = `Event: ${event.name}\nThis listing is the event's ${event.kind} directory.\n\nLines:\n${chunk.map((l) => `- ${l}`).join('\n')}`;

    const res = await callJson<ExtractOut>({
      system: EVENT_PARTICIPANTS_SYSTEM, user, budget: opts.budget, reasoningEffort: 'low',
    });
    if (!res.ok || !Array.isArray(res.data?.participants)) { failedChunks++; continue; }

    for (const r of res.data.participants) {
      const company = (r.company ?? '').trim();
      if (!company) continue;
      const stated = (r.participation ?? '').trim().toLowerCase();
      const participation: Participation = isParticipation(stated) ? stated : event.kind;
      const person = (r.person ?? '').trim();
      const p: ExtractedParticipant = {
        company, person, personTitle: (r.person_title ?? '').trim(), participation,
      };
      if (!plausibleParticipant(p, event.name)) continue;
      // One row per company-person-participation; a directory repeats an
      // exhibitor across category pages and in its own A–Z index.
      const key = `${company.toLowerCase()}|${person.toLowerCase()}|${participation}`;
      if (!out.has(key)) out.set(key, p);
    }
  }

  return { participants: [...out.values()], chunks, failedChunks, truncated };
}

/**
 * Is this edition worth writing?
 *
 * A show that has already happened produces a path an RD cannot take, and one
 * eighteen months out has an exhibitor list that is mostly empty. The window is
 * the brief's: read a list about six weeks before the show, and keep an edition
 * on the page until it starts.
 */
export function withinPlanningWindow(startsOn: string | null, today = new Date()): boolean {
  if (!startsOn) return true;          // undated: let the row stand, the page shows no date
  const start = new Date(`${startsOn}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return false;
  const days = (start.getTime() - today.getTime()) / 86_400_000;
  return days >= 0 && days <= 400;
}
