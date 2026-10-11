// runBulkIngest: F0 W1 and W4 (S0.2d14, S0.2d15; AC-3, AC-4, AC-6 to
// AC-11), shared by the script and the tests. Every dependency is injected
// (source, clock, database factory, Scryfall), so each path runs offline.
//
// Order: sources prepared → every meta version checked, and each data file's
// `data` object found right after its meta → source dates checked (a refusal
// on path C, a warning otherwise) → every .gz verified end to end →
// identifiers parsed into memory (none is a refusal) → (write runs) connect,
// budget pre-check → run row `running` → identifiers upserted → prices
// streamed, gated and upserted in chunks, size re-checked every
// BUDGET_RECHECK_CHUNKS chunks → (no price row at all is an error) → prune →
// ANALYZE → final size check → run row `ok` or `budget_stop`. Anything that
// fails before the run row is a refusal (IngestRefusedError, exit 2) and
// writes nothing, not even a run row; a fault or an interrupt after it ends
// the row `error` and rejects (exit 1), with earlier chunks committed. A
// dry-run never calls the database factory.
import {
  BASIS_RESERVOIR_FACTOR,
  BasisReservoir,
  runBasisSample,
  seedFromDate,
  type BasisDeps,
  type BasisResult,
} from "./basis";
import {
  ALL_IDENTIFIERS_FILE,
  ALL_PRICES_FILE,
  BUDGET_RECHECK_CHUNKS,
  BULK_MIN_FREE_BYTES,
  DB_FREE_TIER_BYTES,
  DB_STOP_BYTES,
  DB_WARN_BYTES,
  META_FILE,
  MTGJSON_SCHEMA_MAJOR,
  UPSERT_CHUNK_ROWS,
  type MtgjsonFileName,
} from "./consts";
import type { IngestDb } from "./db";
import {
  emptyParseStats,
  parseIdentifiers,
  parsePrices,
  readMeta,
  type MtgjsonMeta,
  type ParseStats,
} from "./parse";
import type { MtgjsonSource } from "./source";
import {
  analyzeTables,
  databaseSizeBytes,
  errorText,
  finishRun,
  priceHistoryIsEmpty,
  prunePriceHistory,
  sanitizeErrorMessage,
  startRun,
  upsertIdentifierChunk,
  upsertPriceChunk,
  type ChunkStats,
  type RunStatus,
} from "./store";
import { IngestRefusedError, type IngestTarget } from "./target";
import {
  IdentifierIndex,
  isCalendarDate,
  PriceTransform,
  rowsEmitted,
  utcDateOf,
  type IdentifierRow,
  type IdentifierStats,
  type PriceRow,
  type PriceStats,
} from "./transform";

/** Exit codes (S0.2d14). */
export const EXIT = { ok: 0, error: 1, refused: 2, budgetStop: 3 } as const;

/** The operator interrupted a run (Ctrl-C or SIGTERM; ADV.4). */
export class IngestInterruptedError extends Error {
  constructor(reason: string) {
    super(`interrupted by ${reason}`);
    this.name = "IngestInterruptedError";
  }
}

/** A write run whose sources produced nothing to store (ADV.1). */
export class NothingToWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NothingToWriteError";
  }
}

export interface IngestRequest {
  readonly target: IngestTarget;
  readonly identifiersOnly: boolean;
  /** Dry-run only: N series compared with Scryfall, and the seed. */
  readonly basisSample?: { readonly size: number; readonly seed?: number };
}

export interface IngestDeps {
  readonly source: MtgjsonSource;
  readonly now: () => Date;
  /** Called only for write targets, after every source check passed. */
  readonly dbFactory: (
    target: Exclude<IngestTarget, { kind: "dry-run" }>,
  ) => Promise<IngestDb>;
  /** Progress and warnings (the script writes them to stderr). */
  readonly log?: (line: string) => void;
  readonly chunkRows?: number;
  readonly recheckChunks?: number;
  readonly basis?: Omit<BasisDeps, "today" | "log">;
  /** Peak resident set size in bytes (default: process.resourceUsage). */
  readonly peakRssBytes?: () => number;
  /**
   * Aborted by the script's SIGINT/SIGTERM handler: the run stops at the next
   * chunk or entry and its row is finished `error` (ADV.4).
   */
  readonly signal?: AbortSignal;
  /** Called once the run row exists (the script's interrupt handler reads it). */
  readonly onRunStarted?: (runId: number) => void;
}

export interface FileMeta {
  readonly file: MtgjsonFileName;
  readonly date: string | null;
  readonly version: string | null;
}

export interface WriteSummary {
  readonly status: Exclude<RunStatus, "running" | "source_stale">;
  readonly runId: number;
  readonly rowsWritten: number;
  readonly identifierRowsWritten: number;
  readonly priceRowsWritten: number;
  readonly rowsPruned: number;
  readonly dbBytesBefore: number;
  readonly dbBytes: number | null;
  readonly chunks: number;
}

export interface IngestReport {
  readonly mode: IngestTarget["kind"];
  readonly identifiersOnly: boolean;
  readonly runDate: string;
  readonly source: string;
  readonly files: readonly FileMeta[];
  readonly parse: ParseStats;
  readonly identifiers: IdentifierStats & {
    readonly stored: number;
    readonly printings: number;
  };
  /** Null for --identifiers-only. */
  readonly prices: PriceStats | null;
  readonly duplicateKeys: number;
  readonly write: WriteSummary | null;
  readonly basis: BasisResult | null;
  readonly warnings: readonly string[];
  readonly durationMs: number;
  readonly peakRssBytes: number;
}

export interface IngestResult {
  readonly exitCode: number;
  readonly report: IngestReport;
}

const defaultPeakRss = () => process.resourceUsage().maxRSS * 1024;

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

/** AC-4: every meta.version must start with "5.". */
function checkVersion(meta: MtgjsonMeta, file: string): void {
  if (meta.version === null || !meta.version.startsWith(MTGJSON_SCHEMA_MAJOR)) {
    throw new IngestRefusedError(
      `${file}: meta.version ${JSON.stringify(meta.version)} does not start with ${MTGJSON_SCHEMA_MAJOR}; stopped before any database write`,
    );
  }
}

/** Wraps a pre-check failure as a refusal (exit 2) that names the cause. */
function refusal(error: unknown): Error {
  if (error instanceof IngestRefusedError) return error;
  if (error instanceof IngestInterruptedError) return error;
  return new IngestRefusedError(
    `${errorText(error)}; stopped before any database write`,
  );
}

/** Runs one ingest. Resolves with exit code 0 or 3; rejects otherwise. */
export async function runBulkIngest(
  request: IngestRequest,
  deps: IngestDeps,
): Promise<IngestResult> {
  const started = performance.now();
  const log = deps.log ?? (() => undefined);
  const chunkRows = deps.chunkRows ?? UPSERT_CHUNK_ROWS;
  const recheckChunks = deps.recheckChunks ?? BUDGET_RECHECK_CHUNKS;
  if (!Number.isSafeInteger(chunkRows) || chunkRows < 1) {
    throw new TypeError("chunkRows must be a positive integer");
  }
  const runDate = utcDateOf(deps.now());
  const { identifiersOnly, target } = request;
  const { source } = deps;
  if (request.basisSample && (target.kind !== "dry-run" || identifiersOnly)) {
    throw new IngestRefusedError("--basis-sample runs only with --dry-run");
  }
  const warnings: string[] = [];
  const warn = (line: string) => {
    warnings.push(line);
    log(`warning: ${line}`);
  };

  // --- pre-checks: nothing below may write (AC-4, S0.2d4, S0.2d5) ----------
  const files: MtgjsonFileName[] = identifiersOnly
    ? [META_FILE, ALL_IDENTIFIERS_FILE]
    : [META_FILE, ALL_IDENTIFIERS_FILE, ALL_PRICES_FILE];
  const metas: FileMeta[] = [];
  const checkInterrupted = () => {
    if (deps.signal?.aborted) {
      const reason: unknown = deps.signal.reason;
      throw new IngestInterruptedError(
        typeof reason === "string" ? reason : "a signal",
      );
    }
  };
  try {
    await source.prepare(files);
    for (const file of files) {
      // A data file must hold `data` right after `meta` (ADV.1), so a write
      // run refuses a file with no data before it connects.
      const meta = await readMeta(source.open(file), file, {
        requireData: file !== META_FILE,
      });
      checkVersion(meta, file);
      metas.push({ file, ...meta });
    }
  } catch (error) {
    throw refusal(error);
  }
  const dataMeta = metas.find(
    (m) =>
      m.file === (identifiersOnly ? ALL_IDENTIFIERS_FILE : ALL_PRICES_FILE),
  )!;
  const metaJson = metas.find((m) => m.file === META_FILE)!;
  // Source dates (ADV.2): a stale or mismatched source would end `ok` with
  // finished_at = now, so getHistoryFreshness would call days-old prices
  // fresh. Path C refuses it; paths A and B warn (the runbook proceeds to
  // path C only after a path A that printed "warnings: none").
  const dateProblems: string[] = [];
  if (metaJson.date !== dataMeta.date) {
    dateProblems.push(
      `Meta.json is dated ${metaJson.date}, ${dataMeta.file} ${dataMeta.date}`,
    );
  }
  if (
    !identifiersOnly &&
    isCalendarDate(dataMeta.date) &&
    dataMeta.date < runDate &&
    Date.parse(runDate) - Date.parse(dataMeta.date) > 86_400_000
  ) {
    dateProblems.push(
      `${ALL_PRICES_FILE} is dated ${dataMeta.date}, more than one day before runDate ${runDate}`,
    );
  }
  if (target.kind === "production") {
    if (!isCalendarDate(dataMeta.date)) {
      throw new IngestRefusedError(
        `${dataMeta.file}: meta.date ${JSON.stringify(dataMeta.date)} is not a calendar date; path C needs a dated source. Stopped before any database write`,
      );
    }
    if (dateProblems.length > 0) {
      throw new IngestRefusedError(
        `${dateProblems.join("; ")}. Path C loads only a current source: run path A again to download today's files. Stopped before any database write`,
      );
    }
  }
  for (const line of dateProblems) warn(line);
  try {
    for (const file of files) {
      if (file === META_FILE) continue;
      log(`verifying ${file} (gzip CRC, end to end)`);
      await source.verify(file);
    }
  } catch (error) {
    throw refusal(error);
  }

  const parseStats = emptyParseStats();
  const index = new IdentifierIndex();
  const reservoir =
    request.basisSample !== undefined
      ? new BasisReservoir(
          request.basisSample.size * BASIS_RESERVOIR_FACTOR,
          request.basisSample.seed ?? seedFromDate(dataMeta.date),
        )
      : null;
  const transform = identifiersOnly
    ? null
    : new PriceTransform(index, runDate, (series) => reservoir?.offer(series));
  const chunkStats: ChunkStats = { duplicateKeys: 0 };

  // Identifiers are read into memory before any connection (ADV.1): a parse
  // fault is a refusal, and a file with no usable identifier (every entry
  // missing `identifiers.scryfallId`, say) would map no price at all, so it
  // is refused rather than run to an `ok` with 0 rows.
  try {
    log(`reading ${ALL_IDENTIFIERS_FILE}`);
    for await (const raw of parseIdentifiers(
      source.open(ALL_IDENTIFIERS_FILE),
      parseStats,
      ALL_IDENTIFIERS_FILE,
    )) {
      checkInterrupted();
      index.add(raw);
    }
    log(`  ${index.size} identifiers, ${index.printings} printings`);
  } catch (error) {
    throw refusal(error);
  }
  if (index.size === 0) {
    throw new IngestRefusedError(
      `${ALL_IDENTIFIERS_FILE}: identifiers not loaded (0 usable entries; ${index.stats.invalidIdentifiers} invalid). Stopped before any database write`,
    );
  }

  const report = (
    write: WriteSummary | null,
    basis: BasisResult | null,
  ): IngestReport => ({
    mode: target.kind,
    identifiersOnly,
    runDate,
    source: source.description,
    files: metas,
    parse: parseStats,
    identifiers: {
      ...index.stats,
      stored: index.size,
      printings: index.printings,
    },
    prices: transform === null ? null : transform.finish(),
    duplicateKeys: chunkStats.duplicateKeys,
    write,
    basis,
    warnings,
    durationMs: Math.round(performance.now() - started),
    peakRssBytes: (deps.peakRssBytes ?? defaultPeakRss)(),
  });

  // --- path A: no database client, ever (AC-6) -----------------------------
  if (target.kind === "dry-run") {
    try {
      if (transform !== null) {
        log(`reading ${ALL_PRICES_FILE}`);
        for await (const entry of parsePrices(
          source.open(ALL_PRICES_FILE),
          parseStats,
          ALL_PRICES_FILE,
        )) {
          checkInterrupted();
          transform.rowsFor(entry);
        }
      }
    } catch (error) {
      throw refusal(error);
    }
    if (transform !== null && rowsEmitted(transform.stats) === 0) {
      warn(
        "no price rows emitted: a write run with these files would end error",
      );
    }
    let basis: BasisResult | null = null;
    if (reservoir !== null && request.basisSample) {
      log(`basis sample: ${request.basisSample.size} series from Scryfall`);
      basis = await runBasisSample(reservoir, request.basisSample.size, {
        ...deps.basis,
        today: utcDateOf(deps.now()),
        log,
      });
      if (basis.incomplete) {
        warn(
          `basis sample incomplete: ${basis.pairs.length} of ${basis.requested} pairs, no verdict`,
        );
      }
    }
    return { exitCode: EXIT.ok, report: report(null, basis) };
  }

  // --- paths B and C: connect, then the budget pre-check (AC-9) ------------
  let db: IngestDb;
  try {
    db = await deps.dbFactory(target);
  } catch (error) {
    throw refusal(error);
  }
  try {
    let dbBytesBefore: number;
    try {
      dbBytesBefore = await databaseSizeBytes(db);
      const empty = await priceHistoryIsEmpty(db);
      if (dbBytesBefore > DB_WARN_BYTES) {
        throw new IngestRefusedError(
          `the database is ${mb(dbBytesBefore)}, over the ${mb(DB_WARN_BYTES)} limit for a bulk run; nothing written`,
        );
      }
      if (empty && DB_FREE_TIER_BYTES - dbBytesBefore < BULK_MIN_FREE_BYTES) {
        throw new IngestRefusedError(
          `price_history is empty and only ${mb(DB_FREE_TIER_BYTES - dbBytesBefore)} of ${mb(DB_FREE_TIER_BYTES)} is free; a first run needs ${mb(BULK_MIN_FREE_BYTES)}. Nothing written`,
        );
      }
    } catch (error) {
      throw refusal(error);
    }

    const runId = await startRun(db, {
      trigger: identifiersOnly ? "identifiers" : "bulk",
      sourceDate: isCalendarDate(dataMeta.date) ? dataMeta.date : null,
      sourceVersion: dataMeta.version,
    });
    deps.onRunStarted?.(runId);

    let chunks = 0;
    let identifierRowsWritten = 0;
    let priceRowsWritten = 0;
    let rowsPruned = 0;
    let budgetStop = false;
    let warnedOverWarn = false;

    /** After every recheckChunks-th chunk: stop over 450 MB, warn over 400 MB. */
    const afterChunk = async () => {
      chunks += 1;
      checkInterrupted();
      if (chunks % recheckChunks !== 0) return;
      const size = await databaseSizeBytes(db);
      if (size > DB_STOP_BYTES) {
        budgetStop = true;
        warn(
          `database is ${mb(size)} after chunk ${chunks}, over ${mb(DB_STOP_BYTES)}: budget_stop`,
        );
      } else if (size > DB_WARN_BYTES) {
        warnedOverWarn = true;
        warn(
          `database is ${mb(size)} after chunk ${chunks}, over ${mb(DB_WARN_BYTES)}`,
        );
      }
    };

    try {
      let batch: IdentifierRow[] = [];
      for (const row of index.rows()) {
        if (budgetStop) break;
        batch.push(row);
        if (batch.length >= chunkRows) {
          identifierRowsWritten += await upsertIdentifierChunk(db, batch);
          batch = [];
          await afterChunk();
        }
      }
      if (!budgetStop && batch.length > 0) {
        identifierRowsWritten += await upsertIdentifierChunk(db, batch);
        await afterChunk();
      }

      if (transform !== null && !budgetStop) {
        log(`reading ${ALL_PRICES_FILE}`);
        let rows: PriceRow[] = [];
        const flush = async (count: number) => {
          const chunk = rows.slice(0, count);
          rows = rows.slice(count);
          priceRowsWritten += await upsertPriceChunk(db, chunk, chunkStats);
          await afterChunk();
        };
        for await (const entry of parsePrices(
          source.open(ALL_PRICES_FILE),
          parseStats,
          ALL_PRICES_FILE,
        )) {
          checkInterrupted();
          for (const row of transform.rowsFor(entry)) rows.push(row);
          while (!budgetStop && rows.length >= chunkRows) {
            await flush(chunkRows);
          }
          if (budgetStop) break;
        }
        if (!budgetStop && rows.length > 0) await flush(rows.length);
        // ADV.1: a source that emits nothing (AllPrices with an empty data
        // object, or no UUID that maps) must not end `ok`, or F2 would read
        // this run as a fresh success; nor may it prune.
        if (!budgetStop && rowsEmitted(transform.stats) === 0) {
          throw new NothingToWriteError(
            `no price rows emitted (${transform.stats.priceEntries} price entries, ${transform.stats.unmappedUuids} unmapped); nothing pruned`,
          );
        }
      }

      if (transform !== null) {
        rowsPruned = await prunePriceHistory(db, runDate);
      }
      await analyzeTables(db, { prices: transform !== null });
      const dbBytes = await databaseSizeBytes(db);
      // The re-check runs every recheckChunks chunks, so up to that many
      // trailing chunks were never checked: the final size is (SEC-3, ADV.12).
      if (!budgetStop && dbBytes > DB_STOP_BYTES) {
        budgetStop = true;
        warn(
          `database is ${mb(dbBytes)} at the end of the run, over ${mb(DB_STOP_BYTES)}: budget_stop`,
        );
      } else if (!budgetStop && !warnedOverWarn && dbBytes > DB_WARN_BYTES) {
        warn(
          `database is ${mb(dbBytes)} at the end of the run, over ${mb(DB_WARN_BYTES)}`,
        );
      }
      const status = budgetStop ? "budget_stop" : "ok";
      const rowsWritten = identifiersOnly
        ? identifierRowsWritten
        : priceRowsWritten;
      await finishRun(db, runId, {
        status,
        rowsWritten,
        rowsPruned,
        unmappedUuids: transform?.stats.unmappedUuids ?? 0,
        dbBytes,
        error: null,
      });
      const write: WriteSummary = {
        status,
        runId,
        rowsWritten,
        identifierRowsWritten,
        priceRowsWritten,
        rowsPruned,
        dbBytesBefore,
        dbBytes,
        chunks,
      };
      return {
        exitCode: budgetStop ? EXIT.budgetStop : EXIT.ok,
        report: report(write, null),
      };
    } catch (error) {
      try {
        await finishRun(db, runId, {
          status: "error",
          rowsWritten: identifiersOnly
            ? identifierRowsWritten
            : priceRowsWritten,
          rowsPruned,
          unmappedUuids: transform?.stats.unmappedUuids ?? 0,
          dbBytes: null,
          error: errorText(error),
        });
      } catch (finishError) {
        log(
          sanitizeErrorMessage(
            `the run row could not be finished, so it stays running until S0.3 marks it error. Cause: ${errorText(finishError)}`,
          ),
        );
      }
      throw error;
    }
  } finally {
    await db.end().catch(() => undefined);
  }
}
