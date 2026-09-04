'use client';

import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setLocation } from '@/app/actions';
import { cn } from '@/lib/utils';

/**
 * The company's location: click to see everyone else there, pencil to correct.
 *
 * Filtering is what a reader actually wants from a place name — "who else is in
 * Boston" is a question the list can answer, and it is asked far more often
 * than a correction is needed. So the location itself is the filter, and
 * editing moves to a small pencil that appears on hover.
 *
 * Correcting still has to be possible, because location decides which
 * geography tab a company appears under and a wrong one hides it from the
 * person looking for it. For a news-discovered company it is read out of
 * headlines rather than filed anywhere: Carbon Robotics sat in Mountain View
 * until the news search moved it to Seattle.
 *
 * How it was derived is on hover rather than beside the name. A reader scanning
 * the list wants the place; only someone who doubts it needs the provenance.
 */
const SOURCE_NOTE: Record<string, string> = {
  researched: 'Hand-researched.',
  form_d: 'From the company’s own SEC filing.',
  news: 'Read from the headline that surfaced this company — a guess, not a filed address.',
  news_search: 'Read from the news written about this company.',
  manual: 'Set by hand.',
};

export function LocationEdit({
  companyId,
  hq,
  source,
}: {
  companyId: number;
  hq: string;
  source: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(hq === 'Unknown' ? '' : hq);
  const [shown, setShown] = useState(hq);
  const [pending, start] = useTransition();

  const save = () => {
    const raw = value.trim();
    if (!raw) { setEditing(false); return; }
    // "City, ST" or "City, Country" — the same shape the pipeline stores.
    const [city, ...rest] = raw.split(',').map((p) => p.trim());
    if (!city) { setEditing(false); return; }
    const tail = rest.join(', ');
    start(async () => {
      const res = await setLocation(companyId, city, tail);
      if (res.ok) { setShown([city, tail].filter(Boolean).join(', ')); setEditing(false); }
    });
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') { setValue(shown === 'Unknown' ? '' : shown); setEditing(false); }
        }}
        placeholder="City, ST"
        className={cn(
          'w-40 border-b border-primary bg-transparent text-xs outline-none',
          pending && 'opacity-50',
        )}
      />
    );
  }

  const unknown = shown === 'Unknown' || !shown;
  const active = params.get('place') === shown;

  const filter = () => {
    const next = new URLSearchParams(params.toString());
    // Clicking the place already filtered on clears it, so the same control
    // both narrows and restores.
    if (active) next.delete('place'); else next.set('place', shown);
    const qs = next.toString();
    router.push(qs ? `/?${qs}` : '/', { scroll: false });
  };

  return (
    <span className="group/loc inline-flex items-baseline gap-1">
      {unknown ? (
        <span className="text-xs italic text-muted-foreground/60">Location unknown</span>
      ) : (
        <button
          type="button"
          onClick={filter}
          title={`${SOURCE_NOTE[source ?? ''] ?? 'Source unrecorded.'} Click to see everyone in ${shown}.`}
          className={cn(
            'text-xs underline-offset-2 hover:underline',
            active ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {shown}
        </button>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Correct this location"
        title="Correct this location"
        className={cn(
          'opacity-0 transition-opacity group-hover/loc:opacity-100 focus:opacity-100',
          'text-muted-foreground/70 hover:text-foreground',
          unknown && 'opacity-100',
        )}
      >
        <Pencil className="size-2.5" aria-hidden />
      </button>
    </span>
  );
}
