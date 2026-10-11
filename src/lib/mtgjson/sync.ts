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
// verified end to end and its meta read (version `5.`; no calendar date:
// `error`; a calendar date other than Meta.json's: `source_stale`) →
// mtgjson_identifiers loaded → AllPricesToday streamed through the S0.2
// parser and transform into a buffer that keeps only runDate's rows, up to
// SYNC_MAX_ROWS → the refusals that need the whole file (no identifier, no
// retail series, none maps, no row) → pg_database_size: over DB_STOP_BYTES
// prune and `budget_stop`, over DB_WARN_BYTES a warning → upserts in chunks,
// each its own statement and commit → prune → final size → `ok`.
//
// Statuses: `ok`, `source_stale` and `budget_stop` are normal outcomes;
// anything that fails before the prune ends the row `error`, keeps committed
// chunks and never prunes, so a bad day never shrinks history and never reads
// as a fresh success to getHistoryFreshness(). A failure before the row
// exists (the first query) returns `error` with runId null. The function
// never rejects for a run outcome; the handler maps the status to HTTP.
//
// After the prune has committed, nothing rewrites the row as `error` (ADV.4):
// a failed final size read finishes the computed status with db_bytes null
// and a warning, and a failed final UPDATE is logged and returned with the
// computed status plus an `error` text (the handler answers 500), because
// the UPDATE may have committed before its connection dropped.
//
// The deadline (SYNC_DEADLINE_MS, S0.3d15) is checked between entries and
// chunks, and every statement and download races the time left (ADV.2), so a
// hung connect, query or download ends the run instead of Vercel's kill. The
// final UPDATE gets its own SYNC_FINISH_GRACE_MS, so the outcome is still
// recorded after the deadline fires.
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
  SYNC_FINISH_GRACE_MS,
  SYNC_MAX_ROWS,
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
  PRUNE_SQL,
  prunePriceHistory,
  sanitizeErrorMessage,
  setRunSource,
  SOURCE_VERSION_MAX_CHARS,
  startRun,
  UPSERT_PRICES_SQL,
  upsertPriceChunk,
  type ChunkStats,
  type Db,
  type RunStatus,
} from "./store";
import {
  isCalendarDate,
  PriceTransform,
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
  /** The outcome; with a non-null `error`, `ok`, `source_stale` and `budget_stop` mean the row may not show it. */
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
  /** pg_database_size() after the prune, as a number; null for `error` or an unreadable size. */
  readonly dbBytes: number | null;
  /** Runs this request marked `error` as abandoned (S0.3d9). */
  readonly staleRunsMarked: number;
  readonly phasesMs: SyncPhasesMs;
  /**
   * The sanitized error text: always set for `error`; set for another status
   * only when the run row's final UPDATE failed after the prune (ADV.4).
   */
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
  /** The final UPDATE's own bound (default SYNC_FINISH_GRACE_MS). */
  readonly finishGraceMs?: number;
  /** The most runDate rows a run may write (default SYNC_MAX_ROWS). */
  readonly maxRows?: number;
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

/** SYNC_DEADLINE_MS passed (S0.3d15): between entries or chunks, or while awaiting. */
export class SyncDeadlineError extends Error {
  constructor(deadlineMs: number, stage: string, consequence: string) {
    super(
      `deadline exceeded: ${deadlineMs} ms into the run, during ${stage}; ${consequence}`,
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
export const TOO_MANY_ROWS = "too many price rows";

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

/** AC-4: a meta.date must be a calendar date, else the file is refused. */
function checkCalendarDate(meta: MtgjsonMeta, file: MtgjsonFileName): string {
  if (!isCalendarDate(meta.date)) {
    throw new SyncRefusedError(
      `${file} has no calendar date (meta.date ${shown(meta.date)}); nothing written`,
    );
  }
  return meta.date;
}

/** The longest delay setTimeout honours. */
const MAX_TIMER_MS = 2_147_483_647;

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
};

/** Runs one daily sync. Resolves with the run's outcome; never rejects for one. */
export async function runDailySync(deps: SyncDeps): Promise<SyncResult> {
  const clock = deps.clock ?? (() => performance.now());
  const started = clock();
  const log = deps.log ?? consoleLog;
  const redact = deps.redact ?? ((text: string) => text);
  const chunkRows = positiveInteger(
    deps.chunkRows ?? UPSERT_CHUNK_ROWS,
    "chunkRows",
  );
  const maxRows = positiveInteger(deps.maxRows ?? SYNC_MAX_ROWS, "maxRows");
  const deadlineMs = deps.deadlineMs ?? SYNC_DEADLINE_MS;
  const finishGraceMs = deps.finishGraceMs ?? SYNC_FINISH_GRACE_MS;
  const runDate = utcDateOf((deps.now ?? (() => new Date()))());
  const { db: rawDb, source } = deps;

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

  // --- the deadline (S0.3d15, ADV.2) -------------------------------------
  let stage = "the stale-run update";
  let upsertsSent = 0;
  let pruneSent = false;
  const consequence = () =>
    pruneSent
      ? "the prune was sent and may still complete; committed rows kept"
      : upsertsSent > 0
        ? "committed chunks kept, nothing pruned"
        : "nothing written";
  const deadlineError = () =>
    new SyncDeadlineError(deadlineMs, stage, consequence());
  const timeLeft = () => deadlineMs - (clock() - started);
  const checkDeadline = () => {
    if (timeLeft() < 0) throw deadlineError();
  };
  /** Starts `work` only inside the deadline, then races it against the time left. */
  const bounded = <T>(work: () => Promise<T>): Promise<T> => {
    const left = timeLeft();
    if (left < 0) return Promise.reject(deadlineError());
    // setTimeout fires at once past 2^31 − 1 ms; no real deadline is that long.
    if (left > MAX_TIMER_MS) return work();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(deadlineError()), left);
    });
    return Promise.race([work(), expiry]).finally(() => clearTimeout(timer));
  };
  /** The run's database: every statement bounded by the deadline. */
  const db: Db = {
    query: (text, values) =>
      bounded(() => {
        if (text === UPSERT_PRICES_SQL) upsertsSent += 1;
        if (text === PRUNE_SQL) pruneSent = true;
        return rawDb.query(text, values);
      }),
  };
  /** The final UPDATE: its own bound, on the unbounded database. */
  const graced = <T>(work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `the run row's final update took longer than ${finishGraceMs} ms`,
            ),
          ),
        finishGraceMs,
      );
    });
    return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
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
    stage = "the run row's insert";
    id = await startRun(db, {
      trigger: "cron",
      sourceDate: null,
      sourceVersion: null,
    });
  } catch (error) {
    // A paused or unreachable database, a TLS failure or a hung connect: no
    // row to finish.
    return result("error", null, cleanError(error));
  }
  runId = id;

  /**
   * Records a non-error outcome. Every caller has pruned, so a failed UPDATE
   * is never rewritten as `error` (ADV.4): it is logged, and the result keeps
   * the status with an `error` text so the handler answers 500.
   */
  const finish = async (
    status: SyncStatus,
    dbBytes: number | null,
  ): Promise<SyncResult> => {
    try {
      await graced(
        finishRun(rawDb, id, {
          status,
          rowsWritten,
          rowsPruned,
          unmappedUuids,
          dbBytes,
          error: null,
        }),
      );
    } catch (finishError) {
      const cause = cleanError(finishError);
      log.error(
        sanitizeErrorMessage(
          `price sync run ${id}: the outcome ${status} may not be recorded: the run row's final update failed after the prune, so the row may stay running until the next run marks it abandoned. Cause: ${cause}`,
        ),
      );
      return result(
        status,
        dbBytes,
        sanitizeErrorMessage(`outcome ${status} not recorded: ${cause}`),
      );
    }
    return result(status, dbBytes, null);
  };
  /**
   * Prunes and reads the size after it (every non-error outcome). Once the
   * prune has committed, an unreadable size is a warning, not an error.
   */
  const pruneThenSize = async (): Promise<number | null> => {
    stage = "the prune";
    rowsPruned = await timed("prune", () => prunePriceHistory(db, runDate));
    stage = "the size read after the prune";
    try {
      return await databaseSizeBytes(db);
    } catch (error) {
      log.warn(
        sanitizeErrorMessage(
          `price sync run ${id}: the database size after the prune could not be read, so db_bytes stays empty. Cause: ${cleanError(error)}`,
        ),
      );
      return null;
    }
  };

  try {
    // --- Meta.json (AC-4, AC-6) ------------------------------------------
    stage = META_FILE;
    const meta = await bounded(() =>
      timed("fetch", async () => {
        await source.prepare([META_FILE]);
        return readMeta(source.open(META_FILE), META_FILE);
      }),
    );
    sourceDate = isCalendarDate(meta.date) ? meta.date : null;
    sourceVersion =
      meta.version === null
        ? null
        : meta.version.slice(0, SOURCE_VERSION_MAX_CHARS);
    stage = "the run row's source update";
    await setRunSource(db, id, meta);
    checkVersion(meta, META_FILE);
    const metaDate = checkCalendarDate(meta, META_FILE);
    if (metaDate !== runDate) {
      // A day MTGJson has not published yet (or a date ahead of the clock):
      // no price row is written or synthesized, and AllPricesToday is never
      // fetched. The prune still runs.
      return await finish("source_stale", await pruneThenSize());
    }
    checkDeadline();

    // --- AllPricesToday (AC-4, AC-6, AC-11) ------------------------------
    stage = ALL_PRICES_TODAY_FILE;
    const todayMeta = await bounded(() =>
      timed("fetch", async () => {
        await source.prepare([ALL_PRICES_TODAY_FILE]);
        await source.verify(ALL_PRICES_TODAY_FILE);
        return readMeta(
          source.open(ALL_PRICES_TODAY_FILE),
          ALL_PRICES_TODAY_FILE,
          {
            requireData: true,
          },
        );
      }),
    );
    checkVersion(todayMeta, ALL_PRICES_TODAY_FILE);
    // A missing or malformed date is a format change, refused like
    // Meta.json's (ADV.1); only a real calendar date that differs is stale.
    const todayDate = checkCalendarDate(todayMeta, ALL_PRICES_TODAY_FILE);
    if (todayDate !== metaDate) {
      return await finish("source_stale", await pruneThenSize());
    }
    checkDeadline();

    // --- identifiers, then the stream into a buffer (AC-8, S0.3d12) -------
    stage = "the identifier load";
    const index = await timed("identifiers", () => loadIdentifierIndex(db));
    if (index.size === 0) {
      throw new SyncRefusedError(
        `${IDENTIFIERS_NOT_LOADED}: mtgjson_identifiers is empty (run the identifier refresh); nothing written`,
      );
    }
    checkDeadline();
    stage = "the parse";
    const transform = new PriceTransform(index, runDate);
    const rows: PriceRow[] = [];
    let retailEntries = 0;
    let mappedRetailEntries = 0;
    let otherDateRows = 0;
    await bounded(() =>
      timed("parse", async () => {
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
          for (const row of transform.rowsFor(entry)) {
            // Only today's rows (S0.3d25): older window dates are path C's
            // backfill, never the daily sync's.
            if (row.date !== runDate) {
              otherDateRows += 1;
              continue;
            }
            if (rows.length >= maxRows) {
              throw new SyncRefusedError(
                `${TOO_MANY_ROWS}: ${ALL_PRICES_TODAY_FILE} emits more than ${maxRows} rows for ${runDate}; nothing written`,
              );
            }
            rows.push(row);
          }
        }
      }),
    );
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
    if (rows.length === 0) {
      throw new SyncRefusedError(
        `${NO_ROWS_EMITTED} for ${runDate} (${retailEntries} retail entries, ${priceStats.gate.dropped} gated out, ${priceStats.unmappedUuids} unmapped, ${otherDateRows} on other dates); nothing written`,
      );
    }
    if (otherDateRows > 0) {
      log.warn(
        `price sync run ${id}: ${ALL_PRICES_TODAY_FILE} carried ${otherDateRows} in-window prices dated other than ${runDate}; only ${runDate}'s ${rows.length} rows are written`,
      );
    }

    // --- the budget (AC-7, S0.3d13) --------------------------------------
    stage = "the size check";
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
    stage = "the upserts";
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
    if (dbBytes !== null && dbBytes > DB_STOP_BYTES) {
      // Today's rows are written, so the run stays `ok` and F2 sees them;
      // the next run's pre-check stops before writing.
      log.warn(
        `price sync run ${id}: the database is ${sizeMb(dbBytes)} after the run, over the ${limitMb(DB_STOP_BYTES)} stop; the run is ok and the next run stops before writing`,
      );
    } else if (dbBytes !== null && dbBytes > DB_WARN_BYTES && !warned) {
      log.warn(
        `price sync run ${id}: the database is ${sizeMb(dbBytes)} after the run, over the ${limitMb(DB_WARN_BYTES)} warning`,
      );
    }
    return await finish("ok", dbBytes);
  } catch (error) {
    // Only faults before the prune commits reach here (finish and
    // pruneThenSize's size read handle their own), so `error` never prunes.
    const message = cleanError(error);
    try {
      await graced(
        finishRun(rawDb, id, {
          status: "error",
          rowsWritten,
          rowsPruned,
          unmappedUuids,
          dbBytes: null,
          error: message,
        }),
      );
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
