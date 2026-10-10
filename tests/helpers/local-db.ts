// Shared by every integration test that touches Postgres (S1.1d14, T21).
// AGENTS.md Databases limit: only localhost or 127.0.0.1 may be written to.
import pg from "pg";

export const LOCAL_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

export const UNREACHABLE_WARNING =
  "local Postgres unreachable: run docker compose up -d --wait db";

export class NonLocalDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonLocalDatabaseError";
  }
}

/** Returns the parsed URL when its host is local; throws otherwise. Never echoes credentials. */
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
  const host = parsed.hostname.toLowerCase();
  if (!LOCAL_HOSTS.includes(host)) {
    throw new NonLocalDatabaseError(
      `refusing non-local database host ${host || "(empty)"}: integration tests run only against localhost or 127.0.0.1`,
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

/** True when the local server answers within timeoutMs. */
export async function isReachable(
  url: string,
  timeoutMs = 3_000,
): Promise<boolean> {
  assertLocalDatabaseUrl(url);
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: timeoutMs,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
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
