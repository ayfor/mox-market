// The counting window (S1.2d3, S1.2d4; C1.09 = A, C1.22). The engine reads
// only the windowDays UTC dates ending at asOf − 1, keeps the latest entry per
// date, and treats a date whose kept price is not a positive safe integer as
// a gap. Market-data problems never throw (F1 W1 step 2). No clock is read:
// every date comes from the caller's asOf.

/** One real (non-interpolated) snapshot inside the window. */
export interface WindowSnapshot {
  /** 0 for asOf − windowDays, windowDays − 1 for asOf − 1. */
  readonly index: number;
  readonly date: string;
  /** A positive safe integer, in cents. */
  readonly priceCents: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC 'YYYY-MM-DD' for a UTC epoch-milliseconds value. */
const isoDate = (epochMs: number) =>
  new Date(epochMs).toISOString().slice(0, 10);

/**
 * The windowDays dates from asOf − windowDays to asOf − 1, oldest first, or
 * null when asOf is not a real UTC calendar date ('YYYY-MM-DD' that
 * round-trips through Date.UTC, so 2026-02-30 and years 0000–0099 are
 * rejected). Month, year and leap-day boundaries come from Date.UTC.
 */
export function windowDates(
  asOf: unknown,
  windowDays: number,
): string[] | null {
  if (typeof asOf !== "string" || !ISO_DATE.test(asOf)) return null;
  const [year, month, day] = asOf.split("-").map(Number);
  const monthIndex = month - 1;
  if (isoDate(Date.UTC(year, monthIndex, day)) !== asOf) return null;
  const dates: string[] = [];
  for (let back = windowDays; back >= 1; back -= 1) {
    dates.push(isoDate(Date.UTC(year, monthIndex, day - back)));
  }
  return dates;
}

const isUsablePrice = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

/**
 * The real snapshots inside the window, oldest first. Entries are walked in
 * array order and the last one per window date wins; a kept entry with an
 * unusable price makes its date a gap (the superseded value is not
 * resurrected). Entries outside the window, non-object entries, non-string
 * dates and a non-array history are ignored, never validated.
 */
export function readWindow(
  history: unknown,
  asOf: unknown,
  windowDays: number,
): WindowSnapshot[] {
  const dates = windowDates(asOf, windowDays);
  if (dates === null || !Array.isArray(history)) return [];
  const indexOf = new Map(dates.map((date, index) => [date, index]));
  const latest = new Map<string, unknown>();
  for (const entry of history as readonly unknown[]) {
    if (entry === null || typeof entry !== "object") continue;
    const { date, priceCents } = entry as {
      readonly date?: unknown;
      readonly priceCents?: unknown;
    };
    if (typeof date === "string" && indexOf.has(date)) {
      latest.set(date, priceCents);
    }
  }
  const snapshots: WindowSnapshot[] = [];
  dates.forEach((date, index) => {
    const priceCents = latest.get(date);
    if (isUsablePrice(priceCents)) snapshots.push({ index, date, priceCents });
  });
  return snapshots;
}
