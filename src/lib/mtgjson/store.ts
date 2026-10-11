// The F0 writer (S0.2d12 to S0.2d14; AC-3, AC-7, AC-8, AC-10): chunked
// idempotent upserts, the prune, ANALYZE, the price_sync_runs row and
// pg_database_size(). Every statement is parameterized and sent on its own,
// so each chunk commits by itself (autocommit) and an interrupted run keeps
// the chunks before the fault. Never string-concatenated SQL: table and
// column names are literals, and every value travels as a parameter.
// S0.3's daily sync reuses these functions over the same Db interface.
import { HISTORY_WINDOW_DAYS } from "./consts";
import type { IdentifierRow, PriceRow } from "./transform";

/** The slice of pg.Client the writer uses. */
export interface QueryResultLike {
  readonly rowCount: number | null;
  readonly rows: readonly Record<string, unknown>[];
}

export interface Db {
  query(text: string, values?: readonly unknown[]): Promise<QueryResultLike>;
}

export interface ChunkStats {
  /** Rows dropped by the per-statement dedupe guard (S0.2d11). */
  duplicateKeys: number;
}

/** F0 §Writes, verbatim: a re-run changes nothing, synced_at included. */
export const UPSERT_PRICES_SQL = `INSERT INTO "price_history" ("scryfall_id", "finish", "date", "price_cents")
SELECT * FROM unnest($1::uuid[], $2::card_finish[], $3::date[], $4::int4[])
ON CONFLICT ("scryfall_id", "finish", "date") DO UPDATE
  SET "price_cents" = EXCLUDED."price_cents", "synced_at" = now()
  WHERE "price_history"."price_cents" IS DISTINCT FROM EXCLUDED."price_cents"`;

/** S0.2d12: change-only, so loaded_at moves only when a row changed. */
export const UPSERT_IDENTIFIERS_SQL = `INSERT INTO "mtgjson_identifiers" ("mtgjson_uuid", "scryfall_id", "side", "edhrec_rank")
SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::int4[])
ON CONFLICT ("mtgjson_uuid") DO UPDATE
  SET "scryfall_id" = EXCLUDED."scryfall_id", "side" = EXCLUDED."side",
      "edhrec_rank" = EXCLUDED."edhrec_rank", "loaded_at" = now()
  WHERE ("mtgjson_identifiers"."scryfall_id", "mtgjson_identifiers"."side", "mtgjson_identifiers"."edhrec_rank")
        IS DISTINCT FROM (EXCLUDED."scryfall_id", EXCLUDED."side", EXCLUDED."edhrec_rank")`;

export const PRUNE_SQL = `DELETE FROM "price_history" WHERE "date" < $1::date - $2::int4`;

/**
 * One price chunk as one statement. The first row per (scryfall_id, finish,
 * date) is kept and any later one counted, because Postgres rejects an
 * upsert that touches one key twice (S0.2d11). Returns rowCount: inserts
 * plus changed updates, never a conflict the WHERE skipped.
 */
export async function upsertPriceChunk(
  db: Db,
  rows: readonly PriceRow[],
  stats?: ChunkStats,
): Promise<number> {
  const seen = new Set<string>();
  const ids: string[] = [];
  const finishes: string[] = [];
  const dates: string[] = [];
  const cents: number[] = [];
  for (const row of rows) {
    const key = `${row.scryfallId}|${row.finish}|${row.date}`;
    if (seen.has(key)) {
      if (stats) stats.duplicateKeys += 1;
      continue;
    }
    seen.add(key);
    ids.push(row.scryfallId);
    finishes.push(row.finish);
    dates.push(row.date);
    cents.push(row.priceCents);
  }
  if (ids.length === 0) return 0;
  const result = await db.query(UPSERT_PRICES_SQL, [
    ids,
    finishes,
    dates,
    cents,
  ]);
  return result.rowCount ?? 0;
}

/** One identifier chunk as one statement (first row per UUID kept). */
export async function upsertIdentifierChunk(
  db: Db,
  rows: readonly IdentifierRow[],
): Promise<number> {
  const seen = new Set<string>();
  const uuids: string[] = [];
  const scryfallIds: string[] = [];
  const sides: (string | null)[] = [];
  const ranks: (number | null)[] = [];
  for (const row of rows) {
    if (seen.has(row.mtgjsonUuid)) continue;
    seen.add(row.mtgjsonUuid);
    uuids.push(row.mtgjsonUuid);
    scryfallIds.push(row.scryfallId);
    sides.push(row.side);
    ranks.push(row.edhrecRank);
  }
  if (uuids.length === 0) return 0;
  const result = await db.query(UPSERT_IDENTIFIERS_SQL, [
    uuids,
    scryfallIds,
    sides,
    ranks,
  ]);
  return result.rowCount ?? 0;
}

/**
 * AC-8: deletes every row dated before runDate − 30, any printing or finish,
 * and returns how many went. runDate − 30 itself is kept.
 */
export async function prunePriceHistory(
  db: Db,
  runDate: string,
): Promise<number> {
  const result = await db.query(PRUNE_SQL, [runDate, HISTORY_WINDOW_DAYS]);
  return result.rowCount ?? 0;
}

/** Refreshes planner statistics after a bulk write (S0.2d13). */
export async function analyzeTables(
  db: Db,
  { prices }: { prices: boolean },
): Promise<void> {
  await db.query(
    prices
      ? `ANALYZE "price_history", "mtgjson_identifiers"`
      : `ANALYZE "mtgjson_identifiers"`,
  );
}

/**
 * pg_database_size(current_database()) as a number: int8 crosses the
 * boundary as text and is checked to be a safe integer (below 2^53).
 */
export async function databaseSizeBytes(db: Db): Promise<number> {
  const result = await db.query(
    `SELECT pg_database_size(current_database())::text AS "bytes"`,
  );
  const bytes = Number(result.rows[0]?.bytes);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("pg_database_size returned an unusable value");
  }
  return bytes;
}

/** True when price_history holds no row (the 340 MB rule is first-run only). */
export async function priceHistoryIsEmpty(db: Db): Promise<boolean> {
  const result = await db.query(
    `SELECT NOT EXISTS (SELECT 1 FROM "price_history") AS "empty"`,
  );
  return result.rows[0]?.empty === true;
}

export type RunTrigger = "cron" | "bulk" | "identifiers";
export type RunStatus =
  | "running"
  | "ok"
  | "source_stale"
  | "budget_stop"
  | "error";

/** Inserts a `running` row and returns its id (S0.2d14, AC-10). */
export async function startRun(
  db: Db,
  run: {
    trigger: RunTrigger;
    sourceDate: string | null;
    sourceVersion: string | null;
  },
): Promise<number> {
  const result = await db.query(
    `INSERT INTO "price_sync_runs" ("trigger", "status", "source_date", "source_version")
VALUES ($1::price_sync_trigger, 'running', $2::date, $3::text)
RETURNING "id"`,
    [run.trigger, run.sourceDate, run.sourceVersion],
  );
  const id = Number(result.rows[0]?.id);
  if (!Number.isSafeInteger(id)) throw new Error("run row has no id");
  return id;
}

export interface RunOutcome {
  readonly status: Exclude<RunStatus, "running">;
  readonly rowsWritten: number;
  readonly rowsPruned: number;
  readonly unmappedUuids: number;
  readonly dbBytes: number | null;
  readonly error: string | null;
}

/** Ends a run: status, counts, db_bytes, finished_at = now(). */
export async function finishRun(
  db: Db,
  id: number,
  outcome: RunOutcome,
): Promise<void> {
  await db.query(
    `UPDATE "price_sync_runs"
SET "status" = $2::price_sync_status, "finished_at" = now(),
    "rows_written" = $3::int4, "rows_pruned" = $4::int4,
    "unmapped_uuids" = $5::int4, "db_bytes" = $6::int8, "error" = $7::text
WHERE "id" = $1::int4`,
    [
      id,
      outcome.status,
      outcome.rowsWritten,
      outcome.rowsPruned,
      outcome.unmappedUuids,
      outcome.dbBytes,
      outcome.error === null ? null : sanitizeErrorMessage(outcome.error),
    ],
  );
}

/** The longest error text a run row stores (F0 §Fields). */
export const RUN_ERROR_MAX_CHARS = 1_000;

const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

/** An error as run-row text: `name: message`. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return `Error: ${String(error)}`;
}

/**
 * Run-row error text (F0 §Fields: "message only; never a secret or URL"):
 * every URL becomes "[redacted url]", then the text is cut to 1,000
 * characters.
 */
export function sanitizeErrorMessage(text: string): string {
  return text
    .replace(URL_PATTERN, "[redacted url]")
    .slice(0, RUN_ERROR_MAX_CHARS);
}
