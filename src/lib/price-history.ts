import "server-only";

// F0 W3's history reader over price_history and price_sync_runs (S0.1,
// AC-3 to AC-8), implementing S2.1's PriceHistoryReader. F2's loader owns the
// timeout race, the catch and the log (C1.32): this module validates its
// input, issues one parameterized SELECT per call, and rejects on any failure.
//
// Dates never pass through a JavaScript Date (S0.1d5): Postgres computes the
// window on the DATE column and formats it with to_char, so neither Node's TZ
// nor the session TimeZone can shift a day (AC-4). Timestamps come back as
// UTC text too (S0.1 Deviation 2): @prisma/adapter-pg 7.5 replaces a
// timestamptz's offset with +00:00, so under a non-UTC session TimeZone a
// raw timestamptz column would shift by that offset. The reader reads no
// clock; asOf comes from the caller (C1.22).
import type {
  HistoryFreshness,
  PriceHistoryReader,
  PriceHistoryResult,
} from "@/lib/evaluation/history-reader";
import {
  FINISHES,
  type Finish,
  type PriceSnapshot,
} from "@/lib/recommendation/types";

/**
 * The one PrismaClient method the reader uses: a tagged-template raw query,
 * sent as a parameterized statement (never $queryRawUnsafe).
 */
export interface RawQueryClient {
  $queryRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): PromiseLike<unknown>;
}

/** Returns the client on first use, so importing the reader reads no env. */
export type RawQueryClientGetter = () => Promise<RawQueryClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** What UTC_INSTANT's to_char pattern writes: milliseconds and a Z. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * A real calendar date written 'YYYY-MM-DD' (rejects 2026-02-30). Year 0000
 * is refused too: JavaScript accepts it, Postgres does not (S0.1 ADV.8).
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  if (value.startsWith("0000")) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

const isFinish = (value: unknown): value is Finish =>
  typeof value === "string" && (FINISHES as readonly string[]).includes(value);

/** A UTC instant written by to_char(… AT TIME ZONE 'UTC', …), or null. */
function instantOf(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * S0.1d6: checked before any query. The message names the argument and never
 * echoes the rejected value.
 */
function assertHistoryArgs(
  scryfallId: unknown,
  finish: unknown,
  asOf: unknown,
): void {
  if (typeof scryfallId !== "string" || !UUID.test(scryfallId)) {
    throw new TypeError("getPriceHistory: scryfallId must be a UUID");
  }
  if (!isFinish(finish)) {
    throw new TypeError(
      `getPriceHistory: finish must be one of ${FINISHES.join(", ")}`,
    );
  }
  if (!isCalendarDate(asOf)) {
    throw new TypeError(
      "getPriceHistory: asOf must be a calendar date written YYYY-MM-DD",
    );
  }
}

interface HistoryRow {
  date: unknown;
  price_cents: unknown;
  synced_at: unknown;
}

interface FreshnessRow {
  finished_at: unknown;
  source_date: unknown;
}

function rowsOf<T>(result: unknown, call: string): T[] {
  if (!Array.isArray(result)) {
    throw new TypeError(`${call}: the query returned no row list`);
  }
  return result as T[];
}

/** One history row as F1's PriceSnapshot, or a TypeError (S0.1d5). */
function toSnapshot(row: HistoryRow): PriceSnapshot {
  if (!isCalendarDate(row.date)) {
    throw new TypeError("getPriceHistory: a row's date is not YYYY-MM-DD");
  }
  const cents = row.price_cents;
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) {
    throw new TypeError(
      "getPriceHistory: a row's price_cents is not a positive integer",
    );
  }
  return { date: row.date, priceCents: cents };
}

/**
 * The reader over a lazily obtained client. Each call validates, then issues
 * exactly one SELECT (AC-8); a client or query failure rejects with that
 * same error.
 */
export function createPriceHistoryReader(
  getClient: RawQueryClientGetter,
): PriceHistoryReader {
  return Object.freeze({
    async getPriceHistory(
      scryfallId: string,
      finish: Finish,
      asOf: string,
    ): Promise<PriceHistoryResult> {
      assertHistoryArgs(scryfallId, finish, asOf);
      const client = await getClient();
      // The window is asOf − 30 to asOf inclusive, 31 calendar dates (F0 W3).
      // ORDER BY names the table: a bare "date" would sort the to_char alias.
      const rows = rowsOf<HistoryRow>(
        await client.$queryRaw`SELECT to_char("date", 'YYYY-MM-DD') AS "date", "price_cents", to_char("synced_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "synced_at" FROM "price_history" WHERE "scryfall_id" = ${scryfallId}::uuid AND "finish" = ${finish}::card_finish AND "date" BETWEEN ${asOf}::date - 30 AND ${asOf}::date ORDER BY "price_history"."date" ASC`,
        "getPriceHistory",
      );
      const history = rows.map(toSnapshot);
      // S0.1 ADV.3: the ORDER BY is the contract (F1 reads an ascending
      // series, and latestSnapshotAt is the last row's). A result out of
      // order rejects, so F2 shows "unavailable" rather than a wrong stale flag.
      for (let i = 1; i < history.length; i++) {
        if (history[i - 1].date >= history[i].date) {
          throw new TypeError(
            "getPriceHistory: rows are not in strictly ascending date order",
          );
        }
      }
      // S0.1d7: the newest returned row's synced_at, not MAX(synced_at), so a
      // republished older price never hides F2's 36h stale flag (C1.31).
      let latestSnapshotAt: Date | null = null;
      if (rows.length > 0) {
        latestSnapshotAt = instantOf(rows[rows.length - 1].synced_at);
        if (latestSnapshotAt === null) {
          throw new TypeError(
            "getPriceHistory: the newest row's synced_at is not a UTC instant",
          );
        }
      }
      return { history, latestSnapshotAt };
    },

    async getHistoryFreshness(): Promise<HistoryFreshness> {
      const client = await getClient();
      // C2-A.4: only ok cron or bulk runs count; identifiers runs never do.
      // IS NOT NULL: DESC sorts nulls first, so a malformed ok row without a
      // finish time would otherwise mask every real success (S0.1d5). ORDER
      // BY names the table: a bare "finished_at" would sort the text alias.
      const rows = rowsOf<FreshnessRow>(
        await client.$queryRaw`SELECT to_char("finished_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "finished_at", to_char("source_date", 'YYYY-MM-DD') AS "source_date" FROM "price_sync_runs" WHERE "status" = 'ok' AND "trigger" IN ('cron', 'bulk') AND "finished_at" IS NOT NULL ORDER BY "price_sync_runs"."finished_at" DESC, "price_sync_runs"."id" DESC LIMIT 1`,
        "getHistoryFreshness",
      );
      if (rows.length === 0) return { lastSuccessAt: null, sourceDate: null };
      const lastSuccessAt = instantOf(rows[0].finished_at);
      const sourceDate = rows[0].source_date;
      if (lastSuccessAt === null) {
        throw new TypeError(
          "getHistoryFreshness: finished_at is not a UTC instant",
        );
      }
      if (sourceDate !== null && !isCalendarDate(sourceDate)) {
        throw new TypeError(
          "getHistoryFreshness: source_date is not YYYY-MM-DD",
        );
      }
      return { lastSuccessAt, sourceDate };
    },
  });
}

/**
 * The production reader (S0.1d8). The Prisma client is imported on the first
 * call, so loading the page never reads the environment: a missing
 * POSTGRES_PRISMA_URL rejects that read, and F2 renders "Price history
 * temporarily unavailable". It reads through historyPrisma, the bounded,
 * TLS-explicit client (S0.1d20, S0.1d21).
 */
export const prismaHistoryReader: PriceHistoryReader = createPriceHistoryReader(
  () => import("@/lib/prisma").then((m) => m.historyPrisma),
);
