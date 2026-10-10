// Shared by every integration test that touches Postgres (S1.1d14, T21).
// AGENTS.md Databases limit: only localhost or 127.0.0.1 may be written to.
import pg from "pg";
import { hostsOf } from "../../prisma/migrate-guard";

export const LOCAL_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

export const UNREACHABLE_WARNING =
  "local Postgres unreachable: run docker compose up -d --wait db";

export class NonLocalDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonLocalDatabaseError";
  }
}

/** A host is local when it is localhost, 127.0.0.1 or an absolute Unix-socket directory. */
const isLocalHost = (host: string) =>
  LOCAL_HOSTS.includes(host) || host.startsWith("/");

/**
 * Returns the parsed URL when every host it can connect to is local; throws
 * otherwise. The hosts are the URL hostname plus every `host` and `hostaddr`
 * query parameter, because pg connects to `?host=` over the hostname (ADV.1).
 * Never echoes credentials.
 */
export function assertLocalDatabaseUrl(url: string | undefined): URL {
  if (!url) {
    throw new NonLocalDatabaseError(
      "database URL unset: integration tests need a local Postgres",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new NonLocalDatabaseError(
      "database URL does not parse: refusing to touch it",
    );
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new NonLocalDatabaseError(
      `database URL scheme ${parsed.protocol} is not postgres`,
    );
  }
  const { hosts, hostaddrs } = hostsOf(url) ?? { hosts: [], hostaddrs: [] };
  const all = [...hosts, ...hostaddrs];
  if (all.length === 0 || all.includes("")) {
    // An empty host makes pg fall back to PGHOST, which could be anywhere.
    throw new NonLocalDatabaseError(
      "refusing a database URL with no host or an empty one: integration tests run only against localhost or 127.0.0.1",
    );
  }
  const remote = all.find((host) => !isLocalHost(host));
  if (remote !== undefined) {
    throw new NonLocalDatabaseError(
      `refusing non-local database host ${remote}: integration tests run only against localhost or 127.0.0.1`,
    );
  }
  return parsed;
}

/** The same server and credentials with a different database name. */
export function withDatabase(url: string, database: string): string {
  const parsed = assertLocalDatabaseUrl(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** A unique, identifier-safe scratch database name. */
export function scratchDatabaseName(prefix: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(prefix))
    throw new Error(`bad scratch prefix: ${prefix}`);
  return `${prefix}_${process.pid}_${Date.now()}`;
}

// --- reachability (ADV.6) ----------------------------------------------------
// Only a connection-level failure means "no server here": the suite skips
// locally and fails in CI. A server that answers and refuses (bad password,
// missing role or database) is a configuration error and fails everywhere.

/**
 * Node socket and DNS errors, plus Postgres 57P03 (starting up). EAGAIN is
 * what macOS returns for `::1` when nothing listens on IPv6 loopback.
 */
const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "EAGAIN",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ECONNRESET",
  "EADDRNOTAVAIL",
  "ENOENT",
  "57P03",
]);
/** pg's own messages for a connect timeout or a dropped socket (no code). */
const UNREACHABLE_MESSAGES = [/^timeout expired$/i, /connection terminated/i];

const REJECTION_HINTS: Record<string, string> = {
  "28P01": "password authentication failed",
  "28000": "the role may not connect or does not exist",
  "3D000": "the database does not exist",
};

export type ConnectFailure =
  | { kind: "unreachable"; reason: string }
  | { kind: "rejected"; code: string; detail: string };

export function classifyConnectError(error: unknown): ConnectFailure {
  // Dual-stack `localhost` fails with an AggregateError over ::1 and
  // 127.0.0.1, whose own code is only the first attempt's: it is unreachable
  // only when every attempt is, and otherwise the first refusal decides.
  if (error instanceof AggregateError && error.errors.length > 0) {
    const parts = error.errors.map(classifyConnectError);
    const refusal = parts.find((p) => p.kind === "rejected");
    if (refusal) return refusal;
    return {
      kind: "unreachable",
      reason: parts
        .map((p) => (p.kind === "unreachable" ? p.reason : ""))
        .join(", "),
    };
  }
  const { code, message } = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
  };
  const text = typeof message === "string" ? message : String(error);
  if (typeof code === "string" && UNREACHABLE_CODES.has(code))
    return { kind: "unreachable", reason: code };
  if (
    typeof code !== "string" &&
    UNREACHABLE_MESSAGES.some((r) => r.test(text))
  )
    return { kind: "unreachable", reason: text };
  return {
    kind: "rejected",
    code: typeof code === "string" ? code : "unknown",
    detail: text.split("\n", 1)[0],
  };
}

export class LocalDatabaseRejectedError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    const hint = REJECTION_HINTS[code] ?? detail;
    super(
      `local Postgres answered but refused the connection (${code}: ${hint}): ` +
        "check the user, password and database name in .env (POSTGRES_URL_NON_POOLING). " +
        "The server is reachable, so the suite does not skip.",
    );
    this.name = "LocalDatabaseRejectedError";
    this.code = code;
  }
}

export type Reachability =
  | { reachable: true }
  | { reachable: false; reason: string };

/**
 * Connects once and runs SELECT 1. Resolves unreachable only for a
 * connection-level failure; throws LocalDatabaseRejectedError when the server
 * answers and refuses.
 */
export async function probeLocalDatabase(
  url: string,
  timeoutMs = 3_000,
): Promise<Reachability> {
  assertLocalDatabaseUrl(url);
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: timeoutMs,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return { reachable: true };
  } catch (error) {
    const failure = classifyConnectError(error);
    if (failure.kind === "unreachable")
      return { reachable: false, reason: failure.reason };
    throw new LocalDatabaseRejectedError(failure.code, failure.detail);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** True when the local server answers within timeoutMs (see probeLocalDatabase). */
export async function isReachable(
  url: string,
  timeoutMs = 3_000,
): Promise<boolean> {
  return (await probeLocalDatabase(url, timeoutMs)).reachable;
}

/** Runs fn with a connected client, always closing it. */
export async function withClient<T>(
  url: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  assertLocalDatabaseUrl(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
