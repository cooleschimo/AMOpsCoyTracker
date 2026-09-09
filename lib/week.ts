/**
 * What a week is, in one place. Brief §7.
 *
 * Weeks run SATURDAY to FRIDAY, and `week_of` is the Saturday.
 *
 * They used to run Monday to Sunday, which put the boundary in the middle of
 * the working week's news: a story published on Thursday belonged to the week
 * that had started three days earlier, but the Monday run that read it stamped
 * the NEW Monday, so PlusAI's Thursday SPAC deal appeared under "this week"
 * when it had happened last week. A Saturday anchor puts the boundary in the
 * weekend lull instead, where almost nothing publishes, so a story and the run
 * that reads it land in the same week.
 *
 * The date is the RUN's week, not the news's. Ingestion runs daily at a median
 * lag of one day, so a story breaking Monday is read on Tuesday and both fall
 * inside the same Saturday-to-Friday span. Deriving the week from the news
 * instead would fight the thirty-day scoring window, where a company is judged
 * on evidence that has no single date.
 *
 * Everything here is UTC. The pipeline runs on a UTC schedule and the database
 * stores dates without a zone, so a local-time week would drift by a day
 * depending on where the reader sits.
 */

const DAY_MS = 86_400_000;

/** Saturday of the week containing `d`, as YYYY-MM-DD. */
export function weekOfSaturday(d: Date = new Date()): string {
  // getUTCDay: Sunday 0 … Saturday 6. Days since the most recent Saturday.
  const since = (d.getUTCDay() + 1) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - since))
    .toISOString().slice(0, 10);
}

/** The Saturday a week before the current one — what a digest looks back at. */
export function lastWeekSaturday(d: Date = new Date()): string {
  return new Date(new Date(`${weekOfSaturday(d)}T00:00:00Z`).getTime() - 7 * DAY_MS)
    .toISOString().slice(0, 10);
}

/** The Friday that closes the week starting on `saturday`. */
export function weekEnd(saturday: string | Date): Date {
  const start = saturday instanceof Date ? saturday : new Date(`${saturday}T00:00:00Z`);
  return new Date(start.getTime() + 6 * DAY_MS);
}

/**
 * The week as a reader would say it: "30 August – 5 September".
 *
 * The month is repeated when the range spans two, because "30 August – 5"
 * reads wrong; it is dropped from the opening date otherwise.
 */
export function weekRangeLabel(weekOf?: string | Date | null): string {
  const start = weekOf
    ? (weekOf instanceof Date ? weekOf : new Date(`${String(weekOf).slice(0, 10)}T00:00:00Z`))
    : new Date(`${weekOfSaturday()}T00:00:00Z`);
  const end = weekEnd(start);
  const month = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  const day = (d: Date) => d.getUTCDate();
  return month(start) === month(end)
    ? `${day(start)}–${day(end)} ${month(end)}`
    : `${day(start)} ${month(start)} – ${day(end)} ${month(end)}`;
}
