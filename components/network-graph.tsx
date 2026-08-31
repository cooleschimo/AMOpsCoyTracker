"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type GraphTone = "confirmed" | "plausible" | "weak" | "neutral";

export interface NetNode {
  id: string;
  label: string;
  kind: "hub" | "person" | "investor" | "sg_entity";
  tone: GraphTone;
  x: number;
  y: number;
  weight?: number | undefined;
  sub?: string | undefined;
}

export interface NetEdge {
  id: string;
  from: string;
  to: string;
  tone: GraphTone;
}

export const toneColor: Record<GraphTone, string> = {
  confirmed: "var(--confirmed)",
  plausible: "var(--plausible)",
  weak: "var(--weak)",
  neutral: "var(--primary)",
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function NetworkGraph({
  nodes,
  edges,
  height = 380,
  selected,
  highlight,
  highlightEdges,
  onSelect,
  className,
}: {
  nodes: NetNode[];
  edges: NetEdge[];
  height?: number;
  selected?: string | null;
  /**
   * Nodes to light up directly, rather than deriving them from a selected
   * node's neighbours. Selecting a path highlights exactly that path, where
   * selecting a node highlights everything it touches.
   */
  highlight?: string[] | null;
  /**
   * The specific edges belonging to the highlighted path, as `from|to` keys.
   *
   * Inferring edges from the node set lit up every edge running between any two
   * highlighted nodes — so an unrelated path sharing two of them was drawn as
   * though it were part of the one being previewed.
   */
  highlightEdges?: string[] | null;
  onSelect?: (id: string | null) => void;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: height });
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  const drag = useRef<
    | { mode: "node"; id: string; dx: number; dy: number }
    | { mode: "pan"; sx: number; sy: number; ox: number; oy: number }
    | null
  >(null);
  const moved = useRef(false);

  useEffect(() => {
    setPos(Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y }])));
  }, [nodes]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (nodes.length === 0 || size.w === 0) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const pad = 60;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    const k = clamp(Math.min(size.w / (maxX - minX), size.h / (maxY - minY)), MIN_ZOOM, 1.4);
    setView({
      k,
      x: size.w / 2 - ((minX + maxX) / 2) * k,
      y: size.h / 2 - ((minY + maxY) / 2) * k,
    });
  }, [nodes, size.w, size.h]);

  useEffect(() => {
    fit();
  }, [fit]);

  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const next = clamp(v.k * Math.exp(-dy * 0.0015), MIN_ZOOM, MAX_ZOOM);
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const r = next / v.k;
      setView({ k: next, x: px - (px - v.x) * r, y: py - (py - v.y) * r });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toWorld = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - view.x) / view.k,
      y: (e.clientY - rect.top - view.y) / view.k,
    };
  };

  const degree = useMemo(() => {
    const d: Record<string, number> = {};
    for (const e of edges) {
      d[e.from] = (d[e.from] ?? 0) + 1;
      d[e.to] = (d[e.to] ?? 0) + 1;
    }
    return d;
  }, [edges]);

  const neighbours = useMemo(() => {
    if (highlight?.length) return new Set(highlight);
    if (!selected) return null;
    const s = new Set<string>([selected]);
    for (const e of edges) {
      if (e.from === selected) s.add(e.to);
      if (e.to === selected) s.add(e.from);
    }
    return s;
  }, [selected, highlight, edges]);

  const highlightEdgeSet = useMemo(
    () => (highlightEdges?.length ? new Set(highlightEdges) : null),
    [highlightEdges],
  );

  const P = (id: string) => pos[id];

  return (
    <div
      ref={wrapRef}
      style={{ height }}
      className={cn(
        // No panel: transparent, no border. A bordered white card made the graph
        // read as a widget dropped onto the page rather than part of it.
        "relative w-full touch-none select-none overflow-hidden",
        className
      )}
      onPointerDown={(e) => {
        if ((e.target as Element).closest("[data-node]")) return;
        moved.current = false;
        drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        moved.current = true;
        if (d.mode === "pan") {
          setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
        } else {
          const w = toWorld(e);
          setPos((p) => ({ ...p, [d.id]: { x: w.x - d.dx, y: w.y - d.dy } }));
        }
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <svg width="100%" height="100%" className="block cursor-grab active:cursor-grabbing">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {edges.map((e) => {
            const a = P(e.from);
            const b = P(e.to);
            if (!a || !b) return null;
            const dim = highlightEdgeSet
              ? !(highlightEdgeSet.has(`${e.from}|${e.to}`) || highlightEdgeSet.has(`${e.to}|${e.from}`))
              : neighbours
                ? !(neighbours.has(e.from) && neighbours.has(e.to))
                : false;
            // Straight. The layout is radial, so edges from the hub are spokes
            // and read cleanly; bowing them — in a direction picked by hashing
            // the edge id, so neighbouring edges bent opposite ways — was what
            // made a modest number of edges look like a tangle.
            const path = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
            return (
              <path
                key={e.id}
                d={path}
                fill="none"
                stroke={toneColor[e.tone]}
                strokeWidth={dim ? 0.8 : 1.3}
                strokeLinecap="round"
                opacity={dim ? 0.12 : 0.55}
                className="transition-opacity duration-150"
              />
            );
          })}
          {nodes.map((n) => {
            const p = P(n.id);
            if (!p) return null;
            const active = selected === n.id;
            const hot = hovered === n.id;
            const dim = neighbours ? !neighbours.has(n.id) : false;
            const d = n.weight ?? degree[n.id] ?? 1;
            const base = n.kind === "hub" ? 9 : 3.5 + Math.min(d, 5) * 1.2;
            const grown = hot || active;
            const r = grown ? base * 1.45 : base;

            const color = toneColor[n.tone];
            return (
              <g
                key={n.id}
                data-node
                className="cursor-pointer transition-opacity duration-150"
                opacity={dim ? 0.28 : 1}
                onPointerEnter={() => setHovered(n.id)}
                onPointerLeave={() => setHovered((h) => (h === n.id ? null : h))}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  moved.current = false;
                  const w = toWorld(e);
                  drag.current = { mode: "node", id: n.id, dx: w.x - p.x, dy: w.y - p.y };
                  (e.currentTarget as Element).setPointerCapture(e.pointerId);
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  drag.current = null;
                  if (!moved.current) onSelect?.(active ? null : n.id);
                }}
              >
                {(active || hot) && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r + (grown ? 9 : 7)}
                    fill={color}
                    opacity={hot ? 0.16 : 0.12}
                    style={{ transition: "r 140ms ease, opacity 140ms ease" }}
                  />
                )}

                {n.kind === "hub" ? (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    fill="var(--card)"
                    stroke={color}
                    strokeWidth={2.5}
                    style={{ transition: "r 140ms cubic-bezier(0.34, 1.4, 0.64, 1)" }}
                  />
                ) : (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    fill={color}
                    stroke="var(--card)"
                    strokeWidth={1.5}
                    style={{ transition: "r 140ms cubic-bezier(0.34, 1.4, 0.64, 1)" }}
                  />
                )}

                <text
                  x={p.x}
                  y={p.y + r + 11}
                  textAnchor="middle"
                  className="fill-foreground"
                  style={{
                    fontSize: n.kind === "hub" ? 11 : 9.5,
                    fontWeight: n.kind === "hub" ? 600 : 400,
                    letterSpacing: "0.01em",
                    paintOrder: "stroke",
                    stroke: "var(--card)",
                    strokeWidth: 3,
                    strokeLinejoin: "round",
                  }}
                >
                  {n.label}
                </text>
                {n.sub && (
                  <text
                    x={p.x}
                    y={p.y + r + 22}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    style={{
                      fontSize: 8,
                      paintOrder: "stroke",
                      stroke: "var(--card)",
                      strokeWidth: 3,
                      strokeLinejoin: "round",
                    }}
                  >
                    {n.sub}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute right-2 top-2 flex flex-col gap-1">
        {[
          { label: "+", fn: () => zoomBy(1.25) },
          { label: "−", fn: () => zoomBy(1 / 1.25) },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={b.fn}
            className="pointer-events-auto size-6 rounded-sm border border-border bg-background text-xs text-muted-foreground hover:text-foreground"
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          onClick={fit}
          className="pointer-events-auto rounded-sm border border-border bg-background px-1.5 py-0.5 text-2xs uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
        >
          Fit
        </button>
      </div>
    </div>
  );

  function zoomBy(f: number) {
    setView((v) => {
      const next = clamp(v.k * f, MIN_ZOOM, MAX_ZOOM);
      const r = next / v.k;
      const px = size.w / 2;
      const py = size.h / 2;
      return { k: next, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
    });
  }
}

/** Quadratic Bezier edge with a gentle outward arc. */

/** Radial layout: hub at (cx, cy), satellites ordered to minimise crossings. */
/**
 * Lay nodes out in rings by how many hops they are from the hub.
 *
 * A single ring put a Singapore entity reached *through* a person at the same
 * distance as the person themselves, so the layout said nothing about the shape
 * of a path — and edges between ring neighbours crossed the ring, which is what
 * made a small graph look like a tangle.
 *
 * Distance from the centre is now hop count. Each node is placed near the
 * angular mean of its already-placed neighbours, so a second-hop node sits
 * outside the node that leads to it rather than across the diagram.
 */
export function radialLayout<T extends { id: string; kind: NetNode["kind"] }>(
  items: T[],
  cx: number,
  cy: number,
  radius: number,
  startAngle = -Math.PI / 2,
  edges: { from: string; to: string }[] = []
) {
  const out: Record<string, { x: number; y: number }> = {};
  const hubIds = items.filter((i) => i.kind === "hub").map((i) => i.id);
  for (const id of hubIds) out[id] = { x: cx, y: cy };
  if (!items.length) return out;

  const adjacency = new Map<string, Set<string>>();
  for (const { from, to } of edges) {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
  }

  // Breadth-first from the hub: depth is the ring a node belongs to.
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const id of hubIds) {
    depth.set(id, 0);
    queue.push(id);
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    const d = depth.get(id)!;
    for (const next of adjacency.get(id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, d + 1);
      queue.push(next);
    }
  }
  // Anything the edges do not reach still needs a home: put it on the outside.
  const maxDepth = Math.max(1, ...[...depth.values()]);
  for (const item of items) if (!depth.has(item.id)) depth.set(item.id, maxDepth + 1);

  const byDepth = new Map<number, T[]>();
  for (const item of items) {
    const d = depth.get(item.id)!;
    if (d === 0) continue;
    const arr = byDepth.get(d) ?? [];
    arr.push(item);
    byDepth.set(d, arr);
  }

  const angles = new Map<string, number>();
  const rings = [...byDepth.keys()].sort((a, b) => a - b);

  for (const d of rings) {
    const ring = byDepth.get(d)!;
    // Each node wants to sit near whatever already-placed node leads to it, so
    // an edge runs outward rather than around the diagram.
    const preferred = ring.map((item) => {
      const parents = [...(adjacency.get(item.id) ?? [])].filter((n) => angles.has(n));
      if (!parents.length) return { item, want: Number.POSITIVE_INFINITY };
      // Mean of angles, taken on the unit circle so 350° and 10° average to 0°.
      let sx = 0;
      let sy = 0;
      for (const p of parents) {
        sx += Math.cos(angles.get(p)!);
        sy += Math.sin(angles.get(p)!);
      }
      return { item, want: Math.atan2(sy, sx) };
    });

    // Sort by preferred angle, then space evenly: the ring keeps its ordering
    // without nodes piling up where several paths happen to converge.
    preferred.sort((a, b) => {
      if (a.want === b.want) return a.item.id.localeCompare(b.item.id);
      return a.want - b.want;
    });

    const step = (Math.PI * 2) / Math.max(preferred.length, 1);
    // Rings grow apart enough that a crowded outer ring does not touch the one
    // inside it, and the first ring clears the hub label.
    const ringRadius = radius * (0.55 + d * 0.55) + Math.max(0, preferred.length - 8) * 4;

    preferred.forEach(({ item }, i) => {
      const a = startAngle + i * step;
      angles.set(item.id, a);
      out[item.id] = { x: cx + Math.cos(a) * ringRadius, y: cy + Math.sin(a) * ringRadius };
    });
  }

  return out;
}


