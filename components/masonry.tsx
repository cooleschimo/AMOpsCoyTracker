'use client';
/**
 * Masonry that preserves rank order across the row.
 *
 * CSS columns give the packing for free but fill top-to-bottom, so the
 * second-ranked company lands under the first rather than beside it. A plain
 * grid reads in the right order but stretches every row to its tallest card,
 * which leaves ragged space under the short ones.
 *
 * This deals cards into columns in rank order, always into whichever column is
 * currently shortest. Rank still reads left-to-right along the first row, and
 * no card leaves a gap beneath it.
 *
 * The trade is that columns drift out of step further down a long list — card
 * 14 may sit level with card 11. That is inherent to packing unequal heights,
 * and near the top, where the ranking matters most, the order reads correctly.
 */
import { Children, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** useLayoutEffect warns during SSR; on the server there is nothing to measure. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Column count from the CONTAINER's width, not the viewport's.
 *
 * These are not the viewport breakpoints: the page caps at 1400px and pads to
 * about 1336px of usable width, so a viewport-scaled threshold of 1536px could
 * never be met and the grid capped itself at three columns — two on any normal
 * laptop. The numbers below are the width a card needs at each count, working
 * back from roughly 300px a card plus the gaps.
 */
function columnsForWidth(width: number): number {
  if (width >= 1240) return 4;
  if (width >= 940) return 3;
  if (width >= 620) return 2;
  return 1;
}

export function Masonry({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children);
  const hostRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  const [order, setOrder] = useState<number[][] | null>(null);

  // Track the column count from the container, not the viewport: the same
  // component is used inside a full-width page and a narrower section.
  useIsomorphicLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const apply = () => setCols(columnsForWidth(el.getBoundingClientRect().width));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Heights are measured once, from the single-column render, and kept. After
  // dealing the cards into columns the DOM no longer holds them in rank order,
  // so re-measuring then would read the wrong element for each index.
  const heightsRef = useRef<number[] | null>(null);

  useIsomorphicLayoutEffect(() => {
    const el = measureRef.current;
    if (el && !heightsRef.current) {
      heightsRef.current = Array.from(el.children).map((c) => (c as HTMLElement).offsetHeight);
    }
    if (cols < 2) {
      setOrder(null);
      return;
    }
    const heights = heightsRef.current;
    if (!heights) return;

    // Deal in rank order, each card into whichever column is shortest so far:
    // the first row reads 1, 2, 3 across, and no card leaves a gap beneath it.
    const buckets: number[][] = Array.from({ length: cols }, () => []);
    const totals = new Array<number>(cols).fill(0);
    items.forEach((_, i) => {
      let shortest = 0;
      for (let c = 1; c < cols; c++) if (totals[c]! < totals[shortest]!) shortest = c;
      buckets[shortest]!.push(i);
      totals[shortest] = totals[shortest]! + (heights[i] ?? 0);
    });
    setOrder(buckets);
  }, [cols, items.length]);

  // A width change alters how text wraps, so cached heights go stale. Clearing
  // them sends the component back through a single-column measure pass.
  useIsomorphicLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let last = el.getBoundingClientRect().width;
    const ro = new ResizeObserver(() => {
      const now = el.getBoundingClientRect().width;
      if (Math.abs(now - last) < 1) return;
      last = now;
      heightsRef.current = null;
      setOrder(null);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One column, or before measurement: render in plain order. This is also what
  // the server sends, so the page is complete and correctly ordered without JS.
  if (cols < 2 || !order) {
    return (
      <div ref={hostRef} className={className}>
        <div ref={measureRef} className="flex flex-col gap-5">
          {items}
        </div>
      </div>
    );
  }

  return (
    <div ref={hostRef} className={className}>
      <div className="flex gap-5">
        {order.map((column, c) => (
          <div key={c} className="flex min-w-0 flex-1 flex-col gap-5">
            {column.map((i) => items[i])}
          </div>
        ))}
      </div>
    </div>
  );
}
