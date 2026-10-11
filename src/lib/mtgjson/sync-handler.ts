// The daily sync's GET handler (S0.3d2 to S0.3d6, S0.3d16; AC-1, AC-3,
// AC-9). The route file only re-exports it with its segment config, because
// Next refuses unknown exports from a route file.
//
// Nothing runs before the guard (S0.3d4): CRON_SECRET is read per request and
// checked first, and only a request that passes it imports the shared Prisma
// client (a dynamic import, so a 500 or 401 constructs no client, sends no
// query and fetches nothing), creates the per-run download directory and
// calls runDailySync. Between the two, outside Vercel Production
// (VERCEL_ENV !== "production"), every host POSTGRES_PRISMA_URL can reach
// must be localhost or 127.0.0.1, or the request is refused with 500 before
// the client loads (ADV.7): a local `npm run start` with a pulled
// production URL, or a preview that somehow holds the secret, never writes
// to the production database. The directory is a fresh mkdtemp under
// os.tmpdir() (on Vercel the only writable path is /tmp), removed whatever
// the outcome, so two overlapping runs never share a `.part` file (S0.3d6).
//
// One JSON body per run with Cache-Control: no-store, and one log line per
// run: info for `ok` and `source_stale`, warn for `budget_stop`, error for
// `error` and for a run whose row could not be finished after the prune
// (500, ADV.4). Each refusal logs one fixed line. Error text is sanitized (no URL, no user:password@host, 1,000
// characters) and the secret's value is redacted from it; the secret and the
// request's headers are never logged or returned.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hostsOf } from "../../../prisma/migrate-guard";
import { checkCronSecret, type CronSecretProblem } from "../cron-auth";
import { prismaDb } from "./prisma-db";
import { createHttpSource, type MtgjsonSource } from "./source";
import { errorText, sanitizeErrorMessage, type Db } from "./store";
import {
  runDailySync,
  type SyncDeps,
  type SyncLog,
  type SyncResult,
} from "./sync";

/** The per-run download directory's prefix under os.tmpdir(). */
export const SYNC_TEMP_PREFIX = "mox-mtgjson-";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * The one line each refusal logs (S0.3d16, ADV.9): fixed text, never the
 * request's headers or the secret. The 500 lines name what is wrong with the
 * secret (S0.3d24), so a misconfigured production cron is diagnosable from
 * the function logs; the response body stays "cron secret not configured".
 */
export const REFUSED_SECRET_LINES: Readonly<Record<CronSecretProblem, string>> =
  Object.freeze({
    unset:
      "[sync-mtgjson] refused with 500: CRON_SECRET is not configured, so nothing ran",
    placeholder:
      "[sync-mtgjson] refused with 500: CRON_SECRET is the .env.example placeholder, so nothing ran",
    whitespace:
      "[sync-mtgjson] refused with 500: CRON_SECRET has leading or trailing whitespace (a pasted or piped newline?), which no request header can match, so nothing ran",
    charset:
      "[sync-mtgjson] refused with 500: CRON_SECRET has characters outside printable ASCII, which no request header can match, so nothing ran",
    short:
      "[sync-mtgjson] refused with 500: CRON_SECRET is shorter than 32 characters, so nothing ran",
  });
export const REFUSED_UNAUTHORIZED_LINE =
  "[sync-mtgjson] refused with 401: missing or wrong Authorization header, so nothing ran";
export const REFUSED_NON_LOCAL_LINE =
  "[sync-mtgjson] refused with 500: POSTGRES_PRISMA_URL names a host other than localhost or 127.0.0.1 outside Vercel Production, so nothing ran";

/** The response bodies of the three refusals. */
export const SECRET_NOT_CONFIGURED_BODY = Object.freeze({
  error: "cron secret not configured",
});
export const UNAUTHORIZED_BODY = Object.freeze({ error: "unauthorized" });
export const NON_LOCAL_DATABASE_BODY = Object.freeze({
  error: "refusing a non-local database outside Vercel Production",
});

/** The hosts a non-production sync may write to (AGENTS.md Databases). */
const LOCAL_DATABASE_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
]);

/**
 * True when this request may reach the database POSTGRES_PRISMA_URL names
 * (ADV.7): always in Vercel Production; elsewhere only when every host it
 * can reach (the hostname and each `host` parameter) is localhost or
 * 127.0.0.1 and it sets no `hostaddr`. An unparsable URL is refused; an
 * unset one is left to the client's own load error (it connects nowhere).
 */
export function databaseAllowed(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (env.VERCEL_ENV === "production") return true;
  const url = env.POSTGRES_PRISMA_URL;
  if (url === undefined || url.trim() === "") return true;
  const parsed = hostsOf(url);
  if (parsed === null || parsed.hostaddrs.length > 0) return false;
  return (
    parsed.hosts.length > 0 &&
    parsed.hosts.every((host) => LOCAL_DATABASE_HOSTS.has(host))
  );
}

export interface SyncHandlerLog extends SyncLog {
  info(line: string): void;
}

export interface SyncHandlerDeps {
  /** CRON_SECRET, read per request (default: process.env). */
  readonly secret?: () => string | undefined;
  /** VERCEL_ENV and POSTGRES_PRISMA_URL, read per request (default: process.env). */
  readonly env?: () => Readonly<Record<string, string | undefined>>;
  /** The database, loaded only after the guard (default: the shared prisma). */
  readonly loadDb?: () => Promise<Db>;
  /** The source over a run's download directory (default: createHttpSource). */
  readonly createSource?: (cacheDir: string) => MtgjsonSource;
  readonly makeTempDir?: () => Promise<string>;
  readonly removeTempDir?: (dir: string) => Promise<void>;
  readonly now?: () => Date;
  readonly chunkRows?: number;
  readonly deadlineMs?: number;
  readonly clock?: () => number;
  readonly log?: SyncHandlerLog;
  readonly runSync?: (deps: SyncDeps) => Promise<SyncResult>;
}

/** The shared runtime client (verified TLS, pg's default pool; S0.3d5). */
async function sharedPrismaDb(): Promise<Db> {
  const { prisma } = await import("@/lib/prisma");
  return prismaDb(prisma);
}

const defaultMakeTempDir = () =>
  mkdtemp(path.join(os.tmpdir(), SYNC_TEMP_PREFIX));
const defaultRemoveTempDir = (dir: string) =>
  rm(dir, { recursive: true, force: true });

/** Every occurrence of the secret's value replaced (defense in depth). */
export function redactSecret(text: string, secret: string): string {
  return secret === "" ? text : text.split(secret).join("[redacted]");
}

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: NO_STORE });

/**
 * The response body: the run summary, plus `error` whenever the result has one; only
 * `{ status, runId: null, error }` when no run row exists.
 */
export function responseBody(result: SyncResult): Record<string, unknown> {
  if (result.runId === null) {
    return { status: result.status, runId: null, error: result.error };
  }
  const body = {
    status: result.status,
    runId: result.runId,
    sourceDate: result.sourceDate,
    sourceVersion: result.sourceVersion,
    rowsWritten: result.rowsWritten,
    rowsPruned: result.rowsPruned,
    unmappedUuids: result.unmappedUuids,
    dbBytes: result.dbBytes,
    staleRunsMarked: result.staleRunsMarked,
    phasesMs: result.phasesMs,
  };
  return result.error !== null ? { ...body, error: result.error } : body;
}

/**
 * A failed run: `error`, or another status whose row could not be finished
 * (ADV.4). Either answers 500 and logs at error level.
 */
export const runFailed = (result: SyncResult): boolean =>
  result.status === "error" || result.error !== null;

/** The one log line a run writes. */
export function summaryLine(result: SyncResult): string {
  const parts = [
    `[sync-mtgjson] run ${result.runId ?? "none"} ${result.status}:`,
    `source_date=${result.sourceDate ?? "none"}`,
    `rows_written=${result.rowsWritten}`,
    `rows_pruned=${result.rowsPruned}`,
    `unmapped_uuids=${result.unmappedUuids}`,
    `db_bytes=${result.dbBytes ?? "none"}`,
    `stale_runs_marked=${result.staleRunsMarked}`,
    `phases_ms=${JSON.stringify(result.phasesMs)}`,
  ];
  if (result.error !== null) parts.push(`error=${result.error}`);
  return parts.join(" ");
}

/** An `error` outcome with no run row (the database or the directory failed first). */
function noRunResult(error: string): SyncResult {
  return {
    status: "error",
    runId: null,
    sourceDate: null,
    sourceVersion: null,
    rowsWritten: 0,
    rowsPruned: 0,
    unmappedUuids: 0,
    dbBytes: null,
    staleRunsMarked: 0,
    phasesMs: {
      fetch: 0,
      identifiers: 0,
      parse: 0,
      upserts: 0,
      prune: 0,
      total: 0,
    },
    error,
    priceStats: null,
  };
}

/** The GET handler; route.ts exports `createSyncHandler()` as GET. */
export function createSyncHandler(
  deps: SyncHandlerDeps = {},
): (request: Request) => Promise<Response> {
  const log: SyncHandlerLog = deps.log ?? {
    info: (line) => console.info(line),
    warn: (line) => console.warn(line),
    error: (line) => console.error(line),
  };
  const readSecret = deps.secret ?? (() => process.env.CRON_SECRET);
  const readEnv = deps.env ?? (() => process.env);
  const loadDb = deps.loadDb ?? sharedPrismaDb;
  const createSource =
    deps.createSource ?? ((cacheDir: string) => createHttpSource({ cacheDir }));
  const makeTempDir = deps.makeTempDir ?? defaultMakeTempDir;
  const removeTempDir = deps.removeTempDir ?? defaultRemoveTempDir;
  const runSync = deps.runSync ?? runDailySync;

  return async function GET(request: Request): Promise<Response> {
    const secret = readSecret();
    const auth = checkCronSecret(request.headers.get("authorization"), secret);
    if (!auth.ok) {
      if (auth.status === 500) {
        log.error(REFUSED_SECRET_LINES[auth.problem]);
        return json(SECRET_NOT_CONFIGURED_BODY, 500);
      }
      log.warn(REFUSED_UNAUTHORIZED_LINE);
      return json(UNAUTHORIZED_BODY, 401);
    }
    if (!databaseAllowed(readEnv())) {
      log.error(REFUSED_NON_LOCAL_LINE);
      return json(NON_LOCAL_DATABASE_BODY, 500);
    }
    const redact = (text: string) => redactSecret(text, secret ?? "");
    const clean = (error: unknown) =>
      sanitizeErrorMessage(redact(errorText(error)));

    let db: Db;
    try {
      db = await loadDb();
    } catch (error) {
      const failed = noRunResult(clean(error));
      log.error(summaryLine(failed));
      return json(responseBody(failed), 500);
    }

    let dir: string;
    try {
      dir = await makeTempDir();
    } catch (error) {
      const failed = noRunResult(clean(error));
      log.error(summaryLine(failed));
      return json(responseBody(failed), 500);
    }

    let result: SyncResult;
    try {
      result = await runSync({
        db,
        source: createSource(dir),
        now: deps.now,
        chunkRows: deps.chunkRows,
        deadlineMs: deps.deadlineMs,
        clock: deps.clock,
        log,
        redact,
      });
    } catch (error) {
      // runDailySync resolves on every run outcome; a throw is a bug.
      result = noRunResult(clean(error));
    } finally {
      await removeTempDir(dir).catch((error: unknown) =>
        log.warn(
          `[sync-mtgjson] the run's download directory was not removed: ${clean(error)}`,
        ),
      );
    }

    const line = summaryLine(result);
    const failed = runFailed(result);
    if (failed) log.error(line);
    else if (result.status === "budget_stop") log.warn(line);
    else log.info(line);
    return json(responseBody(result), failed ? 500 : 200);
  };
}
