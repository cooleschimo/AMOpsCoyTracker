'use client';

import { actions, useDropped } from '@/lib/dashboard-store';
import { QuietButton } from './primitives';

/**
 * Stop monitoring a company.
 *
 * Monitoring is open-ended by design: a company put here stays visible even in
 * the weeks it does nothing, which is the point of the page. But a list that
 * only ever grows stops being a watchlist and becomes a graveyard, and the
 * reason to stop watching is usually the honest one — it has been quiet long
 * enough, or it turned out not to be what it looked like.
 *
 * Distinct from the dashboard's Undo, which means the click was a mistake and
 * puts the company back in the discovery list. This means the watch ran its
 * course. `dropFromMonitoring` sets `removed_at` rather than deleting: how long
 * a company sat monitored is evidence about the judgement, and a deleted row
 * cannot say that.
 *
 * The card stays on the page after the click, greyed, until the next load. A
 * card vanishing under the cursor gives no chance to notice a misclick, and the
 * undo has to be somewhere.
 */
export function MonitoringDrop({ companyId }: { companyId: string }) {
  const droppedAt = useDropped(companyId);

  if (droppedAt) {
    return (
      <span className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span>No longer monitored</span>
        <button
          type="button"
          onClick={() => actions.restoreToMonitoring(companyId)}
          className="link-underline hover:text-foreground"
        >
          Undo
        </button>
      </span>
    );
  }

  return (
    <div className="mt-1.5">
      <QuietButton
        onClick={() => actions.dropFromMonitoring(companyId)}
        title="Stop watching this company. The record of how long it was monitored is kept."
      >
        Stop monitoring
      </QuietButton>
    </div>
  );
}
