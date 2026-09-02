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
import { CompanyCase } from '@/components/company-case';
import { GeographySection } from '@/components/geography-tabs';
import { Building2, Radio, Sparkles } from 'lucide-react';
import { Masonry } from '@/components/masonry';
import { SectionHeading } from '@/components/primitives';
import { getWeeklyDigest, type DashboardCompany } from '@/lib/dashboard-data';

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

export default async function Dashboard() {
  const d = await getWeeklyDigest();

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
        <p className="text-sm text-muted-foreground">
          Here&rsquo;s what happened last week, {d.weekLabel}.
        </p>

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
          companies={d.worthAConversation}
          empty="Nothing cleared the bar this week."
        />
        <GeographySection
          title="New on the radar"
          companies={d.newOnTheRadar}
          empty="No new finds this week."
        />
        <Section
          title="EDB account activity"
          companies={d.accountActivity}
          empty="No companies marked as accounts yet."
        />
        <Section
          title="Monitoring"
          companies={d.monitoring}
          empty="Nothing monitored yet."
        />
      </div>
    </main>
  );
}
