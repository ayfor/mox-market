// The ingest script's database client (S0.2d17), built only through the
// factory the script injects, so no test constructs one (unit tests sit
// behind S0.1d23's no-database barrier). One pg.Client, not Prisma: the
// unnest upserts need rowCount and one connection.
//
// TLS follows S0.1d20 exactly, through runtimePoolConfig: a local URL passes
// through unchanged; a remote one loses its URL TLS parameters and gets
// { rejectUnauthorized: true, ca } with the root pinned by
// POSTGRES_SSL_ROOT_CERT. Never rejectUnauthorized: false, never plaintext,
// no unverified fallback.
import pg from "pg";
import { runtimePoolConfig } from "../prisma-pool";
import type { Db } from "./store";

export interface IngestDb extends Db {
  end(): Promise<void>;
}

/** Shown in pg_stat_activity, so Josh can see the ingest on the server. */
export const INGEST_APPLICATION_NAME = "mox-mtgjson-ingest";

/** A connect that has not finished in this long fails. */
export const INGEST_CONNECT_TIMEOUT_MS = 10_000;

/**
 * A statement with no answer in this long rejects on the client (pg's
 * query_timeout; nothing is sent to the server, so S0.1d21's pooler reasoning
 * still holds). A 5,000-row chunk takes well under a second and the prune and
 * ANALYZE a few seconds, so only a dead connection reaches it: a laptop that
 * slept or changed networks would otherwise leave the run row `running`
 * forever (ADV.4).
 */
export const INGEST_QUERY_TIMEOUT_MS = 120_000;

/** TCP keepalive probes start after this much idle time (ADV.4). */
export const INGEST_KEEPALIVE_DELAY_MS = 10_000;

/** The pg.Client config for a target URL (exported for the TLS tests). */
export function ingestClientConfig(
  url: string,
  options: { caCert?: string; queryTimeoutMs?: number } = {},
): pg.ClientConfig {
  const pool = runtimePoolConfig(url, { caCert: options.caCert });
  const config: pg.ClientConfig = {
    connectionString: pool.connectionString,
    connectionTimeoutMillis: INGEST_CONNECT_TIMEOUT_MS,
    query_timeout: options.queryTimeoutMs ?? INGEST_QUERY_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: INGEST_KEEPALIVE_DELAY_MS,
    application_name: INGEST_APPLICATION_NAME,
  };
  if (pool.ssl !== undefined) config.ssl = pool.ssl as pg.ClientConfig["ssl"];
  return config;
}

/** Connects one client; rejects (before any run row) when the connect fails. */
export async function createIngestDb(
  url: string,
  options: { caCert?: string; queryTimeoutMs?: number } = {},
): Promise<IngestDb> {
  const client = new pg.Client(ingestClientConfig(url, options));
  // A dropped connection is emitted as an 'error' event; without a listener
  // it would end the process before the run row is finished. The next query
  // rejects instead, and the run ends `error` (or stays `running`, S0.2d14).
  client.on("error", () => undefined);
  await client.connect();
  return {
    query: (text, values) =>
      client.query(text, values === undefined ? undefined : [...values]),
    end: () => client.end(),
  };
}
