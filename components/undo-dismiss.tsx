'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clearDisposition } from '@/app/actions';

/**
 * Put a dismissed company back.
 *
 * The row disappears on success rather than staying with its state flipped: a
 * company that is no longer dismissed does not belong on a list of dismissals,
 * and leaving it there with an "undone" label makes the reader work out what
 * the list now means.
 *
 * A failure keeps the row and says so. The dismissal is still real in that
 * case, and a button that silently did nothing would leave the reader believing
 * the company is back when it is not.
 */
export function UndoDismiss({ companyId }: { companyId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <span className="flex shrink-0 items-baseline gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setFailed(false);
            const res = await clearDisposition(companyId);
            if (res.ok) router.refresh();
            else setFailed(true);
          })
        }
        className="cursor-pointer text-xs text-muted-foreground link-underline transition-colors hover:text-foreground disabled:opacity-50"
      >
        {pending ? 'Restoring…' : 'Restore'}
      </button>
      {failed && <span className="text-2xs text-destructive">could not restore</span>}
    </span>
  );
}
