/**
 * Newsletters, read from their own archive pages.
 *
 * A newsletter is a curated feed: an editor has already decided what mattered
 * that day, which is the filtering step this pipeline otherwise pays a model to
 * do. TLDR alone carries stories that reach no RSS feed here — "SpaceX starts
 * in-house turbine blade manufacturing" is a facility signal that appeared in
 * no wire we poll.
 *
 * The obvious route is to subscribe and parse the email, and that works: Resend
 * (already a dependency) forwards inbound mail to a webhook. But it needs a
 * verified domain, a deployed endpoint and a signup per publication before the
 * first story arrives, and it fails silently when a sender changes its layout.
 *
 * These publications post the same issue on the web, at a URL containing the
 * date. Fetching that is the same content with none of the plumbing, and it
 * backfills — an archive page from three weeks ago is as readable as today's,
 * where an inbox only has what arrived after subscribing.
 *
 * The landing page is the better read of the two. A dated issue is one edition
 * of one newsletter, around 13 stories; the landing page carries several days
 * across every edition, and links out to the original publication rather than
 * to itself. That is 159 external stories against 13, and the density is
 * different too — 9 of 25 landing-page headlines name a company doing
 * something, against 2 of 25 from a single dated issue.
 *
 * Email stays the right answer for a newsletter with NO public archive. When
 * one is worth having, lib/inbound-email.ts is where that would go.
 *
 * WHICH newsletters are worth reading is a separate question from whether the
 * reading works, and the measurement so far says: not TLDR. Asked how many of
 * its headlines name a company doing something — the same test applied to every
 * feed in lib/news-sources.ts — TLDR returned 2 of 25, against 5 of 15 for
 * Techmeme and 10 of 25 for the sector trade press. Both of its two were
 * product announcements from companies already tracked.
 *
 * That is not a fault in TLDR. It curates for engineers keeping up with the
 * field, where this pipeline wants companies raising money, opening sites and
 * signing partners. The editions stay configured and disabled: the reader is
 * built and tested, so a newsletter that does carry corporate activity — a
 * regional VC letter, an FDI or trade-press briefing — is a config entry rather
 * than a project.
 */

export type Newsletter = {
  id: string;
  name: string;
  /**
   * The landing page, which carries several days across every edition and links
   * out to the original publications. Read in preference to a dated issue.
   */
  homeUrl?: string;
  /** Built from a date, because that is how these archives are addressed. */
  issueUrl: (d: Date) => string;
  /** Sectors the edition bears on. Empty means all. */
  sectors: string[];
  enabled: boolean;
  note?: string;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export const NEWSLETTERS: Newsletter[] = [
  {
    id: 'tldr',
    name: 'TLDR',
    homeUrl: 'https://tldr.tech/',
    issueUrl: (d) => `https://tldr.tech/tech/${iso(d)}`,
    sectors: [],
    enabled: true,
  },
];

export type NewsletterStory = {
  title: string;
  url: string | null;
  /** The edition's own section, e.g. "Big Tech & Startups". */
  section: string | null;
};

const UA = 'Mozilla/5.0 (compatible; AMOpsCoyTracker/1.0; +research)';

/** Section headers, and the sponsor blocks that are advertising rather than news. */
const SECTION_RE =
  /^(big tech|science|programming|miscellaneous|quick links|research|startups|launches|deals|funding|policy|security|headlines|attacks|strategy|trends|tools|opinions|analysis|around the horn|hardware|software|design|data|engineering|models)\b/i;
const SPONSOR_RE = /\(sponsor\)|sponsored/i;

/**
 * Read the stories out of an issue page.
 *
 * These archives are plain HTML — no rendering, no script — so the parse is a
 * regex over headings rather than a browser. A layout change breaks it loudly
 * (zero stories) rather than quietly returning something wrong, which is the
 * failure mode worth having.
 */
export function parseIssue(html: string): NewsletterStory[] {
  const out: NewsletterStory[] = [];
  let section: string | null = null;

  // Headings carry both the section names and the story titles, in order, so a
  // single pass keeps each story with the section it sat under.
  for (const m of html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)) {
    const block = m[1];
    const text = decode(block.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!text) continue;

    // A section header is short and has no sentence in it. A story headline
    // that happens to start with one of these words does not qualify, which is
    // why the length and punctuation both have to hold.
    if (SECTION_RE.test(text) && text.length < 45 && !/[.?!]/.test(text)) {
      section = text;
      continue;
    }
    if (SPONSOR_RE.test(text)) continue;

    const href = block.match(/href="([^"]+)"/)?.[1] ?? null;
    // "(17 minute read)" is the edition's own annotation, not part of the title.
    const title = text.replace(/\s*\((?:\d+\s*minute\s*read|GitHub Repo|Video)\)\s*$/i, '').trim();
    if (title.length < 15) continue;

    out.push({ title, url: href, section });
  }
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/**
 * Read the landing page: every story it links out to, with its own URL.
 *
 * A dated issue is parsed from its headings; the landing page is parsed from
 * its outbound links, because that is what it is — a list of other people's
 * articles. Taking the link means the item carries the publisher's URL rather
 * than a newsletter permalink, so the source that gets credited is the one that
 * wrote the story.
 */
export function parseHome(html: string, host: string): NewsletterStory[] {
  const seen = new Set<string>();
  const out: NewsletterStory[] = [];

  for (const m of html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{15,300}?)<\/a>/g)) {
    const url = m[1];
    // Its own pages, and the subscribe and sponsor links every issue carries.
    if (url.includes(host)) continue;
    if (/utm_source=tldr(?!\w)/.test(url) && /sponsor|advertise|jobs\./i.test(url)) continue;

    const text = decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const title = text.replace(/\s*\((?:\d+\s*minute\s*read|GitHub Repo|Video|Sponsor)\)\s*$/i, '').trim();
    if (title.length < 18) continue;
    if (SPONSOR_RE.test(text)) continue;
    // The same story appears in more than one edition on the same page.
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());

    out.push({ title, url, section: null });
  }
  return out;
}

/** Fetch one issue. A missing issue — a weekend, a holiday — returns empty. */
export async function fetchIssue(
  n: Newsletter,
  d: Date,
): Promise<{ stories: NewsletterStory[]; error: string | null }> {
  try {
    const res = await fetch(n.issueUrl(d), {
      headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { stories: [], error: res.status === 404 ? null : `HTTP ${res.status}` };
    return { stories: parseIssue(await res.text()), error: null };
  } catch (e) {
    return { stories: [], error: (e as Error).message };
  }
}

/**
 * Read a newsletter the best way it offers: its landing page when it has one,
 * and today's dated issue otherwise.
 */
export async function fetchNewsletter(
  n: Newsletter,
  d = new Date(),
): Promise<{ stories: NewsletterStory[]; error: string | null }> {
  if (!n.homeUrl) return fetchIssue(n, d);
  try {
    const res = await fetch(n.homeUrl, {
      headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { stories: [], error: `HTTP ${res.status}` };
    const host = new URL(n.homeUrl).hostname.replace(/^www\./, '');
    return { stories: parseHome(await res.text(), host), error: null };
  } catch (e) {
    return { stories: [], error: (e as Error).message };
  }
}
