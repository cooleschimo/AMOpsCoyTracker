'use client';

import { useState } from 'react';
import { CompanyCase } from '@/components/company-case';
import { Masonry } from '@/components/masonry';
import { SectionHeading } from '@/components/primitives';
import type { DashboardCompany } from '@/lib/ui-types';
import { cn } from '@/lib/utils';

/**
 * A section with its own geography filter.
 *
 * The tabs sit inside the section rather than above the page because the
 * question is asked per section: an RD reading *worth a conversation* wants the
 * Bay Area first, and then wants to know what else is out there without losing
 * their place in the list they were reading.
 *
 * Three buckets, in the order attention actually runs. The Bay Area is the core
 * of the target list; the rest of the US is in scope on the same terms; and
 * everywhere else is worth seeing but is a different conversation, so it is
 * last and never the default.
 *
 * A tab with nothing in it is shown with a zero rather than hidden — an empty
 * count is information, where a missing tab reads as a bug.
 */
const TABS = [
  { id: 'bay_area', label: 'Bay Area' },
  { id: 'other_us', label: 'Rest of US' },
  { id: 'non_us', label: 'International' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function GeographySection({
  title,
  companies,
  empty,
}: {
  title: string;
  companies: DashboardCompany[];
  empty: string;
}) {
  const counts = {
    bay_area: companies.filter((c) => c.geography === 'bay_area').length,
    other_us: companies.filter((c) => c.geography === 'other_us').length,
    non_us: companies.filter((c) => c.geography === 'non_us').length,
  };

  // Open on the first tab that has anything, so a week with no Bay Area
  // activity does not greet the reader with an empty list.
  const [active, setActive] = useState<TabId>(
    counts.bay_area > 0 ? 'bay_area' : counts.other_us > 0 ? 'other_us' : 'non_us',
  );
  const shown = companies.filter((c) => c.geography === active);

  return (
    <section className="space-y-4">
      <SectionHeading
        title={title}
        right={
          <span className="num text-2xs text-muted-foreground">
            {companies.length} {companies.length === 1 ? 'company' : 'companies'}
          </span>
        }
      />

      <div className="flex flex-wrap items-center gap-1 border-b border-[color:var(--hairline)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={cn(
              'relative -mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              active === t.id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            <span className="num ml-1.5 text-2xs text-muted-foreground">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {companies.length === 0 ? empty : `Nothing in ${TABS.find((t) => t.id === active)?.label} this week.`}
        </p>
      ) : (
        <Masonry className="dense-cards">
          {shown.map((c) => (
            <CompanyCase key={c.id} company={c} />
          ))}
        </Masonry>
      )}
    </section>
  );
}
