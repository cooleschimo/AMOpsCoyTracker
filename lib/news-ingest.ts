/**
 * Shared helpers for writing fetched items into `items`. Brief §5.5, §7.
 *
 * Everything that arrives is written with status 'fetched'; the step 9 filter
 * then sets status and dropped_reason. Nothing fetched is deleted, because the
 * dropped set is the training data and cannot be rebuilt later — so quality
 * judgments belong in the filter, not here.
 *
 * The one class ingestion discards before writing is the structurally unusable:
 * rows with no URL, or a URL that will not parse.
 */

/**
 * Tracking parameters stripped during canonicalisation (brief §7 stage 1).
 * Google News links carry utm_* and its own oc/hl/gl/ceid params; wires add
 * their own. Stripping these is what makes exact dedupe work at all.
 */
const TRACKING_PARAMS = [
  /^utm_/i, /^ga_/i, /^fbclid$/i, /^gclid$/i, /^mc_[ce]id$/i,
  /^oc$/i, /^ceid$/i, /^hl$/i, /^gl$/i,
  /^ref$/i, /^referrer$/i, /^source$/i, /^spm$/i, /^__twitter_impression$/i,
];

/**
 * Canonicalise a URL for dedupe. Brief §7 stage 1.
 *
 * Google News RSS links are redirect wrappers (news.google.com/rss/articles/...)
 * whose target is not in the URL — it is base64 inside the path segment, and
 * That encoding does not decode reliably. The
 * wrapper itself is stable per article, so canonicalising the wrapper is enough:
 * two feeds carrying the same article produce the same wrapper URL and exact
 * dedupe still catches them. Cross-source dedupe is the clustering stage's job.
 */
export function canonicalizeUrl(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // Normalise host; drop the default port and a trailing slash on the root.
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.protocol = 'https:';
    u.port = '';
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
    }
    // Sort remaining params so ?a=1&b=2 and ?b=2&a=1 dedupe to one row.
    const sorted = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of sorted) u.searchParams.append(k, v);
    let out = u.toString();
    if (out.endsWith('/') && u.pathname === '/') out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

/**
 * Google News wraps every headline as "Real headline - Publication". The
 * publication is more reliable here than the <source> tag, which is sometimes
 * absent. Returns the trimmed title and the trailing publication if present.
 */
export function splitGoogleTitle(title: string): { title: string; source: string | null } {
  const m = title.match(/^(.*)\s+-\s+([^-]{2,60})$/);
  if (!m) return { title: title.trim(), source: null };
  return { title: m[1].trim(), source: m[2].trim() };
}
