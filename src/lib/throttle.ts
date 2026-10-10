/**
 * Request throttler for Scryfall API.
 * Enforces minimum 100ms spacing between requests per their guidelines.
 *
 * Each caller reserves the next free slot, 100 ms after the one before. A
 * caller whose slot lies more than `maxWaitMs` away is refused at once with
 * ThrottleBacklogError, so the queue never grows without bound, and a caller
 * whose `signal` aborts while it waits rejects with the signal's reason, so
 * a request's deadline covers its time in the queue (S2.1 ADV-1). A reserved
 * slot stays reserved either way, so the spacing never shrinks.
 */

const MIN_INTERVAL_MS = 100;
let nextSlotAt = 0;

/** The caller's slot lies further away than it may wait. */
export class ThrottleBacklogError extends Error {
  readonly waitMs: number;

  constructor(waitMs: number) {
    super(`throttle backlog: next slot in ${waitMs} ms`);
    this.name = "ThrottleBacklogError";
    this.waitMs = waitMs;
  }
}

export interface ThrottleOptions {
  /** Aborting it while the caller waits rejects with its reason. */
  readonly signal?: AbortSignal;
  /** Refuse at once when the caller's slot is further away than this. */
  readonly maxWaitMs?: number;
}

export function throttle({
  signal,
  maxWaitMs = Number.POSITIVE_INFINITY,
}: ThrottleOptions = {}): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const now = Date.now();
  const slotAt = Math.max(now, nextSlotAt);
  const waitMs = slotAt - now;
  if (waitMs > maxWaitMs) {
    return Promise.reject(new ThrottleBacklogError(waitMs));
  }
  nextSlotAt = slotAt + MIN_INTERVAL_MS;
  if (waitMs === 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, waitMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
