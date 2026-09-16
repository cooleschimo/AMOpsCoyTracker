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
import { currentUser } from '@/lib/session';
import { WeekPicker } from '@/components/week-picker';
import { ControlBar } from '@/components/control-bar';
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
  subtitle,
  blurb,
  companies,
  empty,
  id,
  canAct = true,
}: {
  title: string;
  /** The standing line above the blurb, set in tracked caps. */
  subtitle?: string;
  blurb?: string;
  companies: DashboardCompany[];
  empty: string;
  /** Scroll target for the sidebar's jump links. */
  id?: string;
  /** False for a guest, which hides the per-card actions. */
  canAct?: boolean;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
      <SectionHeading
        title={title}
        subtitle={subtitle}
        blurb={blurb}
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
            <CompanyCase key={c.id} company={c} canAct={canAct} />
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
  const { place, week, geo: geoParam, sector } = await searchParams;
  /*
   * The West Coast is where the target list actually lives, so an unfiltered
   * dashboard was answering a wider question than the one an RD opens it with.
   * Arriving with no geography in the URL means the West Coast; 'all' is what
   * a reader picks to widen it, and is what clearing the filter now sets.
   */
  const geo = geoParam ?? 'west_coast';
  const me = await currentUser();
  const [d, weeks] = await Promise.all([
    /*
     * A guest reads the week. What Singapore could offer, and everything people
     * here have recorded — familiarity, watchers, open outreach — is withheld
     * at the source rather than hidden in the markup, so none of it reaches the
     * HTML the server sends.
     */
    getWeeklyDigest(undefined, week, { withOffer: Boolean(me), withInternal: Boolean(me) }),
    availableWeeks(),
  ]);
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
    && (geo === 'all' || c.geography === geo)
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
  // Filtered once and used for both the count and the cards, so the two cannot
  // disagree about how much a section holds.
  const shownLowFit = inPlace(d.lowFit);
  const shownAwaiting = inPlace(d.awaitingAssessment);
  const shownToWatch = inPlace(d.toWatch);

  const sidebarCounts = {
    places: {
      west_coast: discovery.filter((c) => c.geography === 'west_coast').length,
      other_us: discovery.filter((c) => c.geography === 'other_us').length,
      non_us: discovery.filter((c) => c.geography === 'non_us').length,
      // Everywhere is the whole set rather than a geography of its own.
      all: discovery.length,
    },
    sectors: [...sectorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, n]) => ({ id, label: sectorShort(id), n })),
    monitoring: d.monitoring.length,
    // What /awaiting-assessment actually lists. It counted lowFit, so the badge
    // read five and the page it linked to showed none.
    awaiting: d.awaitingAssessment.length,
  };

  return (
    <>
      {/* The rail is 48px and fixed, so the page reserves exactly that plus its
          own gutter — pl-24 reserved 96px, which left a gap on the left that
          matched nothing and made the header look inset from a margin that was
          not there. Expanding the sidebar overlays rather than reflows, by
          design: a card that moves as you reach for it is worse than one
          briefly covered. */}
      {/* No top padding: the control bar is the first thing in here and sticks
          to the viewport top, so padding above it both pushed the masthead down
          the page and stopped the bar sitting flush when scrolled. The bar
          carries its own spacing; the page keeps its padding at the bottom. */}
      <main className="mx-auto max-w-[1400px] px-6 pb-10 sm:px-12 sm:pb-14 lg:px-16">
      <ControlBar
        counts={sidebarCounts}
        user={me}
        masthead={
          <>
            {/* Sized for a bar, not for a page title. At 3xl this was taller
                than the row it sits in and forced the week onto its own line. */}
            <h1 className="flex items-baseline gap-2 font-display text-xl font-semibold tracking-tight">
              Good AM
              <svg
                viewBox="0 0 24 24"
                className="size-4 shrink-0 translate-y-0.5 text-primary"
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
            <span className="flex items-baseline gap-x-2 text-sm text-muted-foreground">
              <span className="text-border">/</span>
              {isArchive ? 'looking back at ' : ''}
              {d.weekLabel}
              <WeekPicker weeks={weeks} current={currentWeek} />
            </span>
          </>
        }
        summary={
          <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-sm">
            {/*
              * The all-time figure sits inline after its own stat, not stacked
              * under it and not gathered into a separate line below the row.
              * Each measure reads as one phrase — "27 surfaced of 224 ever" —
              * so the week's number and the standing one are compared where
              * they are read, on a single baseline.
              */}
            {[
              { n: d.coverageStats.readThisWeek, label: 'articles read',
                all: d.coverageStats.processed, allLabel: 'filtered' },
              { n: d.coverageStats.scoredThisWeek, label: 'companies scored',
                all: d.coverageStats.monitored, allLabel: 'tracked' },
              { n: d.coverageStats.surfaced, label: 'surfaced',
                all: d.coverageStats.everSurfaced, allLabel: 'ever', href: '/surfaced' },
            ].map(({ n, label, all, allLabel, href }) => (
              <div key={label} className="flex items-baseline gap-1.5">
                <dt className="sr-only">{label} this week</dt>
                <dd className="num font-semibold">{n.toLocaleString()}</dd>
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-2xs text-muted-foreground/50">
                  of{' '}
                  {href ? (
                    <Link href={href} className="link-underline hover:text-foreground">
                      <span className="num">{all.toLocaleString()}</span> {allLabel}
                    </Link>
                  ) : (
                    <>
                      <span className="num">{all.toLocaleString()}</span> {allLabel}
                    </>
                  )}
                </span>
              </div>
            ))}
          </dl>
        }
      />

      <div className="space-y-14">
        {/* The two sections split on company SIZE, not on how the tool rated
            them: an established company is someone to call, an early-stage one
            is a find. A company whose size cannot be established sits with the
            larger names, since not knowing is not evidence of smallness. */}
        <GeographySection
          id="worth"
          title="Worth a conversation"
          blurb="Something happening now, at a company past the early rounds."
          companies={inPlace(d.worthAConversation)}
          empty="Nothing cleared the bar this week."
          canAct={Boolean(me)}
        />
        <GeographySection
          id="radar"
          title="New on the radar"
          blurb="Earlier stage, by the round or valuation reported."
          companies={inPlace(d.newOnTheRadar)}
          empty="No early-stage finds this week."
          canAct={Boolean(me)}
        />
        {/* Directly under the two discovery sections, because it answers the
            question they raise: a company rated worth caring about that did not
            appear above is not missing, it is quiet. Held open rather than
            collapsed — a quiet week should read as quiet, and a list nobody
            expands cannot say that. */}
        <Section
          id="watch"
          title="To watch"
          subtitle="Rated, waiting on news"
          blurb="Worth caring about, with no trigger this week."
          companies={shownToWatch}
          empty="Nothing rated and waiting."
          canAct={Boolean(me)}
        />
        {/*
          * Members only, both of them.
          *
          * These two are not a read of the week — they are a read of EDB. One
          * says which companies somebody here is already talking to, the other
          * which colleagues are watching what, by name. /monitoring and
          * /awaiting-assessment already redirect a guest for exactly this
          * reason; these sections are the same material rendered inline, and
          * were the place the rule had not reached.
          *
          * Hidden rather than emptied: the headings alone disclose. "Who we
          * know" over a filtered list still says the category exists and that
          * something is in it.
          */}
        {me && (
          <>
            <Section
              id="known"
              title="Who we know"
              blurb="Already known or in conversation, and something moved."
              companies={inPlace(d.whoWeKnow)}
              empty="No companies marked as known yet."
              canAct
            />
            <Section
              title="Monitoring"
              blurb="Companies someone chose to follow."
              companies={inPlace(d.monitoring)}
              empty="Nothing monitored yet."
              canAct
            />
          </>
        )}

        {/*
          * Both of these are complete lists rather than a week's read, and both
          * answer a question an RD only sometimes has — what the tool judged
          * weak, and what it has not judged yet. Collapsed, they sit as sections
          * on the page instead of as footnotes bolted underneath it, and neither
          * pushes the sections carrying a live argument off screen.
          */}
        {/* The count is of what the section will SHOW, not of what it holds
            before the filters run. Counting first promised five companies and
            then opened on nothing: the whole weak-fit list is international,
            and the page defaults to the West Coast. A section that says five
            and reveals none reads as broken, where a section that says nothing
            is there is merely a filtered view. */}
        {me && (
          <CollapsedSection
            title="Assessed as a weak fit"
            count={shownLowFit.length}
            blurb="Rated low on priority or Singapore fit."
          >
            <Masonry className="dense-cards">
              {shownLowFit.map((c) => (
                <CompanyCase key={c.id} company={c} canAct />
              ))}
            </Masonry>
          </CollapsedSection>
        )}

        {/*
          * Absent entirely when there is nothing waiting.
          *
          * Weak fit above stays and says it is empty, because an empty section
          * there is a finding — a quiet week for weak fits is worth knowing. A
          * backlog is different: nothing awaiting assessment is the tool being
          * up to date, not a result to report.
          *
          * Both are members-only. One holds the tool's verdicts on companies,
          * the other its unfinished work, and a guest reads neither.
          */}
        {me && shownAwaiting.length > 0 && (
          <CollapsedSection
            title="Awaiting assessment"
            count={shownAwaiting.length}
            blurb="Surfaced this week but not yet assessed."
          >
            <Masonry className="dense-cards">
              {shownAwaiting.map((c) => (
                <CompanyCase key={c.id} company={c} canAct={Boolean(me)} />
              ))}
            </Masonry>
          </CollapsedSection>
        )}

      </div>
      </main>
    </>
  );
}
