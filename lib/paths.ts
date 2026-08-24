/**
 * Warm-path discovery. Brief §8, DESIGN_RATIONALE §9.
 *
 * THE CENTRAL HONESTY RULE: graph structure alone NEVER establishes warmth.
 * Public evidence connects entities; only a human knows whether EDB actually
 * has access. Every path returned here is a POSSIBLE path — an association —
 * until an RD reviews it. Nothing in the UI or the digest may call an
 * unreviewed path a warm introduction.
 *
 * TWO RANKING RULES that matter more than the ordering itself (brief §8):
 *
 *  1. WEIGHT INVERSELY TO NODE DEGREE. A fund with 500 portfolio companies
 *     shares an investor with half the target list, so "both took money from a
 *     mega-fund" is trivia, not a lead. Without this discount hub nodes swamp
 *     every result and the feature becomes noise within a month.
 *
 *  2. PREFER PERSON-MEDIATED PATHS. "Partner X sits on both boards" is
 *     actionable; "both companies took money from the same fund" usually is
 *     not. A named human in the path beats one without, regardless of hops.
 */
import { sql } from 'drizzle-orm';
import { getSql } from './db';

export type PathKind = 'person_role' | 'fund_portfolio' | 'company_edge' | 'event';

export type WarmPath = {
  kind: PathKind;
  /** Always phrased as a possibility, never as a warm introduction. */
  description: string;
  viaPersonId: number | null;
  viaPersonName: string | null;
  viaOrgId: number | null;
  viaOrgName: string | null;
  targetCompanyId: number | null;
  targetCompanyName: string | null;
  evidence: string;
  sourceUrl: string | null;
  /** Higher is more promising. Degree-discounted; person paths boosted. */
  score: number;
  degree: number | null;
  /** 'scraped' = degree is meaningful; 'incidental' = we simply lack data. */
  coverage?: 'scraped' | 'incidental';
  reviewStatus: string;
};

/**
 * Steep discount: a hub node touching everything tells you nothing.
 *
 * CAVEAT THAT MATTERS (measured 2026-08-24): degree is computed from OUR graph,
 * so it measures how much we have scraped about a fund, not how connected that
 * fund really is. Lightspeed shows degree 580 because its portfolio page parsed
 * cleanly; GIC and Temasek show degree 3 because they arrived from three seed
 * CSV rows and have no scraped portfolio at all — despite being two of the
 * largest investors in the world.
 *
 * Consequence: a fund with FEW edges may be under-discounted, i.e. flattered.
 * `coverage` below distinguishes a genuinely narrow fund from one we simply
 * have not scraped, so the UI can say which it is rather than implying a
 * precision the data does not support.
 */
export function degreeDiscount(degree: number): number {
  if (degree <= 1) return 1;
  return 1 / Math.log2(degree + 1);
}

/**
 * Is this fund's degree trustworthy? A fund we have never scraped has a degree
 * derived from incidental mentions, and its discount is therefore meaningless.
 */
export function degreeCoverage(scrapedEdges: number, totalEdges: number): 'scraped' | 'incidental' {
  return scrapedEdges >= Math.max(5, totalEdges * 0.5) ? 'scraped' : 'incidental';
}

export async function findWarmPaths(companyId: number): Promise<WarmPath[]> {
  const q = getSql();
  const paths: WarmPath[] = [];

  // ── 1. PERSON-MEDIATED: someone here also sits at a company with an SG link.
  // Strongest available from public data — a named human on both sides.
  const personRows = await q`
    select p.id as person_id, p.name as person_name,
           r2.company_id as other_company_id, c2.name as other_company_name,
           r1.role as role_here, r2.role as role_there,
           r1.source_url as source_here, r2.source_url as source_there,
           r2.last_seen as last_seen_there,
           (select count(*)::int from roles rx where rx.person_id = p.id) as person_degree,
           exists(select 1 from sg_links s where s.subject_type='company' and s.subject_id = r2.company_id) as other_has_sg
    from roles r1
    join people p on p.id = r1.person_id
    join roles r2 on r2.person_id = p.id and r2.company_id <> r1.company_id
    join companies c2 on c2.id = r2.company_id
    where r1.company_id = ${companyId}`;

  for (const r of personRows) {
    const degree = Number(r.person_degree) || 1;
    // A person on 20 boards is a professional director, not a connection.
    const base = r.other_has_sg ? 1.0 : 0.55;
    const score = base * degreeDiscount(degree) * 1.4; // person-mediated boost
    paths.push({
      kind: 'person_role',
      description: `Possible path: ${r.person_name} is ${r.role_here} here and also ${r.role_there} at ${r.other_company_name}${r.other_has_sg ? ', which has a Singapore link' : ''}.`,
      viaPersonId: Number(r.person_id), viaPersonName: String(r.person_name),
      viaOrgId: null, viaOrgName: null,
      targetCompanyId: Number(r.other_company_id), targetCompanyName: String(r.other_company_name),
      evidence: `Both roles are filed records${r.last_seen_there ? `; last seen ${r.last_seen_there}` : ''}.`,
      sourceUrl: (r.source_there ?? r.source_here) as string | null,
      score, degree, reviewStatus: 'unreviewed',
    });
  }

  // ── 2. FUND-MEDIATED: a shared investor. Weakest of the useful signals, and
  // the one that MUST be degree-discounted or it swamps everything.
  const fundRows = await q`
    select o.id as org_id, o.name as org_name, o.sg_presence,
           i2.company_id as other_company_id, c2.name as other_company_name,
           i1.source_url as source_url,
           (select count(*)::int from investments ix where ix.org_id = o.id) as org_degree,
           (select count(*)::int from investments ix where ix.org_id = o.id and ix.source = 'portfolio_page') as org_scraped_degree,
           exists(select 1 from sg_links s where s.subject_type='company' and s.subject_id = i2.company_id) as other_has_sg
    from investments i1
    join organizations o on o.id = i1.org_id
    join investments i2 on i2.org_id = o.id and i2.company_id <> i1.company_id
    join companies c2 on c2.id = i2.company_id
    where i1.company_id = ${companyId}
      and (c2.account_status = 'account' or o.sg_presence = true
           or exists(select 1 from sg_links s where s.subject_type='company' and s.subject_id = i2.company_id))
    limit 400`;

  const seenOrg = new Set<string>();
  for (const r of fundRows) {
    const degree = Number(r.org_degree) || 1;
    const scraped = Number(r.org_scraped_degree) || 0;
    const coverage = degreeCoverage(scraped, degree);
    const key = `${r.org_id}:${r.other_company_id}`;
    if (seenOrg.has(key)) continue;
    seenOrg.add(key);
    const base = r.sg_presence ? 0.8 : r.other_has_sg ? 0.6 : 0.35;
    // With 'incidental' coverage the degree is not a real measure of the fund's
    // breadth, so applying the full discount would be false precision. Damp it
    // toward neutral instead of pretending the number means something.
    const discount = coverage === 'scraped'
      ? degreeDiscount(degree)
      : Math.min(degreeDiscount(degree), 0.5);
    const score = base * discount; // no person boost
    paths.push({
      kind: 'fund_portfolio',
      description: `Possible path: ${r.org_name} backs this company and also ${r.other_company_name}${r.sg_presence ? ' (Singapore-linked fund)' : ''}.`,
      viaPersonId: null, viaPersonName: null,
      viaOrgId: Number(r.org_id), viaOrgName: String(r.org_name),
      targetCompanyId: Number(r.other_company_id), targetCompanyName: String(r.other_company_name),
      evidence: coverage === 'scraped'
        ? `Shared investor. ${r.org_name} appears on ${degree} investment edges in this graph${degree > 50 ? ' — a hub node, so this is weak evidence' : ''}.`
        : `Shared investor. We have not scraped ${r.org_name}'s portfolio, so its ${degree} edge${degree === 1 ? '' : 's'} here understate its real breadth — treat the ranking as provisional.`,
      sourceUrl: r.source_url as string | null,
      score, degree, coverage, reviewStatus: 'unreviewed',
    });
  }

  // ── 3. COMPANY-TO-COMPANY edges reaching a known account.
  const edgeRows = await q`
    select ce.relation, ce.source_url, ce.directed,
           case when ce.from_company_id = ${companyId} then ce.to_company_id else ce.from_company_id end as other_id,
           case when ce.from_company_id = ${companyId} then c2.name else c1.name end as other_name,
           case when ce.from_company_id = ${companyId} then c2.account_status else c1.account_status end as other_status
    from company_edges ce
    join companies c1 on c1.id = ce.from_company_id
    join companies c2 on c2.id = ce.to_company_id
    where ce.from_company_id = ${companyId} or ce.to_company_id = ${companyId}`;

  for (const r of edgeRows) {
    paths.push({
      kind: 'company_edge',
      description: `Possible path: ${r.relation.replace(/_/g, ' ')} relationship with ${r.other_name}${r.other_status === 'account' ? ', an existing EDB account' : ''}.`,
      viaPersonId: null, viaPersonName: null, viaOrgId: null, viaOrgName: null,
      targetCompanyId: Number(r.other_id), targetCompanyName: String(r.other_name),
      evidence: `Company relationship: ${r.relation}.`,
      sourceUrl: r.source_url as string | null,
      score: r.other_status === 'account' ? 0.9 : 0.5,
      degree: null, reviewStatus: 'unreviewed',
    });
  }

  // ── 4. EVENTS: a named person in a known place on a known date.
  const eventRows = await q`
    select e.name as event_name, e.starts_on, e.city, e.url,
           p.id as person_id, p.name as person_name, ep.participation
    from event_participants ep
    join events e on e.id = ep.event_id
    left join people p on p.id = ep.person_id
    where ep.company_id = ${companyId} and (e.starts_on is null or e.starts_on >= current_date)`;

  for (const r of eventRows) {
    paths.push({
      kind: 'event',
      description: `Possible path: ${r.person_name ?? 'someone from this company'} is ${r.participation} at ${r.event_name}${r.city ? ` in ${r.city}` : ''}${r.starts_on ? ` on ${r.starts_on}` : ''}.`,
      viaPersonId: r.person_id ? Number(r.person_id) : null,
      viaPersonName: (r.person_name as string) ?? null,
      viaOrgId: null, viaOrgName: null,
      targetCompanyId: null, targetCompanyName: null,
      evidence: 'Public event listing.',
      sourceUrl: r.url as string | null,
      score: 0.75,
      degree: null, reviewStatus: 'unreviewed',
    });
  }

  // Attach any existing human review. An unreviewed path stays an association.
  const reviews = await q`
    select path_kind, via_person_id, via_org_id, status, internal_owner, do_not_use
    from path_reviews where company_id = ${companyId}`;
  for (const p of paths) {
    const rv = reviews.find((r) =>
      r.path_kind === p.kind &&
      (r.via_person_id ?? null) === p.viaPersonId &&
      (r.via_org_id ?? null) === p.viaOrgId);
    if (rv) {
      p.reviewStatus = String(rv.status);
      if (rv.do_not_use) p.score = -1;                      // conflict flag wins
      else if (rv.status === 'usable') p.score += 1.0;
      else if (rv.status === 'not_usable') p.score = -1;
    }
  }

  return paths
    .filter((p) => p.score >= 0)
    .sort((a, b) => b.score - a.score);
}
