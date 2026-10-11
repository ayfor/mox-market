// F2's market snapshot (S2.1d8; C1.21, C1.22, C1.32): the applied finish,
// the current price in cents and the history, read only through the
// PriceHistoryReader. Each read is raced to HISTORY_TIMEOUT_MS; a failed read
// degrades the page and is logged, and never throws.
import { priceCentsFor } from "@/lib/printings";
import type {
  Finish,
  MarketSnapshot,
  PriceSnapshot,
} from "@/lib/recommendation/types";
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

/** A code is logged only when it is a short bare token: no URL, host or message. */
const SAFE_CODE = /^[A-Za-z0-9_]{1,64}$/;

/**
 * Non-secret codes that tell one read failure from another (S0.1 ADV.5,
 * S0.1d22): the error's own code (a Prisma code such as P2010, or a Node one
 * such as ECONNREFUSED), then the driver adapter's cause kind and Postgres
 * SQLSTATE. A missing table (42P01), a refused connection and a certificate
 * failure (TlsConnectionError) all share PrismaClientKnownRequestError as
 * their name. Messages, hosts and ports are never read.
 */
export function errorCodes(error: unknown): string[] {
  const codes: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && SAFE_CODE.test(value)) {
      if (!codes.includes(value)) codes.push(value);
    }
  };
  if (error !== null && typeof error === "object") {
    const { code, meta } = error as { code?: unknown; meta?: unknown };
    add(code);
    const adapterError = (meta as { driverAdapterError?: unknown } | undefined)
      ?.driverAdapterError;
    const cause = (adapterError as { cause?: unknown } | undefined)?.cause;
    if (cause !== null && typeof cause === "object") {
      const {
        kind,
        originalCode,
        code: causeCode,
      } = cause as {
        kind?: unknown;
        originalCode?: unknown;
        code?: unknown;
      };
      add(kind);
      add(originalCode);
      add(causeCode);
    }
  }
  return codes;
}

/** The default log: one console.error line per failure, name then codes. */
export const consoleLog: EvaluationLog = (event, error) => {
  const name = error instanceof Error ? error.name : typeof error;
  const codes = errorCodes(error);
  const suffix = codes.length > 0 ? ` [${codes.join(" ")}]` : "";
  console.error(`[evaluation] ${event}: ${name}${suffix}`);
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

const ROW_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The newest row's UTC date as a Date at midnight, or null when no row has a
 * 'YYYY-MM-DD' date. Stands in for a missing or unreadable latestSnapshotAt,
 * so a panel computed from rows never says it has no history (ADV-7).
 */
function newestRowDate(history: readonly unknown[]): Date | null {
  let newest: string | null = null;
  for (const row of history) {
    const date = (row as Partial<PriceSnapshot> | null)?.date;
    if (typeof date === "string" && ROW_DATE.test(date)) {
      if (newest === null || date > newest) newest = date;
    }
  }
  return newest === null
    ? null
    : validDateOrNull(new Date(`${newest}T00:00:00.000Z`));
}

/**
 * The history result, or null when it is not the reader's shape. A
 * latestSnapshotAt that is missing or not a valid Date falls back to the
 * newest row's date (ADV-7); with no dated row it is null.
 */
function usableHistory(result: unknown): PriceHistoryResult | null {
  if (result === null || typeof result !== "object") return null;
  const { history, latestSnapshotAt } = result as Partial<PriceHistoryResult>;
  if (!Array.isArray(history)) return null;
  return {
    history,
    latestSnapshotAt:
      validDateOrNull(latestSnapshotAt) ?? newestRowDate(history),
  };
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
