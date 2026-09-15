/**
 * Companies this reader has dismissed. Brief §11b.
 *
 * A dismissal is one click and it takes the company off the week, which is the
 * right default — but it makes a misclick invisible, because the evidence that
 * it happened is the absence of a card. This is the list that makes it
 * recoverable.
 *
 * Scoped to the browser's own voter key: that is the only identity the schema
 * carries (§7a), and one reader's dismissal is not a verdict for everyone.
 *
 * A list rather than cards. The question is which company was dismissed and
 * whether that was meant, and a grid of full cards would answer it at a tenth
 * the density while repeating evidence the reader already saw when they
 * dismissed it.
 */
import Link from 'next/link';
import { cookies } from 'next/headers';
import { SectionHeading } from '@/components/primitives';
import { UndoDismiss } from '@/components/undo-dismiss';
import { dismissedCompanies } from '@/lib/dashboard-data';
import { REASON_LABELS, type Reason } from '@/lib/dispositions';
import { sectorShort } from '@/lib/subsectors';

export const dynamic = 'force-dynamic';

/*
 * The two kinds of reason suppress differently, and a reader deciding whether
 * to restore needs to know which they picked: a verdict about the company holds
 * until undone, where the rest hold only against the news already seen.
 */
const ABOUT_THE_COMPANY: string[] = ['irrelevant_company', 'no_sg_angle'];

export default async function DismissedPage() {
  const jar = await cookies();
  const voterKey = jar.get('voter_key')?.value ?? null;
  const companies = await dismissedCompanies(voterKey);

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-10 sm:px-12 sm:py-14 lg:px-16">
      <header className="mb-10 max-w-[68ch] space-y-1">
        <p className="text-sm">
          <Link href="/" className="text-muted-foreground link-underline hover:text-foreground">
            back to the week
          </Link>
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Dismissed</h1>
        <p className="measure pt-1 text-sm text-muted-foreground">
          Restore one and it returns to the week.
        </p>
      </header>

      <section className="space-y-4">
        <SectionHeading
          title="Dismissed by you"
          right={
            <span className="num text-2xs text-muted-foreground">
              {companies.length} {companies.length === 1 ? 'company' : 'companies'}
            </span>
          }
        />
        {companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {voterKey
              ? 'Nothing dismissed.'
              : 'Nothing dismissed from this browser yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--hairline)]">
            {companies.map((c) => {
              const held = c.reasons.some((r) => ABOUT_THE_COMPANY.includes(r));
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2.5"
                >
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <Link
                      href={`/company/${c.id}`}
                      className="font-medium link-underline hover:text-primary"
                    >
                      {c.name}
                    </Link>
                    {c.oneLiner && (
                      <span className="text-xs italic text-muted-foreground">{c.oneLiner}</span>
                    )}
                    <span className="text-2xs text-muted-foreground">
                      {c.sectors.map((sx) => sectorShort(sx)).join(' · ') || 'no sector'}
                    </span>
                    <span className="text-2xs text-muted-foreground/70">{c.hq}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-x-4">
                    <span className="text-2xs text-muted-foreground/70">
                      {c.reasons.length
                        ? c.reasons
                            .map((r) => REASON_LABELS[r as Reason] ?? r)
                            .join(', ')
                        : 'no reason given'}
                      {/* Said plainly, because the two behave differently and
                          the difference is invisible otherwise. */}
                      <span className="ml-2 text-muted-foreground/50">
                        {held ? 'held until restored' : 'returns on newer news'}
                      </span>
                    </span>
                    <span className="num text-2xs text-muted-foreground/70">{c.at}</span>
                    <UndoDismiss companyId={c.id} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
