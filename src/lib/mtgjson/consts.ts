// F0's ops constants (Design F0 §Functionality, "Ops constants"; S0.2d2).
// None of them touches the engine, so none is a RECOMMENDATION_PARAMS value
// and none moves PARAMS_VERSION. S0.3's daily sync imports the same module.
// Imports nothing.

/** MTGJson v5's file root. Only these files are fetched from it (S0.2d4). */
export const MTGJSON_BASE_URL = "https://mtgjson.com/api/v5/";

/** Every MTGJson meta.version must start with this (AC-4, investigation G13). */
export const MTGJSON_SCHEMA_MAJOR = "5.";

/** F1's window is 30 dates; F0 keeps runDate − 30 … runDate (31 dates). */
export const HISTORY_WINDOW_DAYS = 30;

/** Gate: a series is kept when its card's EDHREC rank is at most this… */
export const GATE_MAX_EDHREC_RANK = 5000;

/** …or its newest valid price is at least this many cents (both inclusive). */
export const GATE_MIN_PRICE_CENTS = 100;

/** Rows per upsert statement (each chunk is one statement, its own commit). */
export const UPSERT_CHUNK_ROWS = 5000;

/** Supabase Free's database quota, decimal bytes. */
export const DB_FREE_TIER_BYTES = 500_000_000;

/** Over this: a write run logs a warning, and the bulk ingest refuses to start. */
export const DB_WARN_BYTES = 400_000_000;

/** Over this at a re-check: stop upserting, prune, finish `budget_stop`. */
export const DB_STOP_BYTES = 450_000_000;

/** A first bulk run (price_history empty) needs at least this much free. */
export const BULK_MIN_FREE_BYTES = 340_000_000;

/** A run still `running` after this long was abandoned (S0.3 marks it error). */
export const STALE_RUN_MS = 3_600_000;

/**
 * The daily sync's own deadline (S0.3d15): 30 s under the route's
 * maxDuration of 300 s. Checked between parsed entries and between chunks,
 * and every database statement and download races the time left (ADV.2), so
 * a hung source, connection or query ends the run `error` ("deadline
 * exceeded") instead of a kill that leaves the row `running` until the next
 * run marks it.
 */
export const SYNC_DEADLINE_MS = 270_000;

/**
 * How long the run row's final UPDATE may take, on its own clock (ADV.2): the
 * outcome is still recorded when the deadline fires, and the run ends by
 * SYNC_DEADLINE_MS + this, still under maxDuration.
 */
export const SYNC_FINISH_GRACE_MS = 10_000;

/**
 * The most rows one daily sync may write (S0.3d25): 3 × the 73,323 rows a
 * real AllPricesToday emitted (S0.3 E1, 2026-10-10), rounded. A file that
 * would emit more is refused before any write: a mis-served or reshaped file
 * must not fill the 500 MB quota on a passing size pre-check.
 */
export const SYNC_MAX_ROWS = 220_000;

/** F0's "re-checks size every 50 chunks" (identifier and price chunks both count). */
export const BUDGET_RECHECK_CHUNKS = 50;

/** The four MTGJson files F0 reads; the bulk ingest downloads the first three. */
export const META_FILE = "Meta.json";
export const ALL_IDENTIFIERS_FILE = "AllIdentifiers.json.gz";
export const ALL_PRICES_FILE = "AllPrices.json.gz";
export const ALL_PRICES_TODAY_FILE = "AllPricesToday.json.gz";

export type MtgjsonFileName =
  | typeof META_FILE
  | typeof ALL_IDENTIFIERS_FILE
  | typeof ALL_PRICES_FILE
  | typeof ALL_PRICES_TODAY_FILE;

/**
 * Report-only storage projections (S0.2d2, AC-6): bytes per stored row,
 * heap plus index, measured by path B on MTGJson's 2026-10-10 files
 * (Postgres 14.8): price_history 269,451,264 B / 2,186,341 rows = 123.2,
 * mtgjson_identifiers 13,352,960 B / 123,830 rows = 107.8, rounded up
 * (plan Deviation 1; F0's estimate was 115). They size the dry-run's
 * "projected bytes" line and are never a budget limit; the budget reads
 * pg_database_size().
 */
export const PROJECTED_BYTES_PER_PRICE_ROW = 124;
export const PROJECTED_BYTES_PER_IDENTIFIER_ROW = 108;
