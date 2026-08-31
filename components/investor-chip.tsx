'use client';
/**
 * An investor, with its rounds on hover.
 *
 * A native `title` tooltip was carrying this: it takes a second to appear, is
 * easy to miss, and cannot be styled — so the detail was effectively hidden.
 * This uses the same hover card the rest of the app uses, so an investor reads
 * like every other explainable thing on the page.
 */
import Link from 'next/link';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';

export type InvestorChipProps = {
  href: string;
  name: string;
  isLead: boolean;
  rounds: string[];
  latestDate: string | null;
  source: string | null;
  sourceUrl: string | null;
  /** Only known for the company's most recent round, so it is labelled as that. */
  latestRoundAmount: string | null;
  latestRoundName: string | null;
};

export function InvestorChip({
  href,
  name,
  isLead,
  rounds,
  latestDate,
  source,
  latestRoundAmount,
  latestRoundName,
}: InvestorChipProps) {
  return (
    <HoverCard openDelay={90} closeDelay={80}>
      <HoverCardTrigger asChild>
        <Link
          href={href}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] no-underline transition-colors',
            isLead
              ? 'border-primary/30 bg-primary/[0.07] text-foreground hover:border-primary hover:bg-primary/15'
              : 'border-border bg-card text-foreground/85 hover:border-primary/40 hover:bg-primary/[0.07] hover:text-primary',
          )}
        >
          {name}
          {isLead && (
            <span className="text-[9px] uppercase tracking-[0.1em] text-primary">lead</span>
          )}
        </Link>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72">
        <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
          {isLead ? 'Lead investor' : 'Investor'}
        </p>
        <p className="mt-1 text-sm font-medium">{name}</p>

        {rounds.length > 0 ? (
          <dl className="mt-3 space-y-1">
            {rounds.map((r) => (
              <div key={r} className="flex items-baseline justify-between gap-x-4">
                <dt className="text-sm">{r}</dt>
                {/* Only the company's latest round has a known amount. Rounds
                    without one show nothing rather than a dash, which read as
                    a value of its own. */}
                {latestRoundAmount && r === latestRoundName ? (
                  <dd className="num text-sm text-muted-foreground">{latestRoundAmount}</dd>
                ) : null}
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No round recorded — this edge came from a portfolio listing.
          </p>
        )}

        <p className="mt-3 border-t border-border pt-2 text-2xs text-muted-foreground">
          {[latestDate ? `Latest ${latestDate}` : null, source].filter(Boolean).join(' · ')}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
