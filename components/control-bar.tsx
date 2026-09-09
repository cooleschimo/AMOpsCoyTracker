'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Globe2, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

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
    // A threshold rather than any scroll at all: a page that flinches at two
    // pixels of trackpad drift reads as unstable.
    const onScroll = () => setScrolled(window.scrollY > 120);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /** Set or clear one filter, keeping every other one. */
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null || next.get(key) === value) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const NAV = [
    { href: '/', label: 'This week', count: undefined as number | undefined },
    { href: '/monitoring', label: 'Monitoring', count: counts.monitoring },
    { href: '/awaiting-assessment', label: 'Awaiting', count: counts.awaiting },
    { href: '/graph', label: 'Connections', count: undefined as number | undefined },
  ];

  const geo = params.get('geo');
  const sector = params.get('sector');
  const place = params.get('place');
  const anyFilter = Boolean(geo || sector || place);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="sticky top-0 z-30 -mx-6 mb-10 border-b border-border bg-background/85 backdrop-blur sm:-mx-12 lg:-mx-16"
    >
      <div className="mx-auto max-w-[1400px] px-6 sm:px-12 lg:px-16">
        {/* The masthead is the one part that never collapses: shrunk, it is the
            line that says which page and which week you are on, and losing it
            would leave a bare strip of filter chips. */}
        <div
          className={cn(
            'flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 transition-all duration-200',
            open ? 'pt-8 pb-1' : 'py-2',
          )}
        >
          <div className="min-w-0 flex-1">{masthead}</div>
          {/* The page links ride with the masthead rather than in a bar of
              their own. They were a second fixed strip above this one, saying
              Monitoring and Connections while this bar said the same in icons.
              Here they stay reachable at any scroll position, which is what the
              separate bar was really for. */}
          <nav className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={pathname === n.href ? 'page' : undefined}
                className={cn(
                  'text-xs transition-colors',
                  pathname === n.href
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {n.label}
                {n.count !== undefined && n.count > 0 && (
                  <span className="num ml-1 text-2xs text-muted-foreground/60">{n.count}</span>
                )}
              </Link>
            ))}
          </nav>
        </div>

        <div
          className={cn(
            'overflow-hidden transition-all duration-200',
            open ? 'h-auto pb-5 opacity-100' : 'h-0 opacity-0',
          )}
          aria-hidden={!open}
        >
          {summary}
        </div>
        {/* Closed: a single quiet strip. Only what is ON stays legible, because
            a narrowed page with no visible cause reads as a quiet week. */}
        <div
          className={cn(
            'flex items-center gap-3 overflow-hidden transition-all duration-200',
            open ? 'h-0 opacity-0' : 'h-10 opacity-100',
          )}
          aria-hidden={open}
        >
          <span className="text-2xs uppercase tracking-[0.14em] text-muted-foreground/70">
            Filters
          </span>
          {anyFilter ? (
            <span className="flex items-center gap-2 text-xs">
              {geo && <Chip label={PLACES.find((p) => p.id === geo)?.label ?? geo} onClear={() => setParam('geo', null)} />}
              {sector && <Chip label={counts.sectors.find((s) => s.id === sector)?.label ?? sector} onClear={() => setParam('sector', null)} />}
              {place && <Chip label={place} onClear={() => setParam('place', null)} />}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/60">everywhere · every sector</span>
          )}
        </div>

        {/* Open: the controls themselves, on one row. */}
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-6 gap-y-2 overflow-hidden transition-all duration-200',
            open ? 'h-auto py-2.5 opacity-100' : 'h-0 py-0 opacity-0',
          )}
          aria-hidden={!open}
        >
          <FilterRow icon={Globe2} label="Place">
            {PLACES.map((p) => (
              <Pill
                key={p.id}
                active={geo === p.id}
                n={counts.places[p.id] ?? 0}
                onClick={() => setParam('geo', p.id)}
              >
                {p.label}
              </Pill>
            ))}
          </FilterRow>

          {counts.sectors.length > 0 && (
            <FilterRow icon={Layers} label="Sector">
              {counts.sectors.map((s) => (
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

          {place && (
            <div className="ml-auto flex items-center gap-1">
              <Chip label={place} onClear={() => setParam('place', null)} />
            </div>
          )}
        </div>
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
    <div className="flex items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
      <span className="sr-only">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
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
        'cursor-pointer rounded-full px-2.5 py-1 text-xs transition-colors',
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
