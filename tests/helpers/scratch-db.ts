// Shared by S0.1's integration files (S0.1d10, AC-10): what S1.1's
// prisma/baseline.int.test.ts does inline. Every helper checks the URL is
// local (AGENTS.md Databases limit) before it opens a socket or spawns Prisma.
// An unreachable server fails when CI=true and skips with a warning otherwise;
// a server that answers and refuses fails everywhere (ADV.6).
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  assertLocalDatabaseUrl,
  probeLocalDatabase,
  scratchDatabaseName,
  UNREACHABLE_WARNING,
  withClient,
  withDatabase,
} from "./local-db";

export const ROOT = path.resolve(__dirname, "..", "..");
const PRISMA_CLI = path.join(
  ROOT,
  "node_modules",
  "prisma",
  "build",
  "index.js",
);

export const IN_CI = process.env.CI === "true";

/** Every database URL variable a Prisma command, the app or pg could read. */
export const DATABASE_URL_VARS = [
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL",
] as const;

export type ServerProbe =
  | { reachable: true; url: string }
  | { reachable: false; url: string | undefined; reason: string };

/**
 * Refuses the run when any set database URL can reach a non-local host (this
 * throws before any connection attempt), then probes the server named by
 * POSTGRES_URL_NON_POOLING. When it is unreachable outside CI, the skip
 * warning goes straight to stderr: Vitest hides console output from a file
 * whose tests all skip.
 */
export async function probeScratchServer(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ServerProbe> {
  for (const name of DATABASE_URL_VARS) {
    const value = env[name];
    if (value !== undefined && value !== "") assertLocalDatabaseUrl(value);
  }
  const url = env.POSTGRES_URL_NON_POOLING;
  const probe = url
    ? await probeLocalDatabase(url, 3_000)
    : { reachable: false as const, reason: "POSTGRES_URL_NON_POOLING unset" };
  if (probe.reachable) return { reachable: true, url: url! };
  if (!IN_CI) {
    process.stderr.write(`⚠ ${UNREACHABLE_WARNING} (${probe.reason})\n`);
  }
  return { reachable: false, url, reason: probe.reason };
}

/** The CI-only failure message when the postgres:16 service is unreachable. */
export const CI_UNREACHABLE_TEST =
  "the postgres:16 service must be reachable in CI";

export interface ScratchDatabase {
  readonly name: string;
  readonly url: string;
}

/** CREATE DATABASE on the local server; returns its name and URL. */
export async function createScratchDatabase(
  serverUrl: string,
  prefix: string,
): Promise<ScratchDatabase> {
  assertLocalDatabaseUrl(serverUrl);
  const name = scratchDatabaseName(prefix);
  const url = withDatabase(serverUrl, name);
  await withClient(serverUrl, (c) => c.query(`CREATE DATABASE "${name}"`));
  return { name, url };
}

/**
 * The shape scratchDatabaseName returns: prefix, pid, 13-digit millisecond
 * time. Only such a name may be force-dropped, so a slip that passes the
 * developer's own database (mox_market) or postgres is refused (S0.1 ADV.11).
 */
export const SCRATCH_NAME = /^[a-z_][a-z0-9_]*_\d+_\d{13}$/;

/** DROP DATABASE … WITH (FORCE), so an open pool never blocks the drop. */
export async function dropScratchDatabase(
  serverUrl: string,
  name: string,
): Promise<void> {
  assertLocalDatabaseUrl(serverUrl);
  if (!SCRATCH_NAME.test(name)) {
    throw new Error("bad scratch database name");
  }
  await withClient(serverUrl, (c) =>
    c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
  );
}

/**
 * Runs the Prisma CLI against url only: DATABASE_URL, ALLOW_PROD_MIGRATE and
 * Vitest's own variables are scrubbed from its environment, and both URL
 * variables are set to url, after the local check.
 */
export function prismaCli(
  args: readonly string[],
  url: string,
): { status: number | null; output: string } {
  assertLocalDatabaseUrl(url);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("VITEST") ||
      key === "DATABASE_URL" ||
      key === "ALLOW_PROD_MIGRATE"
    ) {
      delete env[key];
    }
  }
  env.POSTGRES_URL_NON_POOLING = url;
  env.POSTGRES_PRISMA_URL = url;
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 50_000,
  });
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
}
