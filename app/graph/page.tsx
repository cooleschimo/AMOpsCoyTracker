/**
 * The connection graph. Brief §8.
 *
 * Paths are shown for one company at a time rather than as a single whole-graph
 * view: with thousands of investment edges, everything-at-once is a hairball
 * that answers no question. Picking a company keeps the view at the scale an RD
 * actually works at.
 */
import Link from 'next/link';
import { CompanyGraphView } from '@/components/company-graph';
import { SectionHeading } from '@/components/primitives';
// From lib, not primitives: primitives is a client module, and a server
// component cannot call a function that lives on the client.
import { sectorLabel } from '@/lib/subsectors';
import { getCompanyGraph, getCompanyPaths, getWeeklyDigest } from '@/lib/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const { company } = await searchParams;
  const digest = await getWeeklyDigest();
  const candidates = [
    ...digest.worthAConversation,
    ...digest.newOnTheRadar,
    ...digest.accountActivity,
  ];

  const selectedId = company ?? candidates[0]?.id;
  const selected = candidates.find((c) => c.id === selectedId) ?? candidates[0];

  const [graph, paths] = selected
    ? await Promise.all([
        getCompanyGraph(selected.companyId),
        getCompanyPaths(selected.companyId),
      ])
    : [{ nodes: [], edges: [] }, []];

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-10 sm:px-12 sm:py-14 lg:px-16">
      <header className="mb-8 space-y-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Connections</h1>
        <p className="measure text-sm text-muted-foreground">
          People, investors and Singapore-linked entities around a company, drawn from public
          records.
        </p>
        <p className="pt-2 text-xs text-muted-foreground">
          <Link href="/" className="link-underline hover:text-foreground">
            ← This week
          </Link>
        </p>
      </header>

      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No companies surfaced this week.</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-x-1 gap-y-1.5">
            {candidates.slice(0, 24).map((c) => (
              <Link
                key={c.id}
                href={`/graph?company=${c.id}`}
                className={
                  c.id === selected?.id
                    ? 'rounded-sm bg-primary px-2 py-1 text-xs text-primary-foreground'
                    : 'rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground'
                }
              >
                {c.name}
              </Link>
            ))}
          </div>

          {selected && (
            <section className="space-y-4">
              <SectionHeading
                title={selected.name}
                subtitle={`${sectorLabel(selected.sector)} · ${selected.hq}`}
                right={
                  <span className="num text-2xs text-muted-foreground">
                    {paths.length} {paths.length === 1 ? 'path' : 'paths'}
                  </span>
                }
              />
              <CompanyGraphView graph={graph} paths={paths} companyName={selected.name} />
            </section>
          )}
        </div>
      )}
    </main>
  );
}
