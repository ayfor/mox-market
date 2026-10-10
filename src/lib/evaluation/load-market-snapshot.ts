// F2's market snapshot (S2.1d8; C1.21, C1.22, C1.32): the applied finish,
// the current price in cents and the history, read only through the
// PriceHistoryReader. Each read is raced to HISTORY_TIMEOUT_MS; a failed read
// degrades the page and is logged, and never throws.
import { priceCentsFor } from "@/lib/printings";
import type { Finish, MarketSnapshot } from "@/lib/recommendation/types";
import type { ShownFinish } from "@/lib/recommendation/ui-copy";
import type { ScryfallCard } from "@/types/scryfall";
import { HISTORY_TIMEOUT_MS } from "./consts";
import type {
  HistoryFreshness,
  PriceHistoryReader,
  PriceHistoryResult,
} from "./history-reader";
import { isSyncStale } from "./staleness";
import { withTimeout } from "./with-timeout";

/** A server-side failure log: an event name and the error, never a URL or secret. */
export type EvaluationLog = (event: string, error: unknown) => void;

/** The default log: one console.error line per failure. */
export const consoleLog: EvaluationLog = (event, error) => {
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`[evaluation] ${event}: ${name}`);
};

export interface LoadMarketSnapshotArgs {
  readonly printing: Pick<ScryfallCard, "id" | "prices">;
  readonly requestedFinish: ShownFinish;
  readonly reader: PriceHistoryReader;
  readonly now: Date;
  readonly log: EvaluationLog;
}

export interface LoadedMarketSnapshot {
  readonly market: MarketSnapshot;
  /** The history read rejected, timed out or returned a malformed result. */
  readonly historyUnavailable: boolean;
  /** The global banner: no sync, an unreadable one, one over 48h old, or a failed read. */
  readonly syncStale: boolean;
}

/** UTC 'YYYY-MM-DD' of a date: the engine's asOf, never local time. */
export function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const validDateOrNull = (value: unknown): Date | null =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;

/** The history result, or null when it is not the reader's shape. */
function usableHistory(result: unknown): PriceHistoryResult | null {
  if (result === null || typeof result !== "object") return null;
  const { history, latestSnapshotAt } = result as Partial<PriceHistoryResult>;
  if (!Array.isArray(history)) return null;
  return { history, latestSnapshotAt: validDateOrNull(latestSnapshotAt) };
}

/** lastSuccessAt as a valid date, or null when missing or unreadable. */
function lastSuccessOf(result: unknown): Date | null {
  if (result === null || typeof result !== "object") return null;
  return validDateOrNull((result as Partial<HistoryFreshness>).lastSuccessAt);
}

/**
 * The applied finish is the requested one when the printing has its price,
 * else normal; normal never falls back (C1.21). Both reads start together,
 * so the page waits at most HISTORY_TIMEOUT_MS for them.
 */
export async function loadMarketSnapshot({
  printing,
  requestedFinish,
  reader,
  now,
  log,
}: LoadMarketSnapshotArgs): Promise<LoadedMarketSnapshot> {
  const requestedCents = priceCentsFor(printing, requestedFinish);
  const appliedFinish: Finish =
    requestedFinish === "foil" && requestedCents !== null ? "foil" : "normal";
  const currentPriceCents =
    appliedFinish === requestedFinish
      ? requestedCents
      : priceCentsFor(printing, "normal");
  const asOf = utcDate(now);

  const [historyRead, freshnessRead] = await Promise.allSettled([
    withTimeout(
      () => reader.getPriceHistory(printing.id, appliedFinish, asOf),
      HISTORY_TIMEOUT_MS,
    ),
    withTimeout(() => reader.getHistoryFreshness(), HISTORY_TIMEOUT_MS),
  ]);

  let history: PriceHistoryResult | null = null;
  if (historyRead.status === "rejected") {
    log("history_read_failed", historyRead.reason);
  } else {
    history = usableHistory(historyRead.value);
    if (history === null) {
      log("history_read_malformed", new TypeError("malformed history result"));
    }
  }

  let syncStale: boolean;
  if (freshnessRead.status === "rejected") {
    log("freshness_read_failed", freshnessRead.reason);
    syncStale = true;
  } else {
    syncStale = isSyncStale(lastSuccessOf(freshnessRead.value), now);
  }

  return {
    market: {
      appliedFinish,
      currentPriceCents,
      history: history?.history ?? [],
      asOf,
      source: "scryfall",
      latestSnapshotAt: history?.latestSnapshotAt ?? null,
    },
    historyUnavailable: history === null,
    syncStale,
  };
}
