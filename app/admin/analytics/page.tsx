/**
 * /admin/analytics — what the pipeline is actually finding, and from where.
 *
 * The question this exists to answer is which sources are worth keeping. When
 * VentureBeat went behind a bot guard the honest answer to "does that matter"
 * was a guess, because `discovered_via` records the CHANNEL — news, portfolio,
 * form_d — and 'news' is ninety-six feeds.
 *
 * Two kinds of number here, and they are labelled rather than mixed:
 *
 *   recorded — companies.discovered_item_id, written since 2026-09-23. Exact:
 *              the article that named the company.
 *   inferred — for everything before that, the sources whose items arrived
 *              within a day of the company appearing. A company named by one
 *              source and mentioned by four others credits all five, so it
 *              ranks sources rather than attributing them.
 *
 * Nothing is computed on the fly that a stage already wrote down: the weekly
 * intake reads companies.created_at and the constants read company_signals,
 * both of which are the pipeline's own record of what it did.
 */
import { getSql } from '../../../lib/db';
import { hasAdmin } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

const MAIN = 'mx-auto max-w-[940px] px-5 pb-16 pt-7';
const H1 = 'font-display text-2xl font-semibold tracking-tight';
const SUB = 'mb-5 text-sm text-muted-foreground';
const H2 = 'mb-2.5 mt-8 text-xs font-bold uppercase tracking-[0.08em] text-primary';
const NOTE = 'mb-3 text-xs text-muted-foreground';
const TABLE = 'w-full border-collapse text-sm';
const TH = 'border-b border-border py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const TD = 'border-b border-border/50 py-1.5 align-top';
const NUM = `${TD} text-right tabular-nums`;

/** A bar that reads as a proportion without needing a chart library. */
function Bar({ n, max }: { n: number; max: number }) {
  const pct = max > 0 ? Math.round((n / max) * 100) : 0;
  return (
    <span className="inline-block h-1.5 rounded-sm bg-primary/70 align-middle"
      style={{ width: `${Math.max(pct, 2)}%` }} />
  );
}

export default async function AnalyticsPage(
  { searchParams }: { searchParams: Promise<{ token?: string }> },
) {
  const sp = await searchParams;
  if (!(await hasAdmin(sp.token))) {
    return <main className={MAIN}><h1 className={H1}>Not authorised</h1>
      <p className={SUB}>Append <code>?token=…</code> with your ADMIN_TOKEN.</p></main>;
  }

  const sql = getSql();
  const [intake, channels, recorded, inferred, constants, newThisWeek, sigSources, health] =
    await Promise.all([
      // Companies first seen each week, and how many of them news found.
      sql`select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week,
                 count(*)::int as total,
                 count(*) filter (where discovered_via = 'news')::int as news,
                 count(*) filter (where discovered_via = 'portfolio')::int as portfolio,
                 count(*) filter (where discovered_via = 'form_d')::int as form_d
          from companies
          where created_at > now() - interval '12 weeks'
          group by 1 order by 1 desc`,
      sql`select coalesce(discovered_via, 'unrecorded') as via, count(*)::int as c
          from companies group by 1 order by c desc`,
      // Exact attribution. Empty until discover-news has run since the column
      // was added, which is the honest state rather than a blank section.
      sql`select i.source, count(*)::int as companies
          from companies c join items i on i.id = c.discovered_item_id
          group by 1 order by companies desc limit 25`,
      // Inferred: sources present when a news-discovered company appeared.
      sql`select i.source, count(distinct c.id)::int as companies
          from companies c
          join items i on i.company_id = c.id
          where c.discovered_via = 'news'
            and c.discovered_item_id is null
            and i.fetched_at between c.created_at - interval '24 hours'
                                 and c.created_at + interval '2 hours'
          group by 1 order by companies desc limit 25`,
      // The regulars: companies carrying a signal in the most distinct weeks.
      sql`select c.name, count(distinct cs.week_of)::int as weeks,
                 max(cs.week_of) as latest
          from company_signals cs join companies c on c.id = cs.company_id
          group by c.name order by weeks desc, latest desc limit 25`,
      // Companies whose first-ever signal is this week — genuinely new to the
      // dashboard rather than merely new to the table.
      sql`select c.name, f.first_week
          from (select company_id, min(week_of) as first_week
                from company_signals group by company_id) f
          join companies c on c.id = f.company_id
          where f.first_week >= date_trunc('week', now())::date - 7
          order by f.first_week desc, c.name limit 25`,
      // Which sources the week's signals actually cite.
      sql`select i.source, count(distinct cs.company_id)::int as companies
          from company_signals cs
          join items i on i.id = cs.representative_item_id
          where cs.week_of > current_date - 60
          group by 1 order by companies desc limit 25`,
      sql`select source, status, last_count, note from source_health
          where status <> 'ok' order by status, source limit 40`,
    ]) as any;

  const maxIntake = Math.max(1, ...intake.map((r: any) => r.total));
  const attribution = recorded.length ? recorded : inferred;
  const maxAttr = Math.max(1, ...attribution.map((r: any) => r.companies));
  const maxConst = Math.max(1, ...constants.map((r: any) => r.weeks));
  const maxSig = Math.max(1, ...sigSources.map((r: any) => r.companies));

  return (
    <main className={MAIN}>
      <h1 className={H1}>Analytics</h1>
      <p className={SUB}>
        What the pipeline found, and which sources found it. Everything here is
        read from what the stages recorded; nothing is recomputed.
      </p>

      <h2 className={H2}>New companies per week</h2>
      <p className={NOTE}>
        First time each company entered the table, by the channel that found it.
      </p>
      <table className={TABLE}>
        <thead><tr>
          <th className={TH}>Week</th><th className={`${TH} text-right`}>Total</th>
          <th className={`${TH} text-right`}>News</th><th className={`${TH} text-right`}>Portfolio</th>
          <th className={`${TH} text-right`}>Form D</th><th className={TH}> </th>
        </tr></thead>
        <tbody>
          {intake.map((r: any) => (
            <tr key={r.week}>
              <td className={TD}>{r.week}</td>
              <td className={NUM}>{r.total}</td>
              <td className={NUM}>{r.news}</td>
              <td className={NUM}>{r.portfolio}</td>
              <td className={NUM}>{r.form_d}</td>
              <td className={`${TD} w-[30%]`}><Bar n={r.total} max={maxIntake} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={H2}>Sources that find companies</h2>
      <p className={NOTE}>
        {recorded.length
          ? 'Recorded: the article that named the company, from discovered_item_id.'
          : 'Inferred — the exact link is recorded from 2026-09-23 onward, and this '
            + 'section switches to it once discovery has run. Until then these are the '
            + 'sources whose items arrived within a day of the company appearing, so a '
            + 'company named by one source and mentioned by four credits all five. '
            + 'Read it as a ranking, not an attribution.'}
      </p>
      <table className={TABLE}>
        <thead><tr>
          <th className={TH}>Source</th><th className={`${TH} text-right`}>Companies</th><th className={TH}> </th>
        </tr></thead>
        <tbody>
          {attribution.map((r: any) => (
            <tr key={r.source}>
              <td className={TD}>{r.source}</td>
              <td className={NUM}>{r.companies}</td>
              <td className={`${TD} w-[40%]`}><Bar n={r.companies} max={maxAttr} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={H2}>New to the dashboard this week</h2>
      <p className={NOTE}>
        Companies whose first signal in any week is this one — new to the digest,
        not merely new to the table.
      </p>
      {newThisWeek.length ? (
        <table className={TABLE}>
          <thead><tr><th className={TH}>Company</th><th className={TH}>First week</th></tr></thead>
          <tbody>
            {newThisWeek.map((r: any) => (
              <tr key={r.name}>
                <td className={TD}>{r.name}</td>
                <td className={TD}>{String(r.first_week).slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className={NOTE}>No company reached the dashboard for the first time this week.</p>}

      <h2 className={H2}>Dashboard constants</h2>
      <p className={NOTE}>
        Companies by how many distinct weeks they have carried a signal. A high
        count is either a genuinely active company or a name the filter is too
        generous with.
      </p>
      <table className={TABLE}>
        <thead><tr>
          <th className={TH}>Company</th><th className={`${TH} text-right`}>Weeks</th>
          <th className={TH}>Latest</th><th className={TH}> </th>
        </tr></thead>
        <tbody>
          {constants.map((r: any) => (
            <tr key={r.name}>
              <td className={TD}>{r.name}</td>
              <td className={NUM}>{r.weeks}</td>
              <td className={TD}>{String(r.latest).slice(0, 10)}</td>
              <td className={`${TD} w-[25%]`}><Bar n={r.weeks} max={maxConst} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={H2}>Sources behind the last 60 days of signals</h2>
      <p className={NOTE}>
        The publication each signal cites as its representative item. This is
        what a source is worth once the filter has had its say.
      </p>
      <table className={TABLE}>
        <thead><tr>
          <th className={TH}>Source</th><th className={`${TH} text-right`}>Companies</th><th className={TH}> </th>
        </tr></thead>
        <tbody>
          {sigSources.map((r: any) => (
            <tr key={r.source}>
              <td className={TD}>{r.source}</td>
              <td className={NUM}>{r.companies}</td>
              <td className={`${TD} w-[40%]`}><Bar n={r.companies} max={maxSig} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={H2}>Sources not answering</h2>
      <p className={NOTE}>
        `blocked` is a bot guard — a challenge page no fetcher can pass, so it
        is disabled rather than retried. `down` could not be reached at all.
        `zero_volume` answered and parsed to nothing, which is a selector.
      </p>
      {health.length ? (
        <table className={TABLE}>
          <thead><tr>
            <th className={TH}>Source</th><th className={TH}>Status</th>
            <th className={`${TH} text-right`}>Last count</th><th className={TH}>Note</th>
          </tr></thead>
          <tbody>
            {health.map((r: any) => (
              <tr key={r.source}>
                <td className={TD}>{r.source}</td>
                <td className={TD}>{r.status}</td>
                <td className={NUM}>{r.last_count ?? '—'}</td>
                <td className={`${TD} text-xs text-muted-foreground`}>{String(r.note ?? '').slice(0, 70)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className={NOTE}>Every source answered.</p>}

      <h2 className={H2}>How companies entered the table</h2>
      <table className={TABLE}>
        <thead><tr><th className={TH}>Channel</th><th className={`${TH} text-right`}>Companies</th></tr></thead>
        <tbody>
          {channels.map((r: any) => (
            <tr key={r.via}>
              <td className={TD}>{r.via}</td>
              <td className={NUM}>{r.c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
