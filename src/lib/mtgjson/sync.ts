// runDailySync: F0's daily sync (W2; S0.3d7 to S0.3d15; AC-3 to AC-9,
// AC-11), over S0.2's source, parser, transform and store. Every dependency
// is injected (database, source, clock), so each path runs offline; the
// route's handler (sync-handler.ts) supplies the shared Prisma client and a
// per-run download directory.
//
// Order, exactly W2's: stale `running` rows marked `error` (before this run's
// own row exists, so it never marks itself) → this run's row, `cron`,
// `running` → Meta.json downloaded and its meta read → its date and version
// recorded on the row → version check (`5.`; else `error`) → date checks (no
// calendar date: `error`; not today's UTC date: prune, `source_stale`, and
// AllPricesToday is never fetched) → AllPricesToday downloaded, its gzip
// verified end to end and its meta read (version `5.`; a date other than
// Meta.json's is `source_stale`) → mtgjson_identifiers loaded → AllPricesToday
// streamed through the S0.2 parser and transform into a buffer → the refusals
// that need the whole file (no identifier, no retail series, none maps, no
// row) → pg_database_size: over DB_STOP_BYTES prune and `budget_stop`, over
// DB_WARN_BYTES a warning → upserts in chunks, each its own statement and
// commit → prune → final size → `ok`.
//
// Statuses: `ok`, `source_stale` and `budget_stop` are normal outcomes;
// anything else ends the row `error`, keeps committed chunks and never
// prunes, so a bad day never shrinks history and never reads as a fresh
// success to getHistoryFreshness(). A failure before the row exists (the
// first query) returns `error` with runId null. The function never rejects
// for a run outcome; the handler maps the status to HTTP.
//
// AllPricesToday is read only through readMeta and parsePrices (AC-11): no
// whole-file read or parse anywhere on this path.
import {
  ALL_PRICES_TODAY_FILE,
  DB_STOP_BYTES,
  DB_WARN_BYTES,
  META_FILE,
  MTGJSON_SCHEMA_MAJOR,
  SYNC_DEADLINE_MS,
  UPSERT_CHUNK_ROWS,
  type MtgjsonFileName,
} from "./consts";
import {
  emptyParseStats,
  parsePrices,
  readMeta,
  type MtgjsonMeta,
} from "./parse";
import type { MtgjsonSource } from "./source";
import {
  databaseSizeBytes,
  errorText,
  finishRun,
  loadIdentifierIndex,
  markStaleRuns,
  prunePriceHistory,
  sanitizeErrorMessage,
  setRunSource,
  SOURCE_VERSION_MAX_CHARS,
  startRun,
  upsertPriceChunk,
  type ChunkStats,
  type Db,
  type RunStatus,
} from "./store";
import {
  isCalendarDate,
  PriceTransform,
  rowsEmitted,
  utcDateOf,
  type PriceRow,
  type PriceStats,
} from "./transform";

/** A run outcome: every status but `running`. */
export type SyncStatus = Exclude<RunStatus, "running">;

/** Milliseconds spent in each phase, rounded; `total` is the whole run. */
export interface SyncPhasesMs {
  /** Both downloads, the gzip check and the two meta reads. */
  fetch: number;
  /** Loading mtgjson_identifiers into the index. */
  identifiers: number;
  /** Streaming AllPricesToday through the parser and the transform. */
  parse: number;
  upserts: number;
  prune: number;
  total: number;
}

export interface SyncResult {
  readonly status: SyncStatus;
  /** Null when the run row could not be created (the first query failed). */
  readonly runId: number | null;
  /** Meta.json's date when it is a calendar date. */
  readonly sourceDate: string | null;
  /** Meta.json's version, cut to SOURCE_VERSION_MAX_CHARS. */
  readonly sourceVersion: string | null;
  readonly rowsWritten: number;
  readonly rowsPruned: number;
  readonly unmappedUuids: number;
  /** pg_database_size() after the prune, as a number; null for `error`. */
  readonly dbBytes: number | null;
  /** Runs this request marked `error` as abandoned (S0.3d9). */
  readonly staleRunsMarked: number;
  readonly phasesMs: SyncPhasesMs;
  /** The sanitized error text for `error`, else null. */
  readonly error: string | null;
  /** The transform's counts when AllPricesToday was parsed (not in the response). */
  readonly priceStats: PriceStats | null;
}

/** Mid-run lines: size warnings and an unfinishable row. */
export interface SyncLog {
  warn(line: string): void;
  error(line: string): void;
}

export interface SyncDeps {
  readonly db: Db;
  readonly source: MtgjsonSource;
  /** The run's clock; runDate is its UTC date (default: new Date()). */
  readonly now?: () => Date;
  /** Rows per upsert statement (default UPSERT_CHUNK_ROWS). */
  readonly chunkRows?: number;
  /** The internal deadline (default SYNC_DEADLINE_MS). */
  readonly deadlineMs?: number;
  /** Monotonic milliseconds for phases and the deadline (default performance.now). */
  readonly clock?: () => number;
  readonly log?: SyncLog;
  /** Applied to every error text before it is stored or returned (the handler hides the secret). */
  readonly redact?: (text: string) => string;
}

/** A refusal after the run row exists: the run ends `error`, nothing written. */
export class SyncRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncRefusedError";
  }
}

/** SYNC_DEADLINE_MS passed between entries or chunks (S0.3d15). */
export class SyncDeadlineError extends Error {
  constructor(deadlineMs: number) {
    super(
      `deadline exceeded: ${deadlineMs} ms into the run; committed chunks kept, nothing pruned`,
    );
    this.name = "SyncDeadlineError";
  }
}

/** The text AC-8's refusals carry. */
export const IDENTIFIERS_NOT_LOADED = "identifiers not loaded";
export const NO_RETAIL_PRICES =
  "AllPricesToday holds no TCGplayer retail prices";
export const NO_ROWS_EMITTED = "no price rows emitted";
export const UNSUPPORTED_VERSION = "unsupported MTGJson version";

const consoleLog: SyncLog = {
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

/** A limit in decimal megabytes, as the design names it ("450 MB"). */
const limitMb = (bytes: number) => `${bytes / 1e6} MB`;
const sizeMb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

/** A meta value for an error message: quoted and cut, or "none". */
const shown = (value: string | null): string =>
  value === null ? "none" : JSON.stringify(value.slice(0, 40));

/** AC-6: every meta.version must start with "5.". */
function checkVersion(meta: MtgjsonMeta, file: MtgjsonFileName): void {
  if (meta.version === null || !meta.version.startsWith(MTGJSON_SCHEMA_MAJOR)) {
    throw new SyncRefusedError(
      `${UNSUPPORTED_VERSION} ${shown(meta.version)} in ${file} (needs ${MTGJSON_SCHEMA_MAJOR}x); nothing written`,
    );
  }
}

/** Runs one daily sync. Resolves with the run's outcome; never rejects for one. */
export async function runDailySync(deps: SyncDeps): Promise<SyncResult> {
  const clock = deps.clock ?? (() => performance.now());
  const started = clock();
  const log = deps.log ?? consoleLog;
  const redact = deps.redact ?? ((text: string) => text);
  const chunkRows = deps.chunkRows ?? UPSERT_CHUNK_ROWS;
  if (!Number.isSafeInteger(chunkRows) || chunkRows < 1) {
    throw new TypeError("chunkRows must be a positive integer");
  }
  const deadlineMs = deps.deadlineMs ?? SYNC_DEADLINE_MS;
  const runDate = utcDateOf((deps.now ?? (() => new Date()))());
  const { db, source } = deps;

  const phases: SyncPhasesMs = {
    fetch: 0,
    identifiers: 0,
    parse: 0,
    upserts: 0,
    prune: 0,
    total: 0,
  };
  const timed = async <T>(
    phase: Exclude<keyof SyncPhasesMs, "total">,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const t0 = clock();
    try {
      return await fn();
    } finally {
      phases[phase] += clock() - t0;
    }
  };
  const checkDeadline = () => {
    if (clock() - started > deadlineMs) throw new SyncDeadlineError(deadlineMs);
  };
  const cleanError = (error: unknown) =>
    sanitizeErrorMessage(redact(errorText(error)));

  let runId: number | null = null;
  let staleRunsMarked = 0;
  let sourceDate: string | null = null;
  let sourceVersion: string | null = null;
  let rowsWritten = 0;
  let rowsPruned = 0;
  let unmappedUuids = 0;
  let priceStats: PriceStats | null = null;

  const result = (
    status: SyncStatus,
    dbBytes: number | null,
    error: string | null,
  ): SyncResult => {
    const phasesMs: SyncPhasesMs = {
      fetch: Math.round(phases.fetch),
      identifiers: Math.round(phases.identifiers),
      parse: Math.round(phases.parse),
      upserts: Math.round(phases.upserts),
      prune: Math.round(phases.prune),
      total: Math.round(clock() - started),
    };
    return {
      status,
      runId,
      sourceDate,
      sourceVersion,
      rowsWritten,
      rowsPruned,
      unmappedUuids,
      dbBytes,
      staleRunsMarked,
      phasesMs,
      error,
      priceStats,
    };
  };

  // --- the run row (S0.3d9, S0.3d10) -------------------------------------
  let id: number;
  try {
    staleRunsMarked = await markStaleRuns(db);
    id = await startRun(db, {
      trigger: "cron",
      sourceDate: null,
      sourceVersion: null,
    });
  } catch (error) {
    // A paused or unreachable database, or a TLS failure: no row to finish.
    return result("error", null, cleanError(error));
  }
  runId = id;

  const finish = async (
    status: SyncStatus,
    dbBytes: number | null,
  ): Promise<SyncResult> => {
    await finishRun(db, id, {
      status,
      rowsWritten,
      rowsPruned,
      unmappedUuids,
      dbBytes,
      error: null,
    });
    return result(status, dbBytes, null);
  };
  /** Prunes and reads the size after it (every non-error outcome). */
  const pruneThenSize = async (): Promise<number> => {
    rowsPruned = await timed("prune", () => prunePriceHistory(db, runDate));
    return databaseSizeBytes(db);
  };

  try {
    // --- Meta.json (AC-4, AC-6) ------------------------------------------
    const meta = await timed("fetch", async () => {
      await source.prepare([META_FILE]);
      return readMeta(source.open(META_FILE), META_FILE);
    });
    sourceDate = isCalendarDate(meta.date) ? meta.date : null;
    sourceVersion =
      meta.version === null
        ? null
        : meta.version.slice(0, SOURCE_VERSION_MAX_CHARS);
    await setRunSource(db, id, meta);
    checkVersion(meta, META_FILE);
    if (!isCalendarDate(meta.date)) {
      throw new SyncRefusedError(
        `${META_FILE} has no calendar date (meta.date ${shown(meta.date)}); nothing written`,
      );
    }
    if (meta.date !== runDate) {
      // A day MTGJson has not published yet (or a date ahead of the clock):
      // no price row is written or synthesized, and AllPricesToday is never
      // fetched. The prune still runs.
      return await finish("source_stale", await pruneThenSize());
    }
    checkDeadline();

    // --- AllPricesToday (AC-4, AC-6, AC-11) ------------------------------
    const todayMeta = await timed("fetch", async () => {
      await source.prepare([ALL_PRICES_TODAY_FILE]);
      await source.verify(ALL_PRICES_TODAY_FILE);
      return readMeta(
        source.open(ALL_PRICES_TODAY_FILE),
        ALL_PRICES_TODAY_FILE,
        {
          requireData: true,
        },
      );
    });
    checkVersion(todayMeta, ALL_PRICES_TODAY_FILE);
    if (todayMeta.date !== meta.date) {
      return await finish("source_stale", await pruneThenSize());
    }
    checkDeadline();

    // --- identifiers, then the stream into a buffer (AC-8, S0.3d12) -------
    const index = await timed("identifiers", () => loadIdentifierIndex(db));
    if (index.size === 0) {
      throw new SyncRefusedError(
        `${IDENTIFIERS_NOT_LOADED}: mtgjson_identifiers is empty (run the identifier refresh); nothing written`,
      );
    }
    checkDeadline();
    const transform = new PriceTransform(index, runDate);
    const rows: PriceRow[] = [];
    let retailEntries = 0;
    let mappedRetailEntries = 0;
    await timed("parse", async () => {
      for await (const entry of parsePrices(
        source.open(ALL_PRICES_TODAY_FILE),
        emptyParseStats(),
        ALL_PRICES_TODAY_FILE,
      )) {
        checkDeadline();
        if (entry.series.length > 0) {
          retailEntries += 1;
          if (index.get(entry.uuid) !== undefined) mappedRetailEntries += 1;
        }
        for (const row of transform.rowsFor(entry)) rows.push(row);
      }
    });
    priceStats = transform.finish();
    unmappedUuids = priceStats.unmappedUuids;
    if (retailEntries === 0) {
      throw new SyncRefusedError(
        `${NO_RETAIL_PRICES} (${priceStats.priceEntries} entries); nothing written`,
      );
    }
    if (mappedRetailEntries === 0) {
      throw new SyncRefusedError(
        `${IDENTIFIERS_NOT_LOADED}: none of the ${retailEntries} TCGplayer retail entries maps to mtgjson_identifiers (run the identifier refresh); nothing written`,
      );
    }
    if (rowsEmitted(priceStats) === 0) {
      throw new SyncRefusedError(
        `${NO_ROWS_EMITTED} (${retailEntries} retail entries, ${priceStats.gate.dropped} gated out, ${priceStats.unmappedUuids} unmapped); nothing written`,
      );
    }

    // --- the budget (AC-7, S0.3d13) --------------------------------------
    const sizeBefore = await databaseSizeBytes(db);
    let warned = false;
    if (sizeBefore > DB_STOP_BYTES) {
      log.warn(
        `price sync run ${id}: the database is ${sizeMb(sizeBefore)}, over the ${limitMb(DB_STOP_BYTES)} stop: budget_stop, no upsert, prune only`,
      );
      return await finish("budget_stop", await pruneThenSize());
    }
    if (sizeBefore > DB_WARN_BYTES) {
      warned = true;
      log.warn(
        `price sync run ${id}: the database is ${sizeMb(sizeBefore)}, over the ${limitMb(DB_WARN_BYTES)} warning; writing today's rows`,
      );
    }

    // --- upserts, each chunk its own statement and commit (AC-3, AC-5) ---
    const chunkStats: ChunkStats = { duplicateKeys: 0 };
    await timed("upserts", async () => {
      for (let at = 0; at < rows.length; at += chunkRows) {
        checkDeadline();
        rowsWritten += await upsertPriceChunk(
          db,
          rows.slice(at, at + chunkRows),
          chunkStats,
        );
      }
    });

    // --- prune and the final size ----------------------------------------
    const dbBytes = await pruneThenSize();
    if (dbBytes > DB_STOP_BYTES) {
      // Today's rows are written, so the run stays `ok` and F2 sees them;
      // the next run's pre-check stops before writing.
      log.warn(
        `price sync run ${id}: the database is ${sizeMb(dbBytes)} after the run, over the ${limitMb(DB_STOP_BYTES)} stop; the run is ok and the next run stops before writing`,
      );
    } else if (dbBytes > DB_WARN_BYTES && !warned) {
      log.warn(
        `price sync run ${id}: the database is ${sizeMb(dbBytes)} after the run, over the ${limitMb(DB_WARN_BYTES)} warning`,
      );
    }
    return await finish("ok", dbBytes);
  } catch (error) {
    const message = cleanError(error);
    try {
      await finishRun(db, id, {
        status: "error",
        rowsWritten,
        rowsPruned,
        unmappedUuids,
        dbBytes: null,
        error: message,
      });
    } catch (finishError) {
      log.error(
        sanitizeErrorMessage(
          redact(
            `price sync run ${id}: the run row could not be finished, so it stays running until the next run marks it error. Cause: ${errorText(finishError)}`,
          ),
        ),
      );
    }
    return result("error", null, message);
  }
}
