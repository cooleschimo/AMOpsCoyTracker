/**
 * Entity resolution helpers. Brief §6.
 *
 * STANCE (DESIGN_RATIONALE §8): prefer FALSE SPLITS over FALSE MERGES.
 * A duplicate person is untidy; a wrongly merged one produces a warm path that
 * does not exist, and an RD acting on it looks foolish in front of a founder.
 * Automated resolution reaches ~80%; /admin/merge exists for the rest.
 */

const COMPANY_SUFFIXES = [
  'incorporated', 'inc', 'corporation', 'corp', 'llc', 'l l c', 'ltd', 'limited',
  'lp', 'llp', 'plc', 'co', 'company', 'holdings', 'group',
  'technologies', 'technology', 'tech', 'labs', 'laboratories', 'labs inc',
  'systems', 'solutions', 'ventures', 'partners', 'capital', 'pbc',
];

/** Lowercase, strip punctuation and legal suffixes. Brief §6. */
export function normalizeCompanyName(raw: string): string {
  let s = (raw || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of COMPANY_SUFFIXES) {
      if (s.endsWith(' ' + suf)) { s = s.slice(0, -(suf.length + 1)).trim(); changed = true; }
    }
  }
  return s || (raw || '').toLowerCase().trim();
}

/** People: lowercase, strip punctuation. Suffixes stripped, but NOT given names. */
export function normalizePersonName(raw: string): string {
  let s = (raw || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+(jr|sr|ii|iii|iv|md|phd|dr)$/g, '').trim();
  return s;
}

export function normalizeOrgName(raw: string): string {
  return normalizeCompanyName(raw);
}

/** Domain is the STRONGEST company signal (brief §6). Strips www and paths. */
export function normalizeDomain(raw?: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  return s || null;
}

/** Pipe-separated lists from a CSV cell. Empty string yields [] — never ['']. */
export function parsePipeList(raw?: string | null): string[] {
  if (!raw) return [];
  return raw.split('|').map((s) => s.trim()).filter(Boolean);
}

/**
 * Integer millions. Blank means UNKNOWN and must stay null — never 0.
 * Brief §2: "blank when unknown — never 0".
 */
export function parseMusd(raw?: string | null): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s.replace(/[,$]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** round_date is 'YYYY' or 'YYYY-MM' — kept as TEXT, not coerced to a false day. */
export function validRoundDate(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  return /^\d{4}(-\d{2})?$/.test(s) ? s : null;
}

/** 'YYYY-MM' -> 'YYYY-MM-01' for DATE columns; 'YYYY' -> 'YYYY-01-01'. */
export function toDateOrNull(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}
