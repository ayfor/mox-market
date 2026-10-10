// The C1.32 race (S2.1d8): a history or freshness read gets at most
// HISTORY_TIMEOUT_MS, and a slow or failing read never fails the page.

/** The read did not settle within its budget. */
export class HistoryTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`read exceeded ${timeoutMs} ms`);
    this.name = "HistoryTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Runs `read` and settles with its result, or rejects with HistoryTimeoutError
 * once `ms` pass first. A synchronous throw becomes a rejection. The timer is
 * cleared on settle, and a read that rejects after the deadline is still
 * handled, so it never raises an unhandled rejection.
 */
export function withTimeout<T>(read: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HistoryTimeoutError(ms)), ms);
    let pending: Promise<T>;
    try {
      pending = Promise.resolve(read());
    } catch (error) {
      clearTimeout(timer);
      reject(error);
      return;
    }
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
