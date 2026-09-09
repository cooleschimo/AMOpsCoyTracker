'use client';
/**
 * The control that turns a possible path into a reviewed one. Brief §8.
 *
 * `lib/paths.ts` opens with the rule this closes: graph structure never
 * establishes warmth. Public evidence connects two entities; only a person
 * knows whether EDB can actually use the connection. Every path was therefore
 * stuck at `unreviewed` — the table had a column for a human judgment and no
 * way for a human to enter one.
 *
 * A review is about the CONNECTOR, not the row. A partner linking this company
 * to four others is one relationship and one judgment, which is why the key is
 * the person or organisation rather than the path, and why the label says how
 * many routes the answer covers.
 *
 * The status is applied optimistically and rolled back if the write fails: the
 * alternative is a select that snaps back for no visible reason, which reads as
 * the page being broken rather than the save being.
 */
import { useState, useTransition } from 'react';
import { reviewPath } from '../app/actions';
import {
  PATH_REVIEW_STATUSES, PATH_REVIEW_LABELS, PATH_REVIEW_HELP,
  type PathKind, type PathReviewStatus,
} from '../lib/ui-types';

const SELECT = 'w-full rounded-sm border border-input bg-card px-1.5 py-1 text-2xs';
const NOTE = 'mt-1 w-full rounded-sm border border-input bg-card px-1.5 py-1 text-2xs';
const META = 'mt-1 block text-2xs text-muted-foreground';

export function PathReview({
  companyId, pathKind, viaPersonId, viaOrgId, status, internalOwner, note, doNotUse, routes,
}: {
  companyId: number;
  pathKind: PathKind;
  viaPersonId: number | null;
  viaOrgId: number | null;
  status: PathReviewStatus;
  internalOwner?: string | null;
  note?: string | null;
  doNotUse?: boolean;
  /** How many destinations this one connector reaches. */
  routes: number;
}) {
  const [current, setCurrent] = useState<PathReviewStatus>(status);
  const [owner, setOwner] = useState(internalOwner ?? '');
  const [showOwner, setShowOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = (next: PathReviewStatus, nextOwner = owner) => {
    const previous = current;
    setCurrent(next);
    setError(null);
    start(async () => {
      const res = await reviewPath({
        companyId, pathKind, viaPersonId, viaOrgId,
        status: next,
        internalOwner: nextOwner || null,
        note: note ?? null,
        doNotUse,
      });
      if (!res.ok) {
        setCurrent(previous);
        setError(res.error);
      }
    });
  };

  return (
    <div className={pending ? 'opacity-60' : undefined}>
      <select
        className={SELECT}
        value={current}
        disabled={pending}
        title={PATH_REVIEW_HELP[current]}
        onChange={(e) => {
          const next = e.target.value as PathReviewStatus;
          save(next);
          // Who can make the introduction is the useful half of "usable", and
          // asking for it after the answer keeps the common case one click.
          if (next === 'usable') setShowOwner(true);
        }}
      >
        {PATH_REVIEW_STATUSES.map((s) => (
          <option key={s} value={s}>{PATH_REVIEW_LABELS[s]}</option>
        ))}
      </select>

      {showOwner || (current === 'usable' && owner) ? (
        <input
          className={NOTE}
          placeholder="who can make it"
          value={owner}
          disabled={pending}
          onChange={(e) => setOwner(e.target.value)}
          onBlur={() => save(current, owner)}
        />
      ) : null}

      {owner && !showOwner && current === 'usable' ? (
        <span className={META}>via {owner}</span>
      ) : null}

      {routes > 1 ? (
        <span className={META}>covers {routes} routes</span>
      ) : null}

      {error ? <span className="mt-1 block text-2xs text-destructive">{error}</span> : null}
    </div>
  );
}
