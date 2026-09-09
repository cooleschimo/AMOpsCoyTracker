'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Search across companies, investors and people, from the header.
 *
 * SUGGESTIONS RATHER THAN A RESULTS PAGE. What a reader wants from a name they
 * have typed is that thing's page — not a list they then have to read and
 * choose from. So a match is one keystroke and one click away, and Enter takes
 * the top hit directly.
 *
 * Pressing Enter without a clear favourite still needs somewhere to go, and a
 * results route would be a page that exists only to hold a list the dropdown
 * was already showing. Instead the dropdown itself grows: the same panel, more
 * rows, and the reader stays on the week they were reading. Escape closes it
 * and the page beneath was never navigated away from.
 */

type Hit = {
  kind: 'company' | 'org' | 'person';
  id: number;
  name: string;
  detail: string | null;
};

const KIND_LABEL: Record<Hit['kind'], string> = {
  company: 'Company',
  org: 'Investor',
  person: 'Person',
};

const hrefFor = (h: Hit) =>
  h.kind === 'company' ? `/company/${h.id}` : h.kind === 'org' ? `/org/${h.id}` : `/person/${h.id}`;

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  /*
   * Debounced, and every response checked against the query that is current
   * when it lands. Typing outruns the network, so an earlier request can answer
   * after a later one and leave the list showing results for a prefix the
   * reader has already finished typing past.
   */
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(term)}&limit=${expanded ? 25 : 8}`,
        );
        const data = await res.json();
        if (!live) return;
        setHits(Array.isArray(data.hits) ? data.hits : []);
        setActive(0);
      } catch {
        if (live) setHits([]);
      } finally {
        if (live) setLoading(false);
      }
    }, 160);
    return () => { live = false; clearTimeout(t); };
  }, [q, expanded]);

  // Clicking anywhere else closes it, the same as any other menu.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  const go = (h: Hit) => {
    setOpen(false);
    setQ('');
    router.push(hrefFor(h));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); input.current?.blur(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Enter on a highlighted row goes there. Enter with nothing chosen opens
      // the full list in place, which is what a results page would have shown.
      if (hits[active]) go(hits[active]);
      else if (q.trim().length >= 2) setExpanded(true);
    }
  };

  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={box} className="relative">
      <div className="flex items-center gap-1.5 rounded-sm border border-border/70 bg-card/60 px-2 py-1 transition-colors focus-within:border-primary/50">
        <Search className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
        <input
          ref={input}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setExpanded(false); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search"
          aria-label="Search companies, investors and people"
          className="w-28 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 focus:w-44 sm:w-32 sm:focus:w-56"
          style={{ transition: 'width 160ms ease' }}
        />
      </div>

      {showPanel && (
        <div
          className={cn(
            'absolute right-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-md border border-border bg-popover shadow-lg',
            expanded && 'w-96',
          )}
        >
          {hits.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              {loading ? 'Searching…' : `Nothing matching “${q.trim()}”.`}
            </p>
          ) : (
            <>
              <ul className={cn('max-h-80 overflow-y-auto', expanded && 'max-h-[28rem]')}>
                {hits.map((h, i) => (
                  <li key={`${h.kind}-${h.id}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(h)}
                      className={cn(
                        'flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left transition-colors',
                        i === active ? 'bg-muted' : 'hover:bg-muted/60',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {h.name}
                        {h.detail && (
                          <span className="ml-2 text-2xs text-muted-foreground">{h.detail}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-2xs text-muted-foreground/60">
                        {KIND_LABEL[h.kind]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!expanded && hits.length >= 8 && (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="w-full border-t border-border px-3 py-1.5 text-left text-2xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Show everything matching “{q.trim()}”
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
