/**
 * Monitored companies. Brief §11a.
 *
 * The expanded view behind the digest's monitoring line. A monitored company
 * with nothing new still appears here — that is the point of the page: a quiet
 * company stays visible rather than disappearing from view.
 */
import Link from 'next/link';
import { CompanyCase } from '@/components/company-case';
import { MonitoringDrop } from '@/components/monitoring-drop';
import { Masonry } from '@/components/masonry';
import { SectionHeading } from '@/components/primitives';
// From lib, not primitives: primitives is a client module, and a server
// component cannot call a function that lives on the client.
import { broadSectorLabel, sectorBroadSector } from '@/lib/subsectors';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { getMonitoredCompanies, type DashboardCompany } from '@/lib/dashboard-data';

export const dynamic = 'force-dynamic';

/**
 * Groups are derived from the companies present, not a fixed list.
 *
 * Companies carry subsectors — ai_software, semiconductors — which roll up to
 * the broad sectors in lib/subsectors.ts. A hardcoded list of the original four
 * silently dropped every monitored company whose sector was not one of them.
 */
function groupBySector(companies: DashboardCompany[]) {
  const groups = new Map<string, DashboardCompany[]>();
  for (const c of companies) {
    const key = sectorBroadSector(c.sector) ?? c.sector;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}

export default async function MonitoringPage() {
  // Monitoring is a record of what people on the team are watching. A guest has
  // nothing in it and no business reading it, so this is a redirect rather than
  // an empty page.
  if (!(await currentUser())) redirect('/login');
  const companies = await getMonitoredCompanies();
  const groups = groupBySector(companies);

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-10 sm:px-12 sm:py-14 lg:px-16">
      <header className="mb-10 space-y-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Monitored companies</h1>
        <p className="text-sm text-muted-foreground">
          Everything these companies have done since you started watching them.
        </p>
        <p className="pt-2 text-xs text-muted-foreground">
          <Link href="/" className="link-underline hover:text-foreground">
            ← This week
          </Link>
        </p>
      </header>

      {companies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing monitored yet. Monitored companies appear here when they do something new.
        </p>
      ) : (
        <div className="grid gap-x-8 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {groups.map(([sector, inSector]) => {
            return (
              <section key={sector} className="space-y-4">
                <SectionHeading
                  title={broadSectorLabel(sector)}
                  right={
                    <span className="num text-2xs text-muted-foreground">
                      {inSector.length} {inSector.length === 1 ? 'company' : 'companies'}
                    </span>
                  }
                />
                {/* Half the page: the sectors sit two abreast, so the cards
                    inside one of them have half the room a dashboard card has. */}
                <Masonry className="dense-cards" width="half">
                  {inSector.map((c) => (
                    // The control sits under the card rather than inside it:
                    // stopping a watch belongs to this page, and CompanyCase is
                    // shared with the dashboard where the action has no meaning.
                    <div key={c.id}>
                      <CompanyCase company={c} />
                      <MonitoringDrop companyId={c.id} />
                    </div>
                  ))}
                </Masonry>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
