'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Go back to an earlier week.
 *
 * Each week's digest is a record of what was known at the time, and re-running
 * the pipeline later cannot reconstruct it: the news window has moved and the
 * rubric may have changed since. Keeping the weeks reachable is what makes
 * "what did we think in August" answerable — and what lets an RD check whether
 * a company they passed on has since done something.
 *
 * A small calendar rather than a select, because this is a rare action. It
 * should not occupy the same visual weight as the sections it sits beside.
 */
export function WeekPicker({
  weeks,
  current,
}: {
  weeks: Array<{ weekOf: string; label: string; companies: number }>;
  current: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const params = useSearchParams();

  // Close on an outside click or Escape: a popover that traps the reader is
  // worse than no popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (weeks.length < 2) return null;

  // Keep whatever else is filtered when changing week; the place a reader is
  // looking at is still the place they want in another week.
  const hrefFor = (weekOf: string) => {
    const next = new URLSearchParams(params.toString());
    if (weekOf === weeks[0]?.weekOf) next.delete('week'); else next.set('week', weekOf);
    const qs = next.toString();
    return qs ? `/?${qs}` : '/';
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Choose a week"
        title="Choose a week"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs transition-colors',
          'text-muted-foreground hover:bg-muted hover:text-foreground',
          open && 'bg-muted text-foreground',
        )}
      >
        <CalendarDays className="size-3.5" aria-hidden />
        <span className="sr-only">Choose a week</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-border bg-popover p-1 shadow-md">
          {weeks.map((w) => (
            <Link
              key={w.weekOf}
              href={hrefFor(w.weekOf)}
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-baseline justify-between gap-3 rounded-sm px-2.5 py-1.5 text-sm',
                w.weekOf === current
                  ? 'bg-primary/[0.07] font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span>{w.label}</span>
              <span className="num shrink-0 text-2xs text-muted-foreground">{w.companies}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
