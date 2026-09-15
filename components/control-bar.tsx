'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Globe2, Layers, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SearchBox } from '@/components/search-box';

/**
 * The dashboard's standing controls, across the top.
 *
 * They were a fixed left rail, which put two navigation surfaces on screen at
 * once: the rail listed the sections and the geographies, and so did the page.
 * "Worth a conversation" rendered four times on one screen. A bar spanning the
 * top has room for the same controls on ONE line, so nothing is repeated and
 * nothing overlays the cards.
 *
 * It is open on landing, because a reader arriving has not chosen anything yet
 * and the filters are the fastest way to say what they came for. Once they
 * scroll they have chosen — they are reading cards — so it shrinks to icons and
 * gives the height back. Touching it brings it back at any scroll position, so
 * the controls are never more than a cursor away.
 *
 * The bar reserves its own collapsed height and the page never reflows: only
 * the bar's internals change between states, so a card cannot move under a
 * reader who is reaching for it.
 */

const PLACES = [
  { id: 'west_coast', label: 'West Coast' },
  { id: 'other_us', label: 'Rest of US' },
  { id: 'non_us', label: 'International' },
  // The dashboard opens on the West Coast, so seeing everything is a choice a
  // reader makes rather than the absence of one.
  { id: 'all', label: 'Everywhere' },
] as const;

export type ControlCounts = {
  places: Record<string, number>;
  sectors: Array<{ id: string; label: string; n: number }>;
  monitoring: number;
  awaiting: number;
};

export function ControlBar({
  counts,
  masthead,
  summary,
}: {
  counts: ControlCounts;
  /** Title and week. Stays visible in both states — it is what the page IS. */
  masthead: React.ReactNode;
  /** The week's numbers. Shown open, dropped when the bar shrinks. */
  summary: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /*
   * Two independent reasons to be open: the reader is at the top of the page,
   * or their cursor is on the bar. Kept apart so moving the cursor away while
   * still at the top does not collapse a bar that should be open anyway.
   */
  const [scrolled, setScrolled] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = !scrolled || hovered;

  useEffect(() => {
    /*
     * Two thresholds, not one.
     *
     * Collapsing shortens the bar by around 180px, which lengthens the
     * scrollable page by the same amount. On a page scrolled near its end
     * there is no room to grow, so the browser reduces scrollY instead — back
     * under a single threshold, which re-expands the bar, which restores the
     * scroll position, which collapses it again. The bar flickers at a rate
     * set by how fast React can re-render.
     *
     * A gap wider than the height the bar gives up breaks the loop: the
     * position the collapse lands on is still above the re-expand line.
     */
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled((was) => (was ? y > 40 : y > 260));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /**
   * Set or clear one filter, keeping every other one.
   *
   * `clearable: false` is for a filter with a default: clicking the active
   * geography would otherwise remove the param and land back on the West
   * Coast, which looks like the click did nothing.
   */
  const setParam = (key: string, value: string | null, opts?: { clearable?: boolean }) => {
    const next = new URLSearchParams(params.toString());
    const clearing = value === null
      || (next.get(key) === value && opts?.clearable !== false);
    if (clearing) next.delete(key);
    else if (value !== null) next.set(key, value);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const NAV = [
    { href: '/', label: 'This week', count: undefined as number | undefined,
      icon: undefined as React.ComponentType<{ className?: string }> | undefined },
    { href: '/monitoring', label: 'Monitoring', count: counts.monitoring },
    { href: '/awaiting-assessment', label: 'Awaiting', count: counts.awaiting },
    { href: '/graph', label: 'Connections', count: undefined as number | undefined },
    // An icon rather than a word: this is the way back from a misclick, not a
    // fourth way to read the week, and naming it would give it the same weight
    // as the sections that carry the work.
    { href: '/dismissed', label: '', icon: Trash2, count: undefined as number | undefined },
  ];

  // No geography in the URL means the West Coast, matching what the page
  // renders — the pill has to show that, or the dashboard opens filtered with
  // nothing on the bar saying so.
  const geo = params.get('geo') ?? 'west_coast';
  const sector = params.get('sector');
  const place = params.get('place');
  const anyFilter = Boolean((geo && geo !== 'all') || sector || place);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="glass-bar sticky top-0 z-30 -mx-6 mb-10 border-b border-border sm:-mx-12 lg:-mx-16"
    >
      <div className="mx-auto max-w-[1400px] px-6 sm:px-12 lg:px-16">
        {/*
          * ROW 1 — identity and navigation, always visible.
          *
          * One baseline, three things on it: who this is, which week, where
          * else to go. The week sits next to the title rather than opposite it,
          * because they are one statement — "Good AM, 7-13 September" — and
          * pushing them to opposite ends of a 1400px bar made a reader's eye
          * travel the whole width to finish a phrase. The links go right, which
          * is the only thing here that is not about this page.
          */}
        <div
          className={cn(
            'flex items-baseline justify-between gap-x-8 transition-[padding] duration-200',
            open ? 'pt-7 pb-3' : 'py-3',
          )}
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            {masthead}
          </div>
          <div className="flex shrink-0 items-center gap-x-5">
            <SearchBox />
          <nav className="flex items-baseline gap-x-5">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={pathname === n.href ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap text-xs transition-colors',
                  n.icon && 'inline-flex items-center self-center',
                  pathname === n.href
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title={n.icon ? 'Dismissed' : undefined}
              >
                {n.icon ? (
                  <>
                    <n.icon className="size-3.5" aria-hidden />
                    <span className="sr-only">Dismissed</span>
                  </>
                ) : (
                  n.label
                )}
                {n.count !== undefined && n.count > 0 && (
                  <span className="num ml-1 text-2xs text-muted-foreground/60">{n.count}</span>
                )}
              </Link>
            ))}
            </nav>
          </div>
        </div>

        {/*
          * ROW 2 — the week's numbers and the filters, on one line.
          *
          * They were two stacked blocks with their own rules and spacing, which
          * is what made the bar look assembled rather than designed. They are
          * the same kind of thing — what this page is showing — so they share a
          * line: the count on the left, what narrows it on the right.
          */}
        <div
          className={cn(
            'overflow-hidden transition-all duration-200',
            open ? 'max-h-40 pb-4 opacity-100' : 'max-h-0 opacity-0',
          )}
          aria-hidden={!open}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-3 border-t border-border/60 pt-3">
            {summary}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <FilterRow icon={Globe2} label="Place">
                {PLACES.map((p) => (
                  <Pill
                    key={p.id}
                    active={geo === p.id}
                    n={counts.places[p.id] ?? 0}
                    onClick={() => setParam('geo', p.id, { clearable: false })}
                  >
                    {p.label}
                  </Pill>
                ))}
              </FilterRow>

              {counts.sectors.length > 0 && (
                <FilterRow icon={Layers} label="Sector">
                  {counts.sectors.slice(0, 5).map((s) => (
                    <Pill
                      key={s.id}
                      active={sector === s.id}
                      n={s.n}
                      onClick={() => setParam('sector', s.id)}
                    >
                      {s.label}
                    </Pill>
                  ))}
                </FilterRow>
              )}

              {place && <Chip label={place} onClear={() => setParam('place', null)} />}
            </div>
          </div>
        </div>

        {/*
          * Shrunk, the filters leave one line behind. A narrowed page with no
          * visible cause reads as a quiet week, so what is ON stays legible
          * even when the controls are away.
          */}
        {!open && anyFilter && (
          <div className="flex items-center gap-2 pb-2.5">
            {geo && geo !== 'all' && <Chip label={PLACES.find((p) => p.id === geo)?.label ?? geo} onClear={() => setParam('geo', 'all')} />}
            {sector && <Chip label={counts.sectors.find((s) => s.id === sector)?.label ?? sector} onClear={() => setParam('sector', null)} />}
            {place && <Chip label={place} onClear={() => setParam('place', null)} />}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3 shrink-0 text-muted-foreground/50" aria-hidden />
      <span className="sr-only">{label}</span>
      {/* Hairline-separated rather than spaced: the pills are one control, and
          a gap alone let them read as three unrelated buttons. */}
      <div className="flex flex-wrap items-center">{children}</div>
    </div>
  );
}

function Pill({
  active,
  n,
  onClick,
  children,
}: {
  active: boolean;
  n: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'cursor-pointer rounded-sm px-2 py-0.5 text-xs transition-colors',
        active
          ? 'bg-primary/[0.1] font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
      <span className={cn('num ml-1.5 text-2xs', n === 0 ? 'text-muted-foreground/40' : 'text-muted-foreground/70')}>
        {n}
      </span>
    </button>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      title={`${label} — click to clear`}
      className="cursor-pointer rounded-full bg-primary/[0.1] px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-primary/20"
    >
      {label}
      <span className="ml-1.5 text-muted-foreground">×</span>
    </button>
  );
}
