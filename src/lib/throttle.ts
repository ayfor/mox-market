/**
 * Request throttler for Scryfall API.
 * Enforces minimum 100ms spacing between requests per their guidelines.
 */

const MIN_INTERVAL_MS = 100;
let lastRequestTime = 0;
let pending: Promise<void> = Promise.resolve();

export async function throttle(): Promise<void> {
  // Chain onto the pending promise so concurrent callers queue up
  pending = pending.then(async () => {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_INTERVAL_MS - elapsed),
      );
    }
    lastRequestTime = Date.now();
  });
  return pending;
}
