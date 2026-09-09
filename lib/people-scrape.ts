/**
 * Person extraction from fund team pages and company about/team pages.
 *
 * Form D is the only other source of named people, and it leaves 2,585 portfolio
 * companies and 112 seed companies with nobody attached. That costs the feature
 * DESIGN_RATIONALE §8 rates highest — person-mediated paths outrank
 * organisation-mediated ones, because "Partner X sits on both boards" is
 * actionable where "both took money from the same fund" is not.
 *
 * There is no free, reliable source of named people for arbitrary private
 * companies. LinkedIn is excluded in any form (§14; hiQ lost on breach of the
 * user agreement), and Crunchbase and PitchBook are licensed. So this reads what
 * companies and funds publish about themselves: public, intended for reading,
 * and robots-checked. Coverage is partial by nature — a fund team page is
 * high-yield, a startup with no /team page yields nothing.
 *
 * Missing a person costs less than inventing one (§8), since a fabricated person
 * produces a warm path that does not exist. Every extracted name has to look
 * like a human name and sit near a role word.
 */

const UA = 'Mozilla/5.0 (compatible; AMOpsCoyTracker/1.0; +research)';

/** Role words that appear next to a person on a team page. */
const ROLE_WORDS = [
  'founder', 'co-founder', 'cofounder', 'ceo', 'chief executive', 'cto', 'coo', 'cfo',
  'chief', 'president', 'chairman', 'chairwoman', 'chair', 'partner', 'general partner',
  'managing partner', 'managing director', 'principal', 'director', 'vp', 'vice president',
  'head of', 'lead', 'operating partner', 'venture partner', 'investor', 'associate',
  'scientist', 'engineer', 'advisor', 'board member', 'executive',
];

export function roleFromContext(ctx: string): { role: string; raw: string } | null {
  const low = ctx.toLowerCase();
  // Ordered: most specific first, so "co-founder" wins over "founder".
  const ordered = [...ROLE_WORDS].sort((a, b) => b.length - a.length);
  for (const w of ordered) {
    const i = low.indexOf(w);
    if (i >= 0) {
      const raw = ctx.slice(Math.max(0, i - 20), i + w.length + 25).replace(/\s+/g, ' ').trim();
      if (/co-?founder/.test(w)) return { role: 'founder', raw };
      if (w === 'founder') return { role: 'founder', raw };
      if (/ceo|chief executive/.test(w)) return { role: 'ceo', raw };
      if (/partner|principal|investor/.test(w)) return { role: 'partner', raw };
      if (/chief|cto|coo|cfo|president|vp|vice president|head of|executive/.test(w)) return { role: 'exec', raw };
      if (/chair|board member/.test(w)) return { role: 'director', raw };
      return { role: 'exec', raw };
    }
  }
  return null;
}

/**
 * Title words. A candidate made entirely of title words is a job title rather
 * than a name: "Executive Assistant" and "National Security" both have the shape
 * of a name (two capitalised words), so they need excluding by vocabulary.
 */
const TITLE_WORDS = new Set([
  'executive','assistant','national','security','chief','officer','president','vice',
  'managing','general','operating','venture','partner','principal','director','associate',
  'chairman','chairwoman','chair','founder','cofounder','head','lead','senior','junior',
  'global','regional','technical','technology','financial','marketing','operations',
  'business','development','strategy','strategic','investment','investments','portfolio',
  'talent','people','platform','communications','legal','counsel','advisor','advisory',
  'board','member','emeritus','fellow','scientist','engineer','analyst','manager','intern',
  'human','resources','information','data','product','program','project','affairs','relations',
  // Seen slipping through the shape test:
  'our','the','team','advisors','activist','environmental','entrepreneur','investor',
  'operator','builder','leader','expert','specialist','consultant','professor','author',
  'former','current','retired','co','and','of','at','in','for',
]);

const NOT_A_PERSON = new Set([
  'privacy policy', 'terms of use', 'contact us', 'our team', 'the team', 'about us',
  'read more', 'learn more', 'view profile', 'load more', 'see all', 'all rights',
  'general partner', 'managing partner', 'venture partner', 'operating partner',
  'board member', 'chief executive', 'united states', 'new york', 'san francisco',
  'palo alto', 'menlo park', 'los angeles', 'silicon valley', 'east coast', 'west coast',
]);

/**
 * Does this look like a human name?
 * Two to four capitalised words, no digits, no company suffixes.
 */
export function looksLikePersonName(raw: string): boolean {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s.length < 5 || s.length > 42) return false;
  if (NOT_A_PERSON.has(s.toLowerCase())) return false;
  if (/\d|@|https?:|&|\||,/.test(s)) return false;
  // Company suffixes mean it is an entity, not a person.
  if (/\b(inc|llc|ltd|corp|corporation|company|capital|ventures|partners|fund|group|labs|technologies|holdings)\b/i.test(s)) return false;
  /*
   * Institutions, which a leadership page names constantly: a director's bio
   * says where they trained and where else they sit. "Harvard Medical School"
   * and "Stanford University" are two to four capitalised words carrying no
   * corporate suffix, so they clear every test above and arrive as people.
   */
  if (/\b(university|universit[eé]|college|school|institute|institut|academy|hospital|foundation|society|association|council|committee|board|boards|ministry|department|agency|bureau)\b/i.test(s)) return false;
  const words = s.split(' ');
  if (words.length < 2 || words.length > 4) return false;
  // A single title word disqualifies a 2-word candidate ("Our Advisors",
  // "Environmental Activist"), since a real 2-word name contains none. Longer
  // names can legitimately carry a particle, so there the test is only that the
  // majority are not title words.
  const titleCount = words.filter((w) => TITLE_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, ''))).length;
  if (words.length <= 2 ? titleCount > 0 : titleCount >= words.length - 1) return false;
  // Honorifics are not part of a name and signal a title-led string.
  if (/^(the\s+)?(honorable|hon|rev|sir|dame|lord|lady|dr|prof|professor|mr|mrs|ms|gen|adm|col|capt|lt)\b/i.test(s)) return false;
  // Each word starts uppercase; allow particles (van, de, bin) and initials.
  const particle = /^(van|von|de|del|della|di|da|du|la|le|bin|al|ibn|mc|mac|st)$/i;
  return words.every((w, i) => {
    if (particle.test(w) && i > 0) return true;
    if (/^[A-Z]\.?$/.test(w)) return true;                 // initial
    // A hyphenated given name capitalises both halves — Jean-Luc, Anne-Marie —
    // so the segment after the hyphen is matched rather than treated as a
    // lowercase continuation.
    return /^[A-ZÀ-Þ][a-zà-ÿ'’]*(-[A-ZÀ-Þa-zà-ÿ'’]+)*$/.test(w);
  });
}

export type ScrapedPerson = { name: string; role: string; roleRaw: string; context: string };

/**
 * Extract people from a team page. Looks for name + nearby role word inside the
 * same small block, which is how team pages are almost always laid out.
 */
export function extractPeople(html: string): { people: ScrapedPerson[]; rejected: number } {
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

  const found = new Map<string, ScrapedPerson>();
  let rejected = 0;

  // Blocks likely to hold one person each.
  const blocks = [
    ...clean.matchAll(/<(?:div|li|article|a|section)[^>]*(?:class|id)=["'][^"']*(?:team|member|person|people|bio|profile|card|staff|leader)[^"']*["'][^>]*>([\s\S]{0,700}?)<\/(?:div|li|article|a|section)>/gi),
  ].map((m) => m[1]);

  // Fall back to heading + following text, the other common layout.
  const headed = [
    ...clean.matchAll(/<(h[2-5])[^>]*>([\s\S]{0,80}?)<\/\1>([\s\S]{0,200})/gi),
  ].map((m) => `${m[2]} ${m[3]}`);

  for (const block of [...blocks, ...headed]) {
    const text = block.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    // Candidate names are the pipe-separated fragments.
    for (const frag of text.split('|').map((f) => f.trim())) {
      if (!frag) continue;
      if (!looksLikePersonName(frag)) { if (frag.length > 4) rejected++; continue; }
      const role = roleFromContext(text);
      if (!role) { rejected++; continue; }          // name with no role: skip
      const key = frag.toLowerCase();
      if (!found.has(key)) {
        found.set(key, { name: frag, role: role.role, roleRaw: role.raw, context: text.slice(0, 160) });
      }
    }
  }

  // Structural pass: profile links.
  //
  // A link whose path sits under /team/, /people/, /our-team/ and so on is a
  // person profile by construction, which makes this the most reliable signal
  // available — Khosla Ventures, for instance, renders each partner as
  //   <a href="/team/vinod-khosla"><img alt="Vinod Khosla">
  // The name comes from the link text, the image alt, or the slug itself.
  //
  // The path is doing work no text heuristic can: marketing pages interleave nav
  // labels ("Research Hub", "Focus Areas") with names in the same visual block,
  // and stopword tuning does not separate the two reliably.
  const profileLinks = [...clean.matchAll(
    /<a\s[^>]*href=["']([^"']*\/(?:team|people|our-team|leadership|partners|staff|founders)\/[^"'?#]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi,
  )];

  for (const m of profileLinks) {
    const href = m[1];
    const inner = m[2];
    const slug = href.split('/').filter(Boolean).pop() ?? '';
    // Ignore index/category links: /team/all, /people/page/2
    if (/^(all|index|page|\d+)$/i.test(slug)) continue;

    const candidates = [
      inner.match(/alt=["']([^"']{4,42})["']/i)?.[1],
      inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    ].filter((x): x is string => !!x);

    const name = candidates.find((c) => looksLikePersonName(c));
    if (!name) { rejected++; continue; }

    const key = name.toLowerCase();
    const role = roleFromContext(inner.replace(/<[^>]+>/g, ' '));
    const existing = found.get(key);
    // A strict-pass hit (with a real role) always beats a structural one.
    if (existing && existing.role !== 'unknown') continue;
    found.set(key, {
      name,
      role: role?.role ?? 'unknown',
      roleRaw: role?.raw ?? `profile link ${href}`,
      context: `profile-link pass: ${href}`,
    });
  }

  return { people: [...found.values()], rejected };
}

export async function scrapeTeamPage(url: string): Promise<{ ok: boolean; people: ScrapedPerson[]; rejected: number; error: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow', signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, people: [], rejected: 0, error: `HTTP ${res.status}` };
    const html = await res.text();
    const { people, rejected } = extractPeople(html);
    return { ok: true, people, rejected, error: people.length ? null : 'no people parsed' };
  } catch (e) {
    return { ok: false, people: [], rejected: 0, error: (e as Error).message };
  }
}

/** Common team-page paths, most likely first. */
export const TEAM_PATHS = ['/team', '/people', '/our-team', '/about/team', '/team/', '/about-us', '/about', '/leadership', '/founders'];


/**
 * Find a team page by search when the conventional paths miss.
 *
 * The path list catches companies that use /team or /about; one that puts its
 * people at /company/leadership or renders them in JavaScript is invisible to
 * it. A site-restricted search finds the page the company actually published,
 * and the result is still a page it published about itself.
 *
 * Used as a fallback rather than the first move: the path guesses cost nothing
 * and succeed often enough to be worth trying first.
 */
export async function findTeamPageUrl(
  domain: string,
  companyName: string,
  search: (q: string, o?: { maxResults?: number }) => Promise<Array<{ url: string; title: string }>>,
): Promise<string | null> {
  try {
    const hits = await search(
      `site:${domain} (team OR leadership OR founders OR "about us" OR people)`,
      { maxResults: 6 },
    );
    // Prefer a url whose path looks like a team page over the homepage, which
    // ranks first for a site: query and rarely lists anyone.
    const ranked = hits
      .filter((h) => {
        try { return new URL(h.url).hostname.replace(/^www\./, '').endsWith(domain); }
        catch { return false; }
      })
      /*
       * A job posting is not a team page, and it is what a large employer
       * returns for this query: careers.geaerospace.com and jobs.boeing.com
       * both outrank the real leadership page, then parse into "people" like
       * "Veteran Talent Community" and "Online Info Sessions". Ranking alone
       * did not help — with nothing better on the site, a careers URL still
       * won by default, so it is excluded rather than merely scored lower.
       */
      .filter((h) => !/\b(careers?|jobs?)\b|\/job\/|jobs?\./i.test(h.url))
      .sort((a, b) => score(b) - score(a));
    return ranked[0]?.url ?? null;
  } catch {
    return null;
  }
}

function score(h: { url: string; title: string }): number {
  const hay = `${h.url} ${h.title}`.toLowerCase();
  if (/\b(team|leadership|our-people|founders)\b/.test(hay)) return 3;
  if (/\babout\b/.test(hay)) return 2;
  try { return new URL(h.url).pathname.length > 1 ? 1 : 0; } catch { return 0; }
}
