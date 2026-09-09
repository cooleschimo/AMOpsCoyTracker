/**
 * /company/[id] — the connection view. Brief §8, step 7's UI half.
 *
 * §8 calls this "the feature that differentiates the tool": news is a commodity,
 * warm paths are not.
 *
 * THE HONESTY RULES THIS PAGE ENFORCES (§8, §9, RATIONALE §9):
 *  - A path is a POSSIBLE path until a human reviews it. Nothing here says
 *    "warm introduction" about an unreviewed association.
 *  - Every edge shows its source and date. §15: "graph edges without source_url
 *    are worthless — an RD needs to check before acting."
 *  - Valuation and funding figures carry their source and a staleness caveat.
 *  - A Singapore registration is NOT operational presence: match status, entity
 *    status and incorporation date travel together.
 *  - Form D "amount sold" is never shown as total raised; the security type
 *    travels with it.
 */
import { getSql } from '../../../lib/db';
import { InvestorChip } from '../../../components/investor-chip';
import { SectionHeading } from '@/components/primitives';
import { sectorLabel } from '../../../lib/subsectors';
import { hasDashboard } from '../../../lib/auth';
import { findWarmPaths } from '../../../lib/paths';
import { PathReview } from '../../../components/path-review';
import { PATH_REVIEW_STATUSES, type PathReviewStatus } from '../../../lib/ui-types';

export const dynamic = 'force-dynamic';

/** What each path kind means, in place of the sentence repeated on every row. */
const PATH_KIND_LABEL: Record<string, string> = {
  person_role: 'Same person, both companies',
  fund_portfolio: 'Shared investor',
  company_edge: 'Company-to-company link',
  event: 'Both at the same event',
};

/* The page's repeated shapes, as class strings rather than style objects, so
   an accent change in globals.css reaches this page like it reaches the
   dashboard. Kept as constants for the same reason the style objects were:
   the card and meta lines recur a dozen times each. */
const CARD = 'rounded-md border border-border bg-card px-3.5 py-3 mb-2';
const BODY = 'text-sm leading-relaxed mb-2 last:mb-0';
const META = 'mt-1 text-2xs text-muted-foreground';
const LINK = 'text-primary link-underline hover:text-foreground';
const CAVEAT =
  'mb-3.5 rounded-md border border-caution/30 bg-caution-soft/60 px-3 py-2.5 text-2xs text-caution';
const MAIN = 'mx-auto max-w-[860px] px-5 py-7 pb-15 sm:px-8 sm:py-10';

/** Section headings run at the page's rhythm rather than the dashboard's grid. */
function Heading({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="mt-7 mb-2.5 first:mt-0">
      <SectionHeading title={title} right={right} />
    </div>
  );
}

/** The posting tiles, in one shape for both the APAC list and the folded rest. */
function PostingGrid({ postings }: { postings: any[] }) {
  return (
    <div className="mt-2 grid items-start gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,210px),1fr))]">
      {postings.map((j: any, i: number) => (
        <a
          key={i}
          href={j.url}
          target="_blank"
          rel="noreferrer"
          className={
            j.is_apac
              ? 'block rounded-md border border-primary/30 bg-primary/[0.06] px-2.5 py-2 no-underline transition-colors hover:border-primary'
              : 'block rounded-md border border-border bg-card px-2.5 py-2 no-underline transition-colors hover:border-primary/40'
          }
        >
          <span
            className={
              j.is_apac
                ? 'block text-[9px] font-semibold uppercase tracking-[0.1em] text-confirmed'
                : 'block text-[9px] uppercase tracking-[0.1em] text-muted-foreground'
            }
          >
            {j.is_apac ? 'APAC' : 'Non-US'}
          </span>
          <span className="mt-0.5 block text-sm leading-snug text-foreground">{j.title}</span>
          {j.location ? (
            <span className="mt-0.5 block text-2xs leading-snug text-muted-foreground">{j.location}</span>
          ) : null}
        </a>
      ))}
    </div>
  );
}

const band = (v: string | null) => v ?? 'unassessed';

/** A date column comes back as a Date; only the day matters here. */
const day = (v: unknown) => {
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};


const H1 = 'font-display text-3xl font-semibold tracking-tight';

export default async function CompanyPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> },
) {
  const { id } = await params;
  const sp = await searchParams;
  if (!(await hasDashboard(sp.token))) {
    return <main className={MAIN}><h1 className={H1}>Not authorised</h1>
      <p className={BODY}>Append <code>?token=…</code> with your DASHBOARD_TOKEN.</p></main>;
  }

  const companyId = Number(id);
  if (!Number.isFinite(companyId)) {
    return <main className={MAIN}><h1 className={H1}>Not found</h1></main>;
  }

  const sql = getSql();
  const [co]: any = await sql`select * from companies where id = ${companyId}`;
  if (!co) return <main className={MAIN}><h1 className={H1}>Not found</h1></main>;
  const [people, investors, filings, sgLinks, assessment, recentItems, jobs, postings] = await Promise.all([
    sql`select p.id, p.name, r.role, r.role_raw, r.source, r.source_url, r.first_seen, r.last_seen
        from roles r join people p on p.id = r.person_id
        where r.company_id = ${companyId} order by r.last_seen desc nulls last, p.name`,
    // One row per investor, not per round: an investor in three rounds appeared
    // three times, which is why the list read as far longer than it is.
    sql`select o.id, o.name,
               bool_or(i.is_lead) as is_lead,
               count(*)::int as rounds,
               max(i.announced_date) as announced_date,
               -- Every round this investor took part in, newest first, so the
               -- hover can name them rather than just counting.
               -- 'portfolio' means the edge came from a portfolio page with no
               -- round attached, and 'Other Investors' is a CB Insights column
               -- header rather than a round. Neither is something to show.
               array_agg(distinct i.round) filter (
                 where i.round is not null
                   and i.round not in ('portfolio', 'Other Investors')
               ) as round_names,
               min(i.source) as source,
               min(i.source_url) as source_url
        from investments i join organizations o on o.id = i.org_id
        where i.company_id = ${companyId}
        group by o.id, o.name
        order by bool_or(i.is_lead) desc, o.name`,
    sql`select form_type, filed_at, amount, security_type, url
        from sec_filings where company_id = ${companyId} order by filed_at desc`,
    sql`select link_type, match_status, detail, source_url, found_at
        from sg_links where subject_type = 'company' and subject_id = ${companyId} order by found_at desc`,
    sql`select * from company_assessments where company_id = ${companyId}
        order by assessed_at desc limit 1`,
    // One row per item, carrying its most recent score. Joining scores plainly
    // returned the same article once per rubric version — versioned scores exist
    // so a change can be compared, not so an item appears five times.
    sql`select i.id, i.title, i.source, i.published_at, s.score, s.signal_type, s.why
        from items i
        join lateral (
          select score, signal_type, why from scores sc
          where sc.item_id = i.id
          order by sc.scored_at desc nulls last, sc.id desc
          limit 1
        ) s on true
        where i.company_id = ${companyId} and i.status = 'kept'
        order by s.score desc, i.published_at desc nulls last limit 8`,
    sql`select total_jobs, non_us_jobs, apac_jobs, snapshot_at
        from job_snapshots where company_id = ${companyId} order by snapshot_at desc limit 2`,
    // The postings themselves, so a hiring claim can be checked against the
    // roles behind it (§5.5). APAC first, then the rest of the non-US roles:
    // those are the ones that bear on a siting decision, and a company can
    // carry two thousand US postings that say nothing about one.
    sql`select title, location, url, is_apac, is_non_us, posted_at
        from job_postings
        where company_id = ${companyId} and (is_apac or is_non_us)
        order by is_apac desc, posted_at desc nulls last, title
        -- High enough that no company in the data is truncated: the worst case
        -- is 374 non-US roles, and the US postings a company can carry in the
        -- thousands are already excluded by the filter above.
        limit 400`,
  ]);

  // The APAC roles carry the placement signal; the rest of the non-US roles
  // are context, and the query has already sorted the APAC ones to the front.
  const apacPostings = postings.filter((j: any) => j.is_apac);
  const restPostings = postings.filter((j: any) => !j.is_apac);

  const rawPaths = await findWarmPaths(companyId, { includeRejected: true });

  /**
   * One row per connector, not per connector-and-destination.
   *
   * A shared investor that also backs four other Singapore-linked companies
   * produced four rows, so the same name repeated down the table and the count
   * read as far larger than the number of routes actually available. The routes
   * are the same person or fund either way — what differs is where each leads.
   */
  const paths = Object.values(
    rawPaths.reduce<
      Record<string, (typeof rawPaths)[number] & { targets: { id: number; name: string }[] }>
    >(
      (acc, p) => {
        const key = p.viaPersonId ? `p${p.viaPersonId}` : p.viaOrgId ? `o${p.viaOrgId}` : `k${p.description}`;
        const target =
          p.targetCompanyName && p.targetCompanyId
            ? { id: p.targetCompanyId, name: p.targetCompanyName }
            : null;
        if (!acc[key]) acc[key] = { ...p, targets: target ? [target] : [] };
        else if (target && !acc[key]!.targets.some((t) => t.id === target.id))
          acc[key]!.targets.push(target);
        return acc;
      },
      {},
    ),
  );
  const a: any = assessment[0];

  return (
    <main className={MAIN}>
      <h1 className={H1}>{co.name}</h1>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        {(co.sectors ?? []).map((s: string) => (
          <span
            key={s}
            className="mr-1.5 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-2xs text-primary"
          >
            {sectorLabel(s)}
          </span>
        ))}
        {co.hq_city ? `${co.hq_city}, ` : ''}{co.hq_state ?? co.hq_region ?? ''}
        {co.website ? <> · <a href={co.website} className={LINK}>{co.website.replace(/^https?:\/\//, '')}</a></> : null}
      </p>

      {/* ---- Assessment (§7a) ---- */}
      {a ? (
        <>
          <Heading title="Assessment" />
          <div className={CARD}>
            <p className={BODY}>
              Target priority <b>{band(a.target_priority)}</b> · Singapore fit <b>{band(a.singapore_fit)}</b> ·
              {' '}Potential contribution <b>{band(a.potential_contribution)}</b>
            </p>
            {a.rationale ? <p className={BODY}>{a.rationale}</p> : null}
            <p className={META}>
              {band(a.confidence)} confidence · {a.rubric_version} · {a.model} ·
              {' '}assessed {new Date(a.assessed_at).toISOString().slice(0, 10)}
            </p>
          </div>
          {/* No instruction to correct it: nothing on this page can, and telling
              a reader to do something the tool does not offer is worse than
              leaving the caveat to stand on its own. */}
          <p className={CAVEAT}>
            A judgment on public information, refreshed monthly. It will be wrong where relevance
            depends on context the tool cannot see.
          </p>
        </>
      ) : null}

      {/* ---- Warm paths — the differentiating feature ---- */}
      <Heading title={`People (${people.length})`} />
      {people.length === 0 ? <p className={BODY}>None recorded.</p> : people.map((p: any) => (
        <div key={`${p.id}-${p.role}`} className={CARD}>
          <p className={BODY}>
            <b><a href={`/person/${p.id}?token=${sp.token ?? ''}`} className={LINK}>{p.name}</a></b>
            {' — '}{p.role_raw ?? p.role}
          </p>
          <p className={META}>
            {p.source}
            {p.first_seen ? ` · in our data since ${day(p.first_seen)}` : ''}
            {p.last_seen ? ` · last confirmed ${day(p.last_seen)}` : ''}
            {p.source_url ? <> · <a href={p.source_url} className={LINK}>source</a></> : ''}
          </p>
        </div>
      ))}

      {/* ---- Investors ---- */}
      <Heading title={`Possible paths (${paths.length})`} />
      {paths.length === 0 ? (
        <p className={BODY}>No path found in the graph. That means no public edge was scraped, not that none exists.</p>
      ) : (
        <>
          <p className={META}>
            Connections found in public data — associations, not introductions. Mark one
            usable when somebody can actually make it; that judgment ranks it up here and
            is what the next person to open this page will see.
          </p>
          {/* A ranked list separated by hairlines, not a stack of bordered
              cards: twelve boxes down a page reads as twelve things competing,
              where a list reads as one thing in order. */}
          {/* A table, not stacked rows. Every path is the same three facts, so
              they belong in columns that line up down the page — a flex row let
              each one find its own width and nothing aligned. */}
          {/* The table sets its own widths, so it scrolls inside its box on a
              narrow screen rather than forcing the page sideways. */}
          <div className="overflow-x-auto">
            <table className="path-table mt-2 w-full table-fixed border-collapse">
              <thead>
                <tr>
                  <th className="w-[26%] hairline-b pb-1.5 pr-2.5 text-left text-2xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Through</th>
                  <th className="w-[40%] hairline-b pb-1.5 pr-2.5 text-left text-2xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Connects to</th>
                  <th className="w-[20%] hairline-b pb-1.5 pr-2.5 text-left text-2xs font-medium uppercase tracking-[0.1em] text-muted-foreground">How</th>
                  <th className="w-[14%] hairline-b pb-1.5 pr-2.5 text-left text-2xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Can we use it</th>
                </tr>
              </thead>
              <tbody>
                {/* A path somebody ruled out stays listed so the ruling can be
                    changed, but greyed, so it does not read as a live route. */}
                {paths.slice(0, 12).map((p, i) => (
                  <tr key={i} className={p.reviewStatus === 'not_usable' || p.doNotUse ? 'opacity-45' : undefined}>
                    <td className="hairline-t py-2 pr-2.5 align-top text-sm font-semibold [overflow-wrap:anywhere]">
                      {p.viaPersonName ?? p.viaOrgName ?? '—'}
                    </td>
                    <td className="hairline-t py-2 pr-2.5 align-top text-sm [overflow-wrap:anywhere]">
                      {p.targets.length === 0
                        ? '—'
                        : p.targets.map((t, n) => (
                            <span key={t.id}>
                              {n > 0 ? ', ' : ''}
                              <a href={`/company/${t.id}?token=${sp.token ?? ''}`} className={LINK}>
                                {t.name}
                              </a>
                            </span>
                          ))}
                    </td>
                    <td className="hairline-t py-2 pr-2.5 align-top text-sm text-muted-foreground [overflow-wrap:anywhere]" title={p.evidence}>
                      {PATH_KIND_LABEL[p.kind] ?? p.kind.replace(/_/g, ' ')}
                      {p.sourceUrl ? (
                        <>
                          {' · '}
                          <a href={p.sourceUrl} className={LINK}>
                            source
                          </a>
                        </>
                      ) : null}
                    </td>
                    <td className="hairline-t py-2 pr-2.5 align-top text-sm [overflow-wrap:anywhere]">
                      <PathReview
                        companyId={companyId}
                        pathKind={p.kind}
                        viaPersonId={p.viaPersonId}
                        viaOrgId={p.viaOrgId}
                        status={(PATH_REVIEW_STATUSES as readonly string[]).includes(p.reviewStatus)
                          ? (p.reviewStatus as PathReviewStatus)
                          : 'unreviewed'}
                        internalOwner={p.internalOwner}
                        doNotUse={p.doNotUse}
                        routes={p.targets.length}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---- Singapore ---- */}
      <Heading title="Singapore" />
      {sgLinks.length === 0 ? (
        <p className={BODY}>No Singapore link found.</p>
      ) : sgLinks.map((l: any, i: number) => (
        <div key={i} className={CARD}>
          <p className={BODY}>
            {l.link_type.replace(/_/g, ' ')} — <b>{l.match_status ?? 'unknown'} match</b>
          </p>
          <p className={META}>{l.detail}</p>
          {l.match_status !== 'confirmed' ? (
            <p className={META}>
              A registration is not operational presence, and a probable match may be a
              different company with a similar name. Verify against ACRA before relying on it.
            </p>
          ) : null}
          {l.source_url ? <p className={META}><a href={l.source_url} className={LINK}>source</a></p> : null}
        </div>
      ))}

      {/* ---- People ---- */}
      <Heading title={`Investors (${investors.length})`} />
      {investors.length === 0 ? (
        <p className={BODY}>None recorded.</p>
      ) : (
        <>
          {/* Chips, not cards. A company can carry two hundred investors, and a
              bordered block each turns a reference list into a wall. Leads come
              first and are marked; the rest are names you scan for one you
              recognise. */}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {investors.map((v: any, i: number) => (
              <InvestorChip
                key={i}
                href={`/org/${v.id}?token=${sp.token ?? ''}`}
                name={v.name}
                isLead={Boolean(v.is_lead)}
                rounds={v.round_names ?? []}
                latestDate={
                  v.announced_date ? new Date(v.announced_date).toISOString().slice(0, 10) : null
                }
                source={v.source ?? null}
                sourceUrl={v.source_url ?? null}
                latestRoundAmount={
                  co.round_amount_musd
                    ? co.round_amount_musd >= 1000
                      ? `$${(co.round_amount_musd / 1000).toFixed(1)}B`
                      : `$${co.round_amount_musd}M`
                    : null
                }
                latestRoundName={
                  (v.round_names ?? []).find(
                    (r: string) =>
                      r.toLowerCase().replace(/[^a-z]/g, '') ===
                      String(co.round_stage ?? '').toLowerCase().replace(/[^a-z]/g, ''),
                  ) ?? null
                }
              />
            ))}
          </div>

        </>
      )}

      {/* ---- Filings. NEVER presented as total raised (§5.1). ---- */}
      {filings.length ? (
        <>
          <Heading title="SEC filings" />
          <p className={CAVEAT}>
            Amounts are <b>as filed on a single Form D</b>, not cumulative venture funding. A
            Form D can cover debt, pooled funds or multi-issuer structures, and issuers
            sometimes file partially or not at all.
          </p>
          {filings.map((f: any, i: number) => (
            <div key={i} className={CARD}>
              <p className={BODY}>
                {f.form_type} · {f.filed_at}
                {f.amount ? ` · $${Number(f.amount).toLocaleString()} sold` : ''}
                {f.security_type ? ` · ${f.security_type}` : ''}
              </p>
              {f.url ? <p className={META}><a href={f.url} className={LINK}>filing</a></p> : null}
            </div>
          ))}
        </>
      ) : null}

      {/* ---- Hiring ---- */}
      {jobs.length ? (
        <>
          <Heading title="Hiring" />
          <p className={BODY}>
            <b className="num">{jobs[0].total_jobs}</b> open roles · <b className="num">{jobs[0].non_us_jobs}</b> outside the US ·{' '}
            <b className="num">{jobs[0].apac_jobs}</b> in APAC
          </p>
          <p className={META}>
            snapshot {new Date(jobs[0].snapshot_at).toISOString().slice(0, 10)}
            {jobs[1]
              ? ` · previous week ${jobs[1].total_jobs} total, ${jobs[1].apac_jobs} APAC`
              : ' · no prior week yet, so week-over-week growth cannot be computed'}
          </p>

          {postings.length > 0 && (
            <>
              {/* The roles behind the count, so the claim is checkable. US
                  postings are excluded: a company can carry two thousand of
                  them and none bears on where it puts something next. The
                  APAC roles are the ones that bear on placement, so they read
                  in the open and the rest of the non-US roles fold away. */}
              {apacPostings.length ? <PostingGrid postings={apacPostings} /> : null}
              {restPostings.length ? (
                <details className="mt-2">
                  <summary className={`${META} cursor-pointer`}>
                    {restPostings.length} other non-US {restPostings.length === 1 ? 'role' : 'roles'}
                  </summary>
                  <PostingGrid postings={restPostings} />
                </details>
              ) : null}
              <p className={META}>Non-US and APAC roles only.</p>
            </>
          )}
        </>
      ) : null}

      {/* ---- Recent signals ---- */}
      {recentItems.length ? (
        <>
          <Heading title="Recent signals" />
          {recentItems.map((it: any) => (
            <div key={it.id} className={CARD}>
              <p className={BODY}>
                <a href={`/item/${it.id}`} className={LINK}>{it.title}</a>
              </p>
              <p className={META}>
                score <span className="num">{it.score}</span> · {it.signal_type} · {it.source}
                {it.published_at ? ` · ${new Date(it.published_at).toISOString().slice(0, 10)}` : ''}
              </p>
              <p className={META}>{it.why}</p>
            </div>
          ))}
        </>
      ) : null}
    </main>
  );
}
