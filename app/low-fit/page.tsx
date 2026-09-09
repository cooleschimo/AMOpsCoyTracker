/**
 * Companies assessed as a weak fit. Brief §11.
 *
 * These are judged, not pending: the assessment ran and rated the company low
 * on priority, on Singapore fit, or both. They are kept off the dashboard
 * because a company the tool has argued against does not belong beside one it
 * is arguing for — but they are not deleted, because the judgment is the thing
 * most worth checking. §12 counts a regional director correcting it as most of
 * the value in the first months, and a judgment nobody can see is a judgment
 * nobody can correct.
 *
 * Distinct from /awaiting-assessment, which is work not yet done. That page is
 * a queue; this one is a record.
 */
import Link from 'next/link';
import { CompanyCase } from '@/components/company-case';
import { Masonry } from '@/components/masonry';
import { SectionHeading } from '@/components/primitives';
import { getWeeklyDigest } from '@/lib/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function LowFitPage() {
  const d = await getWeeklyDigest();
  const companies = d.lowFit;

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-10 sm:px-12 sm:py-14 lg:px-16">
      <header className="mb-12 space-y-1">
        <p className="text-sm">
          <Link href="/" className="text-muted-foreground link-underline hover:text-foreground">
            back to the week
          </Link>
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Assessed as a weak fit
        </h1>
        <p className="max-w-[62ch] pt-1 text-sm text-muted-foreground">
          These cleared the same trigger bar as the companies on the dashboard, and
          the assessment rated them low on priority, on Singapore fit, or both. Each
          card carries the reasoning behind that call. If one of them looks wrong,
          it is — the judgment is the part worth correcting.
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
            Nothing rated a weak fit this week.
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
