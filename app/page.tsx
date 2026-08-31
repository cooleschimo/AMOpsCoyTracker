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
    <main className="mx-auto max-w-[1400px] px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-12 space-y-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight">This week</h1>
        <p className="text-sm text-muted-foreground">
          {d.weekLabel} · {d.coverage}
        </p>
        {/* Stated once, rather than a hint repeated on every element that has
            one. The dotted underline is the shared convention. */}
        <p className="pt-1 text-xs text-muted-foreground">
          Anything{" "}
          <span className="underline decoration-dotted decoration-from-font underline-offset-[3px]">
            underlined like this
          </span>{" "}
          explains itself on hover — why a band landed where it did, where a figure came from.
        </p>
      </header>

      <div className="space-y-14">
        <Section
          title="Worth a conversation"
          companies={d.worthAConversation}
          empty="Nothing cleared the bar this week. A quiet week is a real result, not a failure."
        />
        <Section
          title="New on the radar"
          companies={d.newOnTheRadar}
          empty="No new finds this week."
        />
        <Section
          title="EDB account activity"
          companies={d.accountActivity}
          empty="Nothing here until account status is recorded — every company currently reads as unknown."
        />
        <Section
          title="Monitoring"
          companies={d.monitoring}
          empty="Nothing monitored yet. Choosing Monitor on a company keeps it warm and resurfaces it on its next trigger."
        />
      </div>
    </main>
  );
}
