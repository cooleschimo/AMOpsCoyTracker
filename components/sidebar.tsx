'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  PanelLeftClose, PanelLeftOpen, Globe2, Layers, Radar, Eye, Network, ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The dashboard's standing controls, in one place.
 *
 * They used to be scattered: geography as three tab strips repeated inside each
 * section, place as a URL parameter with no visible home, sector not filterable
 * at all despite the taxonomy existing. The repeated tabs each kept their own
 * state, so "worth a conversation" could be showing International while "new on
 * the radar" showed the West Coast — the page could disagree with itself about
 * what the reader was looking at.
 *
 * Everything here writes to the URL rather than to component state. A filtered
 * view is then a link: it survives a refresh, it can be sent to someone, and
 * every section reads the same answer because there is only one.
 *
 * Collapsing is remembered per browser. A reader scanning cards wants the
 * counts out of the way; a reader narrowing wants them. Neither is the right
 * permanent default, so it is a choice rather than a breakpoint.
 *
 * The rail is fixed and overlays the page rather than sitting in the flow.
 * Displacing the grid meant opening the filters reflowed every card, and a
 * card that moves as you reach for it is worse than one briefly covered. The
 * page reserves only the collapsed width, so its layout never changes.
 */

const PLACES = [
  { id: 'west_coast', label: 'West Coast' },
  { id: 'other_us', label: 'Rest of US' },
  { id: 'non_us', label: 'International' },
] as const;

export type SidebarCounts = {
  sections: Array<{ id: string; label: string; n: number }>;
  places: Record<string, number>;
  sectors: Array<{ id: string; label: string; n: number }>;
  monitoring: number;
  awaiting: number;
};

const STORAGE_KEY = 'sidebar_collapsed';

export function Sidebar({ counts }: { counts: SidebarCounts }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  /*
   * Starts expanded and corrects itself after mount rather than reading storage
   * during render: the server has no localStorage, and rendering a collapsed
   * rail the server called expanded is a hydration mismatch.
   */
  const [collapsed, setCollapsed] = useState(false);

  /*
   * Which section the page is parked on.
   *
   * These are jump links, but the browser leaves the hash in the URL after one,
   * so a row stayed lit with no way to put it out — the sidebar looked like a
   * filter that had latched. Tracking the hash makes the highlight true, and
   * clicking the lit row clears it.
   */
  const [here, setHere] = useState('');
  useEffect(() => {
    const read = () => setHere(window.location.hash.slice(1));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const jumpTo = (id: string) => {
    if (here === id) {
      // Already there: clear the mark and leave the page where it is. Putting
      // the reader back at the top would undo the scroll they just made.
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setHere('');
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
    setHere(id);
  };

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setCollapsed(true);
    } catch { /* private browsing; the default stands */ }
  }, []);

  const toggle = () => {
    setCollapsed((v) => {
      try { localStorage.setItem(STORAGE_KEY, v ? '0' : '1'); } catch { /* not essential */ }
      return !v;
    });
  };

  /** Set or clear one filter, keeping every other one. */
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null || next.get(key) === value) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const geo = params.get('geo');
  const sector = params.get('sector');
  const place = params.get('place');

  if (collapsed) {
    return (
      <nav className="fixed left-0 top-0 z-30 flex h-dvh w-12 flex-col items-center gap-1 border-r border-border bg-card/80 py-4 backdrop-blur">
        <IconButton onClick={toggle} title="Show filters" Icon={PanelLeftOpen} />
        <div className="my-1 h-px w-6 bg-border" />
        {/* The filters that are ON stay visible while collapsed, because a
            narrowed page with no visible cause reads as a quiet week. */}
        {geo && <IconButton onClick={() => setParam('geo', null)} title={`Place: ${geo} — click to clear`} Icon={Globe2} active />}
        {sector && <IconButton onClick={() => setParam('sector', null)} title={`Sector: ${sector} — click to clear`} Icon={Layers} active />}
        {place && <IconButton onClick={() => setParam('place', null)} title={`${place} — click to clear`} Icon={Globe2} active />}
        <div className="flex-1" />
        <IconLink href="/monitoring" title="Monitoring" Icon={Eye} n={counts.monitoring} />
        <IconLink href="/awaiting-assessment" title="Awaiting assessment" Icon={ClipboardList} n={counts.awaiting} />
        <IconLink href="/graph" title="Connections" Icon={Network} />
      </nav>
    );
  }

  return (
    <nav className="fixed left-0 top-0 z-30 flex h-dvh w-52 flex-col gap-5 overflow-y-auto border-r border-border bg-card/95 px-3 py-4 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">This week</span>
        <IconButton onClick={toggle} title="Hide filters" Icon={PanelLeftClose} />
      </div>

      {/* Section counts. A jump link rather than a filter: the sections are all
          on the page, and this says how much is in each before scrolling. */}
      <Group>
        {counts.sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => jumpTo(s.id)}
            className={rowClass(here === s.id)}
          >
            <span className="truncate">{s.label}</span>
            <Count n={s.n} />
          </button>
        ))}
      </Group>

      <Group label="Place" icon={Radar}>
        {PLACES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setParam('geo', p.id)}
            className={rowClass(geo === p.id)}
          >
            <span className="truncate">{p.label}</span>
            <Count n={counts.places[p.id] ?? 0} />
          </button>
        ))}
      </Group>

      {counts.sectors.length > 0 && (
        <Group label="Sector" icon={Layers}>
          {counts.sectors.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setParam('sector', s.id)}
              className={rowClass(sector === s.id)}
            >
              <span className="truncate">{s.label}</span>
              <Count n={s.n} />
            </button>
          ))}
        </Group>
      )}

      {place && (
        <Group label="Filtered to">
          <button type="button" onClick={() => setParam('place', null)} className={rowClass(true)}>
            <span className="truncate">{place}</span>
            <span className="text-2xs text-muted-foreground">clear</span>
          </button>
        </Group>
      )}

      <div className="flex-1" />

      <Group>
        <Link href="/monitoring" className={rowClass(false)}>
          <span>Monitoring</span><Count n={counts.monitoring} />
        </Link>
        <Link href="/awaiting-assessment" className={rowClass(false)}>
          <span>Awaiting</span><Count n={counts.awaiting} />
        </Link>
        <Link href="/graph" className={rowClass(false)}>
          <span>Connections</span>
        </Link>
      </Group>
    </nav>
  );
}

const rowClass = (active: boolean) => cn(
  'flex w-full items-baseline justify-between gap-2 rounded-sm px-2 py-1 text-left text-xs transition-colors',
  active
    ? 'bg-primary/[0.08] font-medium text-foreground'
    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
);

function Count({ n }: { n: number }) {
  return (
    <span className={cn('num shrink-0 text-2xs', n === 0 && 'text-muted-foreground/40')}>{n}</span>
  );
}

function Group({
  label, icon: Icon, children,
}: {
  label?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      {label && (
        <div className="flex items-center gap-1.5 px-2 pb-1">
          {Icon && <Icon className="size-3 text-muted-foreground/70" />}
          <span className="text-2xs uppercase tracking-[0.12em] text-muted-foreground/70">{label}</span>
        </div>
      )}
      {children}
    </div>
  );
}

function IconButton({
  onClick, title, Icon, active,
}: {
  onClick: () => void;
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'rounded-sm p-1.5 transition-colors',
        active
          ? 'bg-primary/[0.08] text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function IconLink({
  href, title, Icon, n,
}: {
  href: string;
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  n?: number;
}) {
  return (
    <Link
      href={href}
      title={n === undefined ? title : `${title} (${n})`}
      aria-label={title}
      className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="size-4" />
    </Link>
  );
}
