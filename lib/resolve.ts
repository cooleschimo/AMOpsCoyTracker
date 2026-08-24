/**
 * Entity resolution. Brief §6, DESIGN_RATIONALE §8.
 *
 * False splits are preferred to false merges: a duplicate person is untidy,
 * while a wrongly merged one produces a warm path that does not exist, and an
 * RD acting on it looks foolish in front of a founder.
 *
 * Automated resolution reaches roughly 80%. This module proposes candidates;
 * /admin/merge is where a human decides.
 */
import { normalizeCompanyName, normalizePersonName, normalizeDomain } from './normalize';

/** Levenshtein, capped for early exit. */
export function editDistance(a: string, b: string, max = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Character-trigram Jaccard. Used for both names and, later, news clustering. */
export function trigrams(s: string): Set<string> {
  const t = ` ${s.replace(/\s+/g, ' ').trim()} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export type MatchSignal =
  | 'exact_normalized_name' | 'domain' | 'cik'
  | 'near_name' | 'alias' | 'trigram';

export type Candidate = {
  leftId: number; rightId: number;
  leftName: string; rightName: string;
  signals: MatchSignal[];
  score: number;          // 0-1 confidence that these are the same entity
  sharedContext: string | null;
  caution: string | null; // why a human should look twice
};

export type CompanyRow = {
  id: number; name: string; normalizedName: string | null;
  website: string | null; cik: string | null; aliases: string[] | null;
};

/**
 * Company duplicate candidates. Domain is the strongest signal (brief §6), and
 * CIK is authoritative.
 */
export function companyCandidates(rows: CompanyRow[]): Candidate[] {
  const out: Candidate[] = [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tri = new Map<number, Set<string>>();
  const norm = (r: CompanyRow) => r.normalizedName ?? normalizeCompanyName(r.name);
  for (const r of rows) tri.set(r.id, trigrams(norm(r)));

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const na = norm(a), nb = norm(b);
      const signals: MatchSignal[] = [];
      let score = 0;

      if (a.cik && b.cik && a.cik === b.cik) { signals.push('cik'); score = Math.max(score, 0.99); }

      const da = normalizeDomain(a.website), dbb = normalizeDomain(b.website);
      if (da && dbb && da === dbb) { signals.push('domain'); score = Math.max(score, 0.95); }

      if (na && na === nb) { signals.push('exact_normalized_name'); score = Math.max(score, 0.9); }

      const aliasHit = (a.aliases ?? []).some((x) => normalizeCompanyName(x) === nb)
        || (b.aliases ?? []).some((x) => normalizeCompanyName(x) === na);
      if (aliasHit) { signals.push('alias'); score = Math.max(score, 0.85); }

      if (!signals.length) {
        const d = editDistance(na, nb, 2);
        if (d <= 2 && Math.min(na.length, nb.length) >= 6) {
          signals.push('near_name');
          score = Math.max(score, d === 1 ? 0.7 : 0.6);
        } else {
          const jac = jaccard(tri.get(a.id)!, tri.get(b.id)!);
          if (jac >= 0.75) { signals.push('trigram'); score = Math.max(score, 0.55 + (jac - 0.75)); }
        }
      }

      if (!signals.length) continue;

      // Caution flags: reasons a plausible match may still be two companies.
      let caution: string | null = null;
      if (a.cik && b.cik && a.cik !== b.cik) {
        caution = 'DIFFERENT CIKs — the SEC treats these as different registrants';
        score = Math.min(score, 0.5);
      } else if (da && dbb && da !== dbb) {
        caution = `different domains (${da} vs ${dbb})`;
        score = Math.min(score, 0.6);
      }

      out.push({
        leftId: a.id, rightId: b.id, leftName: a.name, rightName: b.name,
        signals, score, sharedContext: null, caution,
      });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

export type PersonRow = {
  id: number; name: string; normalizedName: string;
  companyIds: number[]; companyNames: string[];
};

/**
 * Person duplicate candidates, matched within company context first (brief §6),
 * so that two different Michael Chens at two companies stay separate. A shared
 * company is the only strong evidence available from public data; without one,
 * an identical name is weak evidence and is surfaced with a caution rather than
 * a high score.
 */
export function personCandidates(rows: PersonRow[]): Candidate[] {
  const out: Candidate[] = [];
  const byName = new Map<string, PersonRow[]>();
  for (const r of rows) {
    if (!byName.has(r.normalizedName)) byName.set(r.normalizedName, []);
    byName.get(r.normalizedName)!.push(r);
  }

  for (const [, group] of byName) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const shared = a.companyIds.filter((c) => b.companyIds.includes(c));
        const sharedNames = a.companyNames.filter((n) => b.companyNames.includes(n));

        // Same name and same company is almost certainly one person recorded
        // twice; same name at different companies is probably two people, and
        // the split is preferred.
        const score = shared.length ? 0.9 : 0.25;
        out.push({
          leftId: a.id, rightId: b.id, leftName: a.name, rightName: b.name,
          signals: ['exact_normalized_name'],
          score,
          sharedContext: sharedNames.length ? sharedNames.join(', ') : null,
          caution: shared.length
            ? null
            : `NO shared company — "${a.companyNames.join(', ') || 'none'}" vs "${b.companyNames.join(', ') || 'none'}". Common names collide; merging invents a path that does not exist.`,
        });
      }
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

/** Organization aliasing needs a manual table: no algorithm knows a16z = AH Capital. */
export function orgCandidates(rows: Array<{ id: number; name: string; normalizedName: string }>): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (a.normalizedName === b.normalizedName) {
        out.push({ leftId: a.id, rightId: b.id, leftName: a.name, rightName: b.name,
          signals: ['exact_normalized_name'], score: 0.9, sharedContext: null, caution: null });
        continue;
      }
      const d = editDistance(a.normalizedName, b.normalizedName, 2);
      if (d <= 2 && Math.min(a.normalizedName.length, b.normalizedName.length) >= 6) {
        out.push({ leftId: a.id, rightId: b.id, leftName: a.name, rightName: b.name,
          signals: ['near_name'], score: d === 1 ? 0.65 : 0.55, sharedContext: null,
          caution: 'similar name only — funds often have near-identical entity names per vintage' });
      }
    }
  }
  return out.sort((x, y) => y.score - x.score);
}
