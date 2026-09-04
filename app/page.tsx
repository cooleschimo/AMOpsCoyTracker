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
import { SectionHeading } from '@/components/primitives';
import { availableWeeks, getWeeklyDigest, type DashboardCompany } from '@/lib/dashboard-data';
import { WeekPicker } from '@/components/week-picker';

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
  searchParams: Promise<{ place?: string; week?: string }>;
}) {
  const { place, week } = await searchParams;
  const [d, weeks] = await Promise.all([getWeeklyDigest(undefined, week), availableWeeks()]);
  const currentWeek = weeks.find((w) => w.label === d.weekLabel)?.weekOf ?? weeks[0]?.weekOf ?? '';
  const isArchive = Boolean(week) && week !== weeks[0]?.weekOf;

  /*
   * A place filter narrows every section at once. Clicking "Boston, MA" on one
   * card asks a question about the whole week, not about the section that card
   * happened to be in.
   */
  const inPlace = (list: DashboardCompany[]) =>
    place ? list.filter((c) => c.hq === place) : list;

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-10 sm:px-12 sm:py-14 lg:px-16">
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
            {isArchive ? 'Looking back at ' : 'Here\u2019s what happened last week, '}
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

        {/* The coverage numbers as a stat row rather than a sentence: three
            figures read faster as figures, and "monitored / processed" stays
            in the labels so the wording still avoids claiming more than the
            tool does. */}
        <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2 pt-4">
          {[
            { n: d.coverageStats.monitored, label: "companies monitored", Icon: Building2 },
            { n: d.coverageStats.processed, label: "signals processed", Icon: Radio },
            { n: d.coverageStats.surfaced, label: "surfaced this week", Icon: Sparkles },
          ].map(({ n, label, Icon }) => (
            <div key={label} className="flex items-center gap-2">
              <Icon className="size-4 shrink-0 text-primary/70" strokeWidth={1.5} aria-hidden />
              <dt className="sr-only">{label}</dt>
              <dd className="flex items-baseline gap-1.5">
                <span className="num text-lg font-semibold leading-none">
                  {n.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="space-y-14">
        <GeographySection
          title="Worth a conversation"
          companies={inPlace(d.worthAConversation)}
          empty="Nothing cleared the bar this week."
        />
        <GeographySection
          title="New on the radar"
          companies={inPlace(d.newOnTheRadar)}
          empty="No new finds this week."
        />
        <Section
          title="Familiar territory"
          companies={inPlace(d.familiarTerritory)}
          empty="No companies marked as known yet."
        />
        <Section
          title="Monitoring"
          companies={inPlace(d.monitoring)}
          empty="Nothing monitored yet."
        />
      </div>
    </main>
  );
}
