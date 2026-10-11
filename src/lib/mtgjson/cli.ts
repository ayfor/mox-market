// The ingest CLI's body (S0.2d18; ADV.4, ADV.5, ADV.7, ADV.13, ADV.15),
// apart from scripts/ingest-mtgjson-history.ts so every exit code and every
// line it prints is testable without a process. The script only captures
// ALLOW_PROD_INGEST before anything else is imported, installs the signal
// handlers and calls runCli with the real environment, .env loader, clock and
// clients.
//
// Order inside runCli: argv parsed strictly → .env loaded (after the inline
// flag was captured, never overriding the shell) → the target guard → the
// target line → the source → runBulkIngest → the report. Every error line is
// sanitized (no URL, no user:password@host) before it is printed.
import path from "node:path";
import { createIngestDb } from "./db";
import {
  EXIT,
  runBulkIngest,
  type IngestDeps,
  type IngestRequest,
  type IngestResult,
} from "./ingest";
import { formatReport } from "./report";
import {
  createDirSource,
  createHttpSource,
  type MtgjsonSource,
} from "./source";
import { errorText, sanitizeErrorMessage } from "./store";
import {
  IngestRefusedError,
  parseCliArgs,
  resolveTarget,
  targetLine,
  usage,
  UsageError,
  type CliOptions,
} from "./target";

/**
 * The repository root, from this file's own location (src/lib/mtgjson), never
 * the working directory: the cache and .env resolve here wherever the script
 * is run from (ADV.5).
 */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The download source's cache: `<repo>/.cache/mtgjson`, gitignored. */
export function defaultCacheDir(): string {
  return path.join(REPO_ROOT, ".cache", "mtgjson");
}

/** The repo's .env, loaded after the inline flag is captured. */
export const REPO_DOTENV = path.join(REPO_ROOT, ".env");

/** Printed on exit 3 (the runbook's exit-code table). */
export const BUDGET_STOP_MESSAGE =
  "budget_stop: the database passed 450 MB. Earlier chunks are committed and the prune ran. Stop and ask Bitey before any re-run.";

export interface CliDeps {
  readonly argv: readonly string[];
  /** The process environment; loadEnv may add to it. */
  readonly env: Record<string, string | undefined>;
  /** ALLOW_PROD_INGEST as captured before any module or .env could set it. */
  readonly inlineAllowProdIngest: string | undefined;
  /** Loads .env into env without overriding (dotenv); called before the guard. */
  readonly loadEnv: () => void;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly now?: () => Date;
  /** Aborted by the script's interrupt handler (ADV.4). */
  readonly signal?: AbortSignal;
  readonly onRunStarted?: (runId: number) => void;
  readonly createSource?: (
    sourceDir: string | null,
    log: (line: string) => void,
  ) => MtgjsonSource;
  readonly dbFactory?: IngestDeps["dbFactory"];
  readonly runIngest?: (
    request: IngestRequest,
    deps: IngestDeps,
  ) => Promise<IngestResult>;
}

/**
 * The exit code and the stderr line for a run that threw: 2 for a refusal or
 * a usage error (nothing was written), 1 for anything else (a run error after
 * the run row started, an interrupt included).
 */
export function failureOf(error: unknown): { code: number; message: string } {
  if (error instanceof IngestRefusedError || error instanceof UsageError) {
    return {
      code: EXIT.refused,
      message: sanitizeErrorMessage(error.message),
    };
  }
  return {
    code: EXIT.error,
    message: `run error: ${sanitizeErrorMessage(errorText(error))}. Earlier chunks stay committed; a re-run is safe.`,
  };
}

function defaultSource(
  sourceDir: string | null,
  log: (line: string) => void,
): MtgjsonSource {
  return sourceDir !== null
    ? createDirSource(path.resolve(sourceDir))
    : createHttpSource({ cacheDir: defaultCacheDir(), log });
}

/** Runs the CLI once and resolves with its exit code; never rejects. */
export async function runCli(deps: CliDeps): Promise<number> {
  const { out, err } = deps;
  let options: CliOptions;
  try {
    options = parseCliArgs(deps.argv);
  } catch (error) {
    err(
      `usage error: ${sanitizeErrorMessage(error instanceof Error ? error.message : String(error))}`,
    );
    err(usage());
    return EXIT.refused;
  }
  if (options.help) {
    out(usage());
    return EXIT.ok;
  }
  try {
    // .env loads only now, after ALLOW_PROD_INGEST was captured, so a copy
    // stored in any .env* file never counts (ADV.15).
    deps.loadEnv();
    const target = resolveTarget(options, deps.env, deps.inlineAllowProdIngest);
    out(targetLine(target));
    const source = (deps.createSource ?? defaultSource)(options.sourceDir, err);
    const { exitCode, report } = await (deps.runIngest ?? runBulkIngest)(
      {
        target,
        identifiersOnly: options.identifiersOnly,
        basisSample:
          options.basisSample === null
            ? undefined
            : { size: options.basisSample, seed: options.seed ?? undefined },
      },
      {
        source,
        now: deps.now ?? (() => new Date()),
        dbFactory:
          deps.dbFactory ??
          ((write) => createIngestDb(write.url, { caCert: write.caCert })),
        log: err,
        signal: deps.signal,
        onRunStarted: deps.onRunStarted,
      },
    );
    out(formatReport(report));
    if (exitCode === EXIT.budgetStop) err(BUDGET_STOP_MESSAGE);
    return exitCode;
  } catch (error) {
    const failure = failureOf(error);
    err(failure.message);
    return failure.code;
  }
}

/**
 * The script's SIGINT/SIGTERM handler (ADV.4). Before the run row exists,
 * nothing has been written, so it exits at once (2). After it, the first
 * signal aborts the run, which stops at the next chunk or entry and finishes
 * its row `error`; a second signal exits at once (1) and leaves the row
 * `running` for S0.3 to mark `error` after STALE_RUN_MS. A statement that
 * never answers is bounded by the client's query timeout.
 */
export function interruptHandler(options: {
  readonly controller: AbortController;
  readonly isRunStarted: () => boolean;
  readonly err: (line: string) => void;
  readonly exit: (code: number) => void;
}): (signal: string) => void {
  const { controller, isRunStarted, err, exit } = options;
  return (signal) => {
    if (!isRunStarted()) {
      err(`${signal}: stopped before any database write`);
      exit(EXIT.refused);
      return;
    }
    if (!controller.signal.aborted) {
      err(
        `${signal}: stopping after the current statement and finishing the run row as error. ${signal} again exits at once and leaves the row running (S0.3 marks it error after an hour).`,
      );
      controller.abort(signal);
      return;
    }
    err(
      `${signal} again: exiting now; the run row stays running until S0.3 marks it error`,
    );
    exit(EXIT.error);
  };
}
