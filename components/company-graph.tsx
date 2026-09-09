'use client';
/**
 * The paths around a company, drawn. Brief §8.
 *
 * The list is the primary interface — it is what makes each path checkable, and
 * it works when the graph is too dense to read. The graph answers the question
 * the list cannot: which single person or fund sits on several paths at once,
 * which is the node worth approaching first.
 *
 * Nothing here is called a warm introduction. An unreviewed edge is an
 * association, and the wording stays "possible" until a human says otherwise.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { NetworkGraph, radialLayout, type NetEdge, type NetNode } from './network-graph';
import { cn } from '@/lib/utils';
import type { CompanyGraph, PathRow } from '@/lib/dashboard-data';

const TONE_LABEL = {
  confirmed: 'Reviewed as usable',
  plausible: 'Plausible, unreviewed',
  weak: 'Weak — through a high-degree node',
} as const;

export function CompanyGraphView({
  graph,
  paths,
  companyName,
}: {
  graph: CompanyGraph;
  paths: PathRow[];
  companyName: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Hover previews a path, a click pins it. Hovering wins while it lasts, so
  // running the cursor down the list traces each one in turn without losing
  // whatever is pinned underneath.
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const shownPathId = hoveredPath ?? selectedPath;
  const activePath = paths.find((p) => p.id === shownPathId) ?? null;

  const { nodes, edges } = useMemo(() => {
    // Centre the hub and ring the satellites around it; the layout also gets the
    // edges so it can order the ring to reduce crossings.
    // Rings are placed at multiples of this radius, so it sizes the first ring
    // rather than the whole diagram. The view pans and zooms, so a layout wider
    // than the frame is fine — better than crowding two rings together.
    const pos = radialLayout(
      graph.nodes.map((n) => ({ id: n.id, kind: n.kind })),
      420,
      260,
      130,
      -Math.PI / 2,
      graph.edges.map((e) => ({ from: e.source, to: e.target })),
    );
    const toneOf = (id: string) => {
      const edge = graph.edges.find((e) => e.target === id || e.source === id);
      return edge?.feasibility ?? 'weak';
    };
    const netNodes: NetNode[] = graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      tone: n.kind === 'hub' ? 'neutral' : toneOf(n.id),
      x: pos[n.id]?.x ?? 420,
      y: pos[n.id]?.y ?? 260,
      // Size follows how many paths run through the node, so the one worth
      // approaching first is the one that reads largest.
      weight: n.degree,
    }));
    const netEdges: NetEdge[] = graph.edges.map((e, i) => ({
      id: `e${i}`,
      from: e.source,
      to: e.target,
      tone: e.feasibility,
    }));
    return { nodes: netNodes, edges: netEdges };
  }, [graph]);

  // Paths carry the nodes they run through, so a selected node matches exactly
  // the paths that touch it rather than every path of the same kind.
  const shown = selected ? paths.filter((p) => p.nodeIds.includes(selected)) : paths;

  if (paths.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No path found in the graph. That means no public edge was scraped, not that none exists.
      </p>
    );
  }

  return (
    // Graph left, list right. The graph sticks while the list scrolls, so a
    // reader working down a long path list never loses sight of the shape they
    // are reading about.
    <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
      <div className="lg:sticky lg:top-6">
        {/* No card around it: a border and a white panel made the graph read as
            a widget dropped on the page rather than part of it. */}
        <NetworkGraph
          nodes={nodes}
          edges={edges}
          height={520}
          selected={selected}
          highlight={activePath?.nodeIds ?? null}
          highlightEdges={activePath?.edgeKeys ?? null}
          onSelect={(id) => {
            // Picking a node clears a picked path: the two are different
            // questions — everything this node touches, versus this one path.
            setSelectedPath(null);
            setSelected((cur) => (cur === id ? null : id));
          }}
          /*
           * A double click opens whatever the node stands for. The id carries
           * its own kind — c for a company, p for a person, o for an
           * organisation — which is the same encoding getCompanyGraph writes.
           */
          onOpen={(id) => {
            const n = Number(id.slice(1));
            if (!Number.isFinite(n)) return;
            const route = id[0] === 'c' ? 'company' : id[0] === 'p' ? 'person' : id[0] === 'o' ? 'org' : null;
            if (route) router.push(`/${route}/${n}`);
          }}
        />

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-2xs text-muted-foreground">
        {(['confirmed', 'plausible', 'weak'] as const).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                'size-2 rounded-full',
                t === 'confirmed' ? 'bg-confirmed' : t === 'plausible' ? 'bg-plausible' : 'bg-weak',
              )}
            />
            {TONE_LABEL[t]}
          </span>
        ))}
        <span>Drag to pan · scroll to zoom · click a node or a path</span>
      </div>
      </div>

      <ul className="space-y-3">
        {shown.map((p) => (
          <li key={p.id}>
            {/* The whole row selects the path and lights it on the graph. The
                source link sits outside the button, since it goes elsewhere. */}
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setSelectedPath((cur) => (cur === p.id ? null : p.id));
              }}
              onMouseEnter={() => setHoveredPath(p.id)}
              onMouseLeave={() => setHoveredPath(null)}
              onFocus={() => setHoveredPath(p.id)}
              onBlur={() => setHoveredPath(null)}
              aria-pressed={selectedPath === p.id}
              className={cn(
                'hairline-b w-full rounded-sm px-2 py-2 text-left transition-colors',
                selectedPath === p.id
                  ? 'bg-muted ring-1 ring-inset ring-primary/30'
                  : 'hover:bg-muted/50',
              )}
            >
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span
                className={cn(
                  'text-2xs uppercase tracking-[0.12em]',
                  p.feasibility === 'confirmed'
                    ? 'text-confirmed'
                    : p.feasibility === 'plausible'
                      ? 'text-plausible'
                      : 'text-muted-foreground',
                )}
              >
                {TONE_LABEL[p.feasibility]}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed">Possible path: {p.description}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{p.evidence}</p>
            </button>
            <span className="ml-2 inline-flex gap-x-3">
              {p.targetCompanyId && p.targetCompanyName ? (
                <Link
                  href={`/company/${p.targetCompanyId}`}
                  className="text-2xs text-primary link-underline"
                >
                  {p.targetCompanyName}
                </Link>
              ) : null}
              {p.sourceUrl && (
                <a
                  href={p.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-2xs text-muted-foreground link-underline hover:text-foreground"
                >
                  source
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
      {(selected || selectedPath) && (
        <p className="text-xs text-muted-foreground">
          {selectedPath
            ? `Showing one path through the graph. Click it again to show all ${paths.length} for ${companyName}.`
            : `Filtered to paths through the selected node. Click it again to show all ${paths.length} for ${companyName}.`}
        </p>
      )}
    </div>
  );
}
