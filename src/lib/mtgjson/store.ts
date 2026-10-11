// The F0 writer (S0.2d12 to S0.2d14; AC-3, AC-7, AC-8, AC-10): chunked
// idempotent upserts, the prune, ANALYZE, the price_sync_runs row and
// pg_database_size(). Every statement is parameterized and sent on its own,
// so each chunk commits by itself (autocommit) and an interrupted run keeps
// the chunks before the fault. Never string-concatenated SQL: table and
// column names are literals, and every value travels as a parameter.
// S0.3's daily sync reuses these functions over the same Db interface, and
// adds three of its own (S0.3d9, S0.3d10): markStaleRuns, setRunSource and
// loadIdentifierIndex.
import { HISTORY_WINDOW_DAYS, STALE_RUN_MS } from "./consts";
import {
  IdentifierIndex,
  isCalendarDate,
  type IdentifierRow,
  type PriceRow,
} from "./transform";

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

// --- the daily sync's statements (S0.3d9, S0.3d10) ---------------------------

/** The fixed text a stale run's row gets (S0.3d9). */
export const STALE_RUN_MESSAGE = "abandoned: still running after 1 hour";

/**
 * Marks every run still `running` after `$1` ms, any trigger, as `error`. The
 * age is measured with the database's own clock, so the app clock and the
 * database clock are never mixed. The sync sends it before inserting its own
 * row, so a run never marks itself.
 */
export const MARK_STALE_RUNS_SQL = `UPDATE "price_sync_runs"
SET "status" = 'error', "finished_at" = now(), "error" = $2::text
WHERE "status" = 'running' AND "started_at" < now() - ($1::int8 * interval '1 millisecond')`;

/** Records Meta.json's date and version on a run (S0.3d10). */
export const SET_RUN_SOURCE_SQL = `UPDATE "price_sync_runs" SET "source_date" = $2::date, "source_version" = $3::text WHERE "id" = $1::int4`;

/** The whole identifier map, for IdentifierIndex.add (S0.3d7). */
export const LOAD_IDENTIFIERS_SQL = `SELECT "mtgjson_uuid"::text AS "uuid", "scryfall_id"::text AS "scryfallId", "side", "edhrec_rank" AS "edhrecRank"
FROM "mtgjson_identifiers"`;

/** The longest source_version a run row stores (S0.3d10). */
export const SOURCE_VERSION_MAX_CHARS = 100;

/**
 * Ends every run left `running` for longer than `staleMs` as `error` with
 * STALE_RUN_MESSAGE; returns how many it marked (AC-9).
 */
export async function markStaleRuns(
  db: Db,
  staleMs: number = STALE_RUN_MS,
): Promise<number> {
  const result = await db.query(MARK_STALE_RUNS_SQL, [
    staleMs,
    STALE_RUN_MESSAGE,
  ]);
  return result.rowCount ?? 0;
}

/**
 * Records what Meta.json said on the run row before any check, so every
 * outcome shows what arrived: the date only when it is a calendar date, the
 * version cut to SOURCE_VERSION_MAX_CHARS.
 */
export async function setRunSource(
  db: Db,
  id: number,
  source: { date: string | null; version: string | null },
): Promise<void> {
  await db.query(SET_RUN_SOURCE_SQL, [
    id,
    isCalendarDate(source.date) ? source.date : null,
    source.version === null
      ? null
      : source.version.slice(0, SOURCE_VERSION_MAX_CHARS),
  ]);
}

/**
 * Loads mtgjson_identifiers into an IdentifierIndex (S0.3d7): the same
 * validation and preferred-UUID rule the bulk ingest applies to
 * AllIdentifiers, so an invalid stored row is counted by the index, not
 * thrown.
 */
export async function loadIdentifierIndex(
  db: Db,
  index: IdentifierIndex = new IdentifierIndex(),
): Promise<IdentifierIndex> {
  const result = await db.query(LOAD_IDENTIFIERS_SQL);
  for (const row of result.rows) {
    index.add({
      uuid: typeof row.uuid === "string" ? row.uuid.toLowerCase() : "",
      scryfallId:
        typeof row.scryfallId === "string"
          ? row.scryfallId.toLowerCase()
          : row.scryfallId,
      side: row.side,
      edhrecRank: row.edhrecRank,
    });
  }
  return index;
}

/** The longest error text a run row stores (F0 §Fields). */
export const RUN_ERROR_MAX_CHARS = 1_000;

/**
 * A URL, with one or more slashes after the scheme (`path.resolve` turns
 * `postgresql://` into `postgresql:/`), and bare `user:password@host`
 * userinfo (ADV.13).
 */
const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/+[^\s"'<>]+/gi;
const USERINFO_PATTERN = /[^\s"'<>@/:]*:[^\s"'<>@/]*@[^\s"'<>]+/g;

/** An error as run-row text: `name: message`. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return `Error: ${String(error)}`;
}

/**
 * Run-row and terminal error text (F0 §Fields: "message only; never a secret
 * or URL"): every URL and every `user:password@host` becomes
 * "[redacted url]", then the text is cut to 1,000 characters.
 */
export function sanitizeErrorMessage(text: string): string {
  return text
    .replace(URL_PATTERN, "[redacted url]")
    .replace(USERINFO_PATTERN, "[redacted url]")
    .slice(0, RUN_ERROR_MAX_CHARS);
}
