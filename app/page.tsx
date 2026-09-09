/**
 * The weekly dashboard. Brief §11.
 *
 * A server component reading Neon directly, so the page arrives complete rather
 * than fetching after load — this is a list someone scans on a Monday morning.
 * The cards and their controls are client components, because dispositions and
 * hover reasoning need interactivity.
 *
 * Placement comes from lib/placement.ts, the same module the digest email uses,
 * so the two cannot disagree about which company sits where.
 */
import Link from 'next/link';
import { CompanyCase } from '@/components/company-case';
import { GeographySection } from '@/components/geography-tabs';
import { Building2, Radio, Sparkles } from 'lucide-react';
import { Masonry } from '@/components/masonry';
import { CollapsedSection, SectionHeading } from '@/components/primitives';
import { availableWeeks, getWeeklyDigest, type DashboardCompany } from '@/lib/dashboard-data';
import { WeekPicker } from '@/components/week-picker';
import { Sidebar } from '@/components/sidebar';
import { isBroadSector, sectorShort } from '@/lib/subsectors';

export const dynamic = 'force-dynamic';

/*
 * No subtitle. The title names the section, and a line under it explaining what
 * the tool can and cannot argue is the tool talking about itself — the empty
 * state is where a reader actually needs telling, because an empty section is
 * the only one that looks like a fault.
 */
function Section({
  title,
  companies,
  empty,
}: {
  title: string;
  companies: DashboardCompany[];
  empty: string;
}) {
  return (
    <section className="space-y-4">
      <SectionHeading
        title={title}
        right={
          <span className="num text-2xs text-muted-foreground">
            {companies.length} {companies.length === 1 ? 'company' : 'companies'}
          </span>
        }
      />
      {companies.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <Masonry className="dense-cards">
          {companies.map((c) => (
            <CompanyCase key={c.id} company={c} />
          ))}
        </Masonry>
      )}
    </section>
  );
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ place?: string; week?: string; geo?: string; sector?: string }>;
}) {
  const { place, week, geo, sector } = await searchParams;
  const [d, weeks] = await Promise.all([getWeeklyDigest(undefined, week), availableWeeks()]);
  const currentWeek = weeks.find((w) => w.label === d.weekLabel)?.weekOf ?? weeks[0]?.weekOf ?? '';
  const isArchive = Boolean(week) && week !== weeks[0]?.weekOf;

  /*
   * A place filter narrows every section at once. Clicking "Boston, MA" on one
   * card asks a question about the whole week, not about the section that card
   * happened to be in.
   */
  /*
   * Every filter narrows every section, because each asks a question about the
   * week rather than about the section a card happened to land in. They compose:
   * geography AND sector AND a named place all hold at once.
   */
  const inPlace = (list: DashboardCompany[]) => list.filter((c) =>
    (!place || c.hq === place)
    && (!geo || c.geography === geo)
    && (!sector || (c.sectors ?? []).includes(sector)));

  /*
   * Counts for the sidebar, taken BEFORE the geography and sector filters so a
   * reader can see what selecting one would give them. Counting after would
   * show every option as zero except the one already chosen.
   */
  const forCounts = (list: DashboardCompany[]) =>
    place ? list.filter((c) => c.hq === place) : list;
  const discovery = [...forCounts(d.worthAConversation), ...forCounts(d.newOnTheRadar)];
  const sectorCounts = new Map<string, number>();
  for (const c of discovery) {
    for (const sub of c.sectors ?? []) {
      if (isBroadSector(sub)) continue;
      sectorCounts.set(sub, (sectorCounts.get(sub) ?? 0) + 1);
    }
  }
  const sidebarCounts = {
    sections: [
      { id: 'worth', label: 'Worth a conversation', n: inPlace(d.worthAConversation).length },
      { id: 'radar', label: 'New on the radar', n: inPlace(d.newOnTheRadar).length },
      { id: 'known', label: 'Who we know', n: inPlace(d.whoWeKnow).length },
    ],
    places: {
      west_coast: discovery.filter((c) => c.geography === 'west_coast').length,
      other_us: discovery.filter((c) => c.geography === 'other_us').length,
      non_us: discovery.filter((c) => c.geography === 'non_us').length,
    },
    sectors: [...sectorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, n]) => ({ id, label: sectorShort(id), n })),
    monitoring: d.monitoring.length,
    awaiting: d.lowFit.length,
  };

  return (
    <>
      {/* The rail overlays rather than displaces: opening it must not reflow
          the grid underneath, because a card moving as you reach for it is
          worse than a card partly covered. The page keeps its full width in
          both states. */}
      <Sidebar counts={sidebarCounts} />
      <main className="mx-auto max-w-[1400px] px-6 py-10 pl-16 sm:px-12 sm:py-14 sm:pl-20 lg:px-16 lg:pl-24">
      <header className="mb-12 space-y-1">
        <h1 className="flex items-center gap-2.5 font-display text-3xl font-semibold tracking-tight">
          {/* A sun, drawn rather than an icon-font glyph: a bare circle with
              eight rays, at the weight of the text beside it. */}
          Good AM
          <svg
            viewBox="0 0 24 24"
            className="size-7 shrink-0 text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="4.25" />
            <path d="M12 2.5v2.25M12 19.25v2.25M21.5 12h-2.25M4.75 12H2.5M18.72 5.28l-1.6 1.6M6.88 17.12l-1.6 1.6M18.72 18.72l-1.6-1.6M6.88 6.88l-1.6-1.6" />
          </svg>
        </h1>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span>
            {isArchive ? 'Looking back at ' : 'Here\u2019s what happened this week, '}
            {d.weekLabel}.
          </span>
          <WeekPicker weeks={weeks} current={currentWeek} />
        </p>

        {/* A filter has to announce itself. An emptier page with no explanation
            reads as a quiet week rather than as a narrowed view. */}
        {place && (
          <p className="pt-1 text-sm">
            <span className="text-muted-foreground">Showing only</span>{' '}
            <span className="font-medium">{place}</span>
            {' · '}
            <Link href="/" className="text-muted-foreground link-underline hover:text-foreground">
              show everywhere
            </Link>
          </p>
        )}

        {/* This week's work, then what stands behind it.
            The two spans used to sit in one row reading as one sentence:
            "646 companies monitored, 89,396 signals processed, 27 surfaced this
            week" mixes all-time with weekly and invites the reader to divide
            one by the other. The week is what the page is about, so it leads;
            the standing totals are context and take a quieter line. */}
        <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2 pt-4">
          {[
            { n: d.coverageStats.readThisWeek, label: "articles read", Icon: Radio },
            { n: d.coverageStats.scoredThisWeek, label: "companies scored", Icon: Building2 },
            { n: d.coverageStats.surfaced, label: "surfaced", Icon: Sparkles },
          ].map(({ n, label, Icon }) => (
            <div key={label} className="flex items-center gap-2">
              <Icon className="size-4 shrink-0 text-primary/70" strokeWidth={1.5} aria-hidden />
              <dt className="sr-only">{label} this week</dt>
              <dd className="flex items-baseline gap-1.5">
                <span className="num text-lg font-semibold leading-none">
                  {n.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="pt-1.5 text-2xs text-muted-foreground/70">
          <span className="num">{d.coverageStats.monitored.toLocaleString()}</span> companies tracked
          {' · '}
          <span className="num">{d.coverageStats.processed.toLocaleString()}</span> articles filtered
          {' '}all time
        </p>
      </header>

      <div className="space-y-14">
        {/* The two sections split on company SIZE, not on how the tool rated
            them: an established company is someone to call, an early-stage one
            is a find. A company whose size cannot be established sits with the
            larger names, since not knowing is not evidence of smallness. */}
        <GeographySection
          id="worth"
          title="Worth a conversation"
          companies={inPlace(d.worthAConversation)}
          empty="Nothing cleared the bar this week."
        />
        <GeographySection
          id="radar"
          title="New on the radar"
          companies={inPlace(d.newOnTheRadar)}
          empty="No early-stage finds this week."
        />
        <Section
          title="Who we know"
          companies={inPlace(d.whoWeKnow)}
          empty="No companies marked as known yet."
        />
        <Section
          title="Monitoring"
          companies={inPlace(d.monitoring)}
          empty="Nothing monitored yet."
        />

        {/*
          * Both of these are complete lists rather than a week's read, and both
          * answer a question an RD only sometimes has — what the tool judged
          * weak, and what it has not judged yet. Collapsed, they sit as sections
          * on the page instead of as footnotes bolted underneath it, and neither
          * pushes the sections carrying a live argument off screen.
          */}
        <CollapsedSection
          title="Assessed as a weak fit"
          count={d.lowFit.length}
          blurb="Cleared the same trigger bar, then rated low on priority or on Singapore fit. Each card carries the reasoning — if one looks wrong, that is the part worth correcting."
        >
          <Masonry className="dense-cards">
            {inPlace(d.lowFit).map((c) => (
              <CompanyCase key={c.id} company={c} />
            ))}
          </Masonry>
        </CollapsedSection>

        <CollapsedSection
          title="Awaiting assessment"
          count={d.awaitingAssessment.length}
          blurb="Surfaced this week with nobody having assessed them yet. A gap in the work rather than a judgment — any of these could turn out to be worth a conversation."
        >
          <Masonry className="dense-cards">
            {inPlace(d.awaitingAssessment).map((c) => (
              <CompanyCase key={c.id} company={c} />
            ))}
          </Masonry>
        </CollapsedSection>

      </div>
      </main>
    </>
  );
}
