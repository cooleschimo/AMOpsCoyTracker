/**
 * Every company that has ever cleared the trigger bar.
 *
 * The dashboard shows one week. This is the standing record behind the "ever"
 * figure in its header: who the tool has put in front of a regional director at
 * any point, deduped, so a company that qualified three weeks running is one
 * entry rather than three.
 *
 * A list rather than cards. The question here is coverage — has this company
 * ever come up — and a grid of full cards would answer it at a tenth the
 * density while repeating evidence that has already been read.
 */
import Link from 'next/link';
import { SectionHeading } from '@/components/primitives';
import { everSurfacedCompanies } from '@/lib/dashboard-data';
import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/session';
import { sectorShort } from '@/lib/subsectors';

export const dynamic = 'force-dynamic';

export default async function SurfacedPage() {
/*
 * Gated here as well as in the gate in front of it.
 *
 * The Next.js documentation for this convention warns that a matcher change or
 * a moved route silently removes that coverage, and this page holds internal
 * assessment detail — so it says what it needs rather than inheriting it.
 */
  if (!(await currentSession())) redirect('/login');

  const companies = await everSurfacedCompanies();

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-10 sm:px-12 sm:py-14 lg:px-16">
      <header className="mb-10 max-w-[68ch] space-y-1">
        <p className="text-sm">
          <Link href="/" className="text-muted-foreground link-underline hover:text-foreground">
            back to the week
          </Link>
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Every company surfaced
        </h1>
        <p className="pt-1 text-sm text-muted-foreground">
          Everything that has cleared the trigger bar since the tool started, counted
          once however many weeks it ran for. The most recent week it qualified in is
          on the right.
        </p>
      </header>

      <section className="space-y-4">
        <SectionHeading
          title="All time"
          right={
            <span className="num text-2xs text-muted-foreground">
              {companies.length} {companies.length === 1 ? 'company' : 'companies'}
            </span>
          }
        />
        {companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has surfaced yet.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--hairline)]">
            {companies.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2.5"
              >
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <Link
                    href={`/company/${c.id}`}
                    className="font-medium link-underline hover:text-primary"
                  >
                    {c.name}
                  </Link>
                  <span className="text-2xs text-muted-foreground">
                    {c.sectors.map((sx) => sectorShort(sx)).join(' · ') || 'no sector'}
                  </span>
                  <span className="text-2xs text-muted-foreground/70">{c.hq}</span>
                </span>
                <span className="num shrink-0 text-2xs text-muted-foreground/70">
                  {c.lastWeek}
                  {c.weeks > 1 && (
                    <span className="ml-2 text-muted-foreground/50">{c.weeks} weeks</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
