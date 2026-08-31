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
  const [selected, setSelected] = useState<string | null>(null);

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

  const shown = selected
    ? paths.filter(
        (p) =>
          (p.viaPersonName && selected.startsWith('p')) ||
          (p.viaOrgName && selected.startsWith('o')),
      )
    : paths;

  if (paths.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No path found in the graph. That means no public edge was scraped, not that none exists.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <NetworkGraph
          nodes={nodes}
          edges={edges}
          height={520}
          selected={selected}
          onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-2xs text-muted-foreground">
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
        <span>Drag to pan · scroll to zoom · click a node to filter</span>
      </div>

      <ul className="space-y-3">
        {shown.map((p) => (
          <li key={p.id} className="hairline-b pb-3">
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
            </div>
            <p className="mt-1 text-sm leading-relaxed">Possible path: {p.description}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{p.evidence}</p>
          </li>
        ))}
      </ul>
      {selected && (
        <p className="text-xs text-muted-foreground">
          Filtered to paths through the selected node. Click it again to show all {paths.length} for{' '}
          {companyName}.
        </p>
      )}
    </div>
  );
}
