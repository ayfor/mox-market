// The price-history reader contract (S2.1d2; pivot, F0 not approved). F2
// reads history and freshness only through this interface, with F0 W3's
// signatures and F1's PriceSnapshot. S0.1 adds src/lib/price-history.ts,
// implementing it over price_history and price_sync_runs, and repoints
// defaultHistoryReader at it in its PR. Until then the default is empty, so
// every card is insufficient_data and the stale-data banner shows.
import type { Finish, PriceSnapshot } from "@/lib/recommendation/types";

/** F0 W3 getPriceHistory's result. */
export interface PriceHistoryResult {
  /** At most one row per UTC date for the (scryfallId, finish) key, ascending. */
  history: PriceSnapshot[];
  /** synced_at of the newest returned row; null when there are none. */
  latestSnapshotAt: Date | null;
}

/** F0 W3 getHistoryFreshness's result. */
export interface HistoryFreshness {
  /** finished_at of the newest ok cron or bulk run; null when none. */
  lastSuccessAt: Date | null;
  /** That run's MTGJson source date, 'YYYY-MM-DD'; null when none. */
  sourceDate: string | null;
}

/** F0 W3's reader. F2 owns the timeout race, the catch and the logging. */
export interface PriceHistoryReader {
  getPriceHistory(
    scryfallId: string,
    finish: Finish,
    asOf: string,
  ): Promise<PriceHistoryResult>;
  getHistoryFreshness(): Promise<HistoryFreshness>;
}

/** No rows and null freshness: the reader until S0.1 lands. */
export const emptyHistoryReader: PriceHistoryReader = Object.freeze({
  async getPriceHistory(): Promise<PriceHistoryResult> {
    return { history: [], latestSnapshotAt: null };
  },
  async getHistoryFreshness(): Promise<HistoryFreshness> {
    return { lastSuccessAt: null, sourceDate: null };
  },
});

/** The reader the result page uses. S0.1 repoints this at its reader. */
export const defaultHistoryReader: PriceHistoryReader = emptyHistoryReader;
