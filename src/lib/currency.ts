/**
 * USD → CAD currency conversion.
 * Fetches exchange rate from a free API, caches for 24 hours.
 */

const STORAGE_KEY = "mox-market:usd-cad-rate";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FALLBACK_RATE = 1.36; // Reasonable fallback if API is down

interface CachedRate {
  rate: number;
  fetchedAt: number;
}

let memoryRate: CachedRate | null = null;

/**
 * Get the current USD→CAD exchange rate.
 * Caches in memory + localStorage for 24 hours.
 */
export async function getUsdToCadRate(): Promise<number> {
  // Check memory cache
  if (memoryRate && Date.now() - memoryRate.fetchedAt < MAX_AGE_MS) {
    return memoryRate.rate;
  }

  // Check localStorage cache
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const cached: CachedRate = JSON.parse(raw);
        if (Date.now() - cached.fetchedAt < MAX_AGE_MS) {
          memoryRate = cached;
          return cached.rate;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Fetch fresh rate
  try {
    const res = await fetch(
      "https://open.er-api.com/v6/latest/USD",
    );

    if (!res.ok) {
      return FALLBACK_RATE;
    }

    const data = await res.json();
    const rate = data?.rates?.CAD;

    if (typeof rate !== "number") {
      return FALLBACK_RATE;
    }

    const cached: CachedRate = { rate, fetchedAt: Date.now() };
    memoryRate = cached;

    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
      } catch {
        // localStorage unavailable
      }
    }

    return rate;
  } catch {
    return FALLBACK_RATE;
  }
}

/**
 * Convert a USD price string to CAD.
 */
export async function usdToCad(
  usdPrice: string | null,
): Promise<number | null> {
  if (!usdPrice) return null;
  const usd = parseFloat(usdPrice);
  if (isNaN(usd)) return null;
  const rate = await getUsdToCadRate();
  return Math.round(usd * rate * 100) / 100;
}
