/**
 * The card grid: rank order left to right, each card its own height.
 *
 * A masonry — dealing each card into whichever column is shortest — packs
 * tightly but only holds rank across the first row. After that a card lands
 * wherever the columns happen to be uneven, so the fifth-ranked company can sit
 * level with the eleventh and the reading order stops meaning anything.
 *
 * A grid with `items-start` reads correctly all the way down: row by row, left
 * to right, and every card sized to its own content rather than stretched to
 * the tallest in its row. The cost is ragged space beneath the short ones,
 * which is the right trade for a ranked list — the reader is looking for the
 * order, not for density.
 *
 * Column counts are the width a card needs at each step, working back from
 * roughly 300px a card plus the gaps. `auto-fit` would do this without the
 * breakpoints, but a card whose content can be narrow would then collapse
 * further than the design allows.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Masonry({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid items-start gap-8',
        'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
