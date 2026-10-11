// S2.3 AC-7, AC-8: a fake PriceHistoryReader keyed by (scryfallId, finish),
// so a test can prove each selection reads exactly its own series and never
// a blend. Every getPriceHistory call is recorded. Test support only: no app
// code imports it.
import type {
  HistoryFreshness,
  PriceHistoryReader,
  PriceHistoryResult,
} from "@/lib/evaluation/history-reader";
import type { Finish, PriceSnapshot } from "@/lib/recommendation/types";

/** The reader's key for a series. */
export const historyKey = (scryfallId: string, finish: Finish) =>
  `${scryfallId}|${finish}`;

export interface KeyedHistoryReader extends PriceHistoryReader {
  /** Every getPriceHistory call, in order: [scryfallId, finish, asOf]. */
  readonly calls: [scryfallId: string, finish: Finish, asOf: string][];
}

/**
 * A reader answering each (scryfallId, finish) key with its own series (an
 * unknown key answers no rows), its latestSnapshotAt the newest row's date
 * at 06:00 UTC, and a fresh sync at `freshAt`.
 */
export function keyedHistoryReader(
  series: Readonly<Record<string, readonly PriceSnapshot[]>>,
  freshAt: Date,
): KeyedHistoryReader {
  const calls: KeyedHistoryReader["calls"] = [];
  return {
    calls,
    async getPriceHistory(scryfallId, finish, asOf) {
      calls.push([scryfallId, finish, asOf]);
      const rows = series[historyKey(scryfallId, finish)] ?? [];
      const newest = rows.at(-1);
      const result: PriceHistoryResult = {
        history: [...rows],
        latestSnapshotAt:
          newest === undefined ? null : new Date(`${newest.date}T06:00:00Z`),
      };
      return result;
    },
    async getHistoryFreshness(): Promise<HistoryFreshness> {
      return {
        lastSuccessAt: freshAt,
        sourceDate: freshAt.toISOString().slice(0, 10),
      };
    },
  };
}
