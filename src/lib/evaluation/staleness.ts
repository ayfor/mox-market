// The staleness clock (C1.31; S2.1d12): the history line's 36-hour flag, the
// global banner's 48-hour rule, and the relative time the history line shows.
// Pure: the caller passes `now`.
import { RELATIVE_TIME_WORDS } from "@/lib/copy/result-labels";
import { STALE_BANNER_HOURS, STALENESS_FLAG_HOURS } from "./consts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** relativeTime counts in hours below this, in days from it (S2.1d12). */
const HOURS_SHOWN_BELOW_MS = 48 * HOUR_MS;

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && !Number.isNaN(value.getTime());

/**
 * The history line's stale flag: latestSnapshotAt exists and is more than
 * STALENESS_FLAG_HOURS before now. Null, an invalid date and a future date
 * are not stale (F2 §UI: the flag needs a snapshot).
 */
export function isHistoryStale(
  latestSnapshotAt: Date | null,
  now: Date,
): boolean {
  if (!isValidDate(latestSnapshotAt)) return false;
  return (
    now.getTime() - latestSnapshotAt.getTime() > STALENESS_FLAG_HOURS * HOUR_MS
  );
}

/**
 * The global banner: no successful sync yet (null), an unreadable date, or a
 * last success more than STALE_BANNER_HOURS before now. A future date is not
 * stale.
 */
export function isSyncStale(lastSuccessAt: Date | null, now: Date): boolean {
  if (!isValidDate(lastSuccessAt)) return true;
  return now.getTime() - lastSuccessAt.getTime() > STALE_BANNER_HOURS * HOUR_MS;
}

/** "1 minute", "5 minutes": English plural by hand, no Intl. */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many} ${RELATIVE_TIME_WORDS.ago}`;
}

/**
 * How long before `now` the date was: under an hour in minutes (at least 1),
 * under 48 hours in hours, else in days. A future date reads "1 minute ago".
 */
export function relativeTime(date: Date, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - date.getTime());
  const w = RELATIVE_TIME_WORDS;
  if (elapsed < HOUR_MS) {
    return count(
      Math.max(1, Math.floor(elapsed / MINUTE_MS)),
      w.minute,
      w.minutes,
    );
  }
  if (elapsed < HOURS_SHOWN_BELOW_MS) {
    return count(Math.floor(elapsed / HOUR_MS), w.hour, w.hours);
  }
  return count(Math.floor(elapsed / DAY_MS), w.day, w.days);
}
