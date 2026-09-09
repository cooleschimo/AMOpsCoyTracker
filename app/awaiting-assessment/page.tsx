/**
 * The assessment backlog. Brief §11.
 *
 * Every company on the dashboard is meant to carry an assessment. When a run
 * hits its token budget before reaching the end of the queue, the companies it
 * did not get to land here rather than being scored 'unknown' and shown beside
 * companies a human actually judged — an unassessed company is work not yet
 * done, and reading it as a low band is how a real find gets buried.
 *
 * Its own page, not a dashboard section: the backlog is as long as the run was
 * short, and a list of that size at the foot of the weekly read would push the
 * sections that carry a judgment off the screen. Reachable from the dashboard,
 * deliberately absent from the header nav — this is a queue to work through,
 * not a fourth way to read the week.
 */
import Link from 'next/link';
import { CompanyCase } from '@/components/company-case';
import { Masonry } from '@/components/masonry';
import { SectionHeading } from '@/components/primitives';
import { getWeeklyDigest } from '@/lib/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function AwaitingAssessmentPage() {
  const d = await getWeeklyDigest();
  const companies = d.awaitingAssessment;

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-10 sm:px-12 sm:py-14 lg:px-16">
      <header className="mb-12 space-y-1">
        <p className="text-sm">
          <Link href="/" className="text-muted-foreground link-underline hover:text-foreground">
            back to the week
          </Link>
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Awaiting assessment
        </h1>
        <p className="pt-1 text-sm text-muted-foreground">
          These cleared the same trigger bar as the dashboard companies and have not been assessed yet — a gap in the work, not a verdict on the company.
        </p>
      </header>

      <section className="space-y-4">
        <SectionHeading
          title={d.weekLabel}
          right={
            <span className="num text-2xs text-muted-foreground">
              {companies.length} {companies.length === 1 ? 'company' : 'companies'}
            </span>
          }
        />
        {companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing waiting — every company that surfaced this week has been assessed.
          </p>
        ) : (
          <Masonry className="dense-cards">
            {companies.map((c) => (
              <CompanyCase key={c.id} company={c} />
            ))}
          </Masonry>
        )}
      </section>
    </main>
  );
}
