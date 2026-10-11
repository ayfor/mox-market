// The ingest script's arguments and its target guard (S0.2d16, S0.2d18,
// S0.2d24; AC-9). Pure: argv and env come in as values, nothing is read from
// process.env here, nothing connects.
//
// Paths (F0 W1): A `--dry-run` reads no database URL at all; B writes only
// to localhost or 127.0.0.1; C (`--production`) is Josh's alone and needs,
// together, the flag, ALLOW_PROD_INGEST exactly "1" captured from the
// environment before any .env file was loaded (a stored copy never counts),
// and POSTGRES_SSL_ROOT_CERT as PEM (S0.1d20's verified TLS). Refused
// outright, flags or not: an unset or unparsable URL, a non-postgres scheme,
// an empty host, hostaddr, any host query parameter, ::1 and socket
// directories. Messages name the host and never the user or password.
//
// The printed target line is the operator's last check before a write, so it
// must be what pg dials (ADV.14): a write URL names its port and database
// explicitly (pg would otherwise take PGPORT, PGDATABASE or a default), may
// not carry the query parameters pg reads as connection settings (port,
// dbname, database, user, options; any case), and writes a local host
// exactly as `localhost` or `127.0.0.1` (pg dials the raw string).
import { parseArgs } from "node:util";
import { hostsOf } from "../../../prisma/migrate-guard";
import { rootCertFrom } from "../prisma-pool";

/** Refused before any write: guard, version, source, gzip or budget (exit 2). */
export class IngestRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestRefusedError";
  }
}

/** Bad command-line arguments (exit 2). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** The script's flags (T18 checks every documented command against them). */
export const FLAGS = {
  "dry-run": {
    type: "boolean",
    description: "path A: download or reuse the files and report; no database",
  },
  production: {
    type: "boolean",
    description:
      "path C, Josh only: write to a non-local host (needs ALLOW_PROD_INGEST=1 inline and POSTGRES_SSL_ROOT_CERT)",
  },
  "identifiers-only": {
    type: "boolean",
    description:
      "W4: refresh mtgjson_identifiers only; AllPrices is never opened",
  },
  "source-dir": {
    type: "string",
    description:
      "read Meta.json and the .gz files from this directory instead of downloading",
  },
  "basis-sample": {
    type: "string",
    description:
      "with --dry-run: compare N kept series (1-100) with live Scryfall prices",
  },
  seed: {
    type: "string",
    description:
      "with --basis-sample: the sample's seed (default from AllPrices' date)",
  },
  help: { type: "boolean", description: "print this help" },
} as const;

export interface CliOptions {
  readonly dryRun: boolean;
  readonly production: boolean;
  readonly identifiersOnly: boolean;
  readonly sourceDir: string | null;
  readonly basisSample: number | null;
  readonly seed: number | null;
  readonly help: boolean;
}

const INTEGER = /^\d+$/;

/** Strict parse of the script's argv (no positionals, no unknown flags). */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: Object.fromEntries(
        Object.entries(FLAGS).map(([name, { type }]) => [name, { type }]),
      ),
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
  const options: CliOptions = {
    dryRun: values["dry-run"] === true,
    production: values.production === true,
    identifiersOnly: values["identifiers-only"] === true,
    sourceDir:
      typeof values["source-dir"] === "string" ? values["source-dir"] : null,
    basisSample: null,
    seed: null,
    help: values.help === true,
  };
  if (options.help) return options;
  if (options.dryRun && options.production) {
    throw new UsageError("--dry-run and --production cannot be combined");
  }
  if (options.sourceDir !== null && options.sourceDir.trim() === "") {
    throw new UsageError("--source-dir needs a directory");
  }
  // A connection string pasted here by mistake would be echoed in a
  // missing-file message, so anything URL-shaped is refused unechoed (ADV.13).
  if (
    options.sourceDir !== null &&
    (options.sourceDir.includes("://") || options.sourceDir.includes("@"))
  ) {
    throw new UsageError(
      "--source-dir takes a directory path, not a URL (the value is not shown)",
    );
  }
  const sample = values["basis-sample"];
  let basisSample: number | null = null;
  if (typeof sample === "string") {
    if (!options.dryRun) {
      throw new UsageError("--basis-sample runs only with --dry-run");
    }
    if (options.identifiersOnly) {
      throw new UsageError(
        "--basis-sample needs prices, not --identifiers-only",
      );
    }
    const n = INTEGER.test(sample) ? Number(sample) : NaN;
    if (!Number.isSafeInteger(n) || n < 1 || n > 100) {
      throw new UsageError("--basis-sample takes an integer from 1 to 100");
    }
    basisSample = n;
  }
  const seedText = values.seed;
  let seed: number | null = null;
  if (typeof seedText === "string") {
    if (basisSample === null) {
      throw new UsageError("--seed applies only to --basis-sample");
    }
    const n = INTEGER.test(seedText) ? Number(seedText) : NaN;
    if (!Number.isSafeInteger(n) || n > 0xffffffff) {
      throw new UsageError("--seed takes an integer from 0 to 4294967295");
    }
    seed = n;
  }
  return { ...options, basisSample, seed };
}

/** The script's --help text. */
export function usage(): string {
  const lines = [
    "Usage: npx tsx scripts/ingest-mtgjson-history.ts [flags]",
    "",
    "Paths (docs/runbooks/mtgjson-ingest.md):",
    "  A  --dry-run                  no database; report only",
    "  B  (no flag)                  write to POSTGRES_URL_NON_POOLING on localhost or 127.0.0.1",
    "  C  --production               Josh only: ALLOW_PROD_INGEST=1 inline, POSTGRES_SSL_ROOT_CERT set",
    "",
    "Flags:",
    ...Object.entries(FLAGS).map(
      ([name, { type, description }]) =>
        `  --${name}${type === "string" ? " <value>" : ""}`.padEnd(30) +
        description,
    ),
    "",
    "Exit codes: 0 ok, 1 run error, 2 refused before any write, 3 budget_stop.",
  ];
  return lines.join("\n");
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Query parameters pg-connection-string turns into connection settings that
 * change where or as whom pg connects (ADV.14). `host` and `hostaddr` have
 * their own messages above.
 */
export const REFUSED_URL_PARAMS = [
  "port",
  "dbname",
  "database",
  "user",
  "options",
] as const;

export type IngestTarget =
  | { readonly kind: "dry-run" }
  | {
      readonly kind: "local" | "production";
      readonly url: string;
      /** host:port/database, never credentials. */
      readonly display: string;
      /** PEM, for production only. */
      readonly caCert?: string;
    };

/** host:port/database for printing; never the user or password. */
function displayOf(host: string, port: string, database: string): string {
  return `${host}:${port}/${database}`;
}

/**
 * AC-9's guard. Runs before any download or connection; throws
 * IngestRefusedError (exit 2) on every refusal.
 *
 * @param options the parsed flags
 * @param env the process environment (only POSTGRES_URL_NON_POOLING and
 *   POSTGRES_SSL_ROOT_CERT are read)
 * @param allowProdIngest ALLOW_PROD_INGEST as captured before .env loaded
 */
export function resolveTarget(
  options: Pick<CliOptions, "dryRun" | "production">,
  env: Readonly<Record<string, string | undefined>>,
  allowProdIngest: string | undefined,
): IngestTarget {
  if (options.dryRun) return { kind: "dry-run" };
  const refuse = (why: string) =>
    new IngestRefusedError(`refusing to run: ${why}. Nothing was written.`);

  const raw = env.POSTGRES_URL_NON_POOLING;
  if (raw === undefined || raw.trim() === "") {
    throw refuse("POSTGRES_URL_NON_POOLING is unset");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw refuse("POSTGRES_URL_NON_POOLING does not parse as a URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw refuse("POSTGRES_URL_NON_POOLING is not a postgres URL");
  }
  const parsed = hostsOf(raw);
  if (parsed === null) throw refuse("the database URL does not parse");
  if (parsed.hostaddrs.length > 0) {
    throw refuse("the database URL sets hostaddr, which hides the real host");
  }
  if (parsed.hostParams.length > 0) {
    throw refuse(
      "the database URL has a host query parameter, which overrides its hostname",
    );
  }
  if (parsed.hosts.length === 0 || parsed.hosts.includes("")) {
    throw refuse("the database URL names no host or an empty one");
  }
  for (const host of parsed.hosts) {
    let decodedHost = host;
    try {
      decodedHost = decodeURIComponent(host);
    } catch {
      throw refuse("the database host does not decode");
    }
    if (decodedHost.startsWith("/") || host.includes("%")) {
      throw refuse(
        "a socket directory is not a database host here; use localhost",
      );
    }
    if (host === "::1" || host === "[::1]") {
      throw refuse("::1 is not on the local list; use localhost or 127.0.0.1");
    }
  }
  const settings = [...url.searchParams.keys()]
    .map((key) => key.trim().toLowerCase())
    .filter((key) => (REFUSED_URL_PARAMS as readonly string[]).includes(key));
  if (settings.length > 0) {
    throw refuse(
      `the database URL sets ${[...new Set(settings)].join(", ")} as a query parameter, which pg dials instead of what the target line shows`,
    );
  }
  // pg dials the raw host string; the guard's list is the normalized one.
  const rawHosts = url.hostname.split(",");
  for (const [i, host] of parsed.hosts.entries()) {
    if (LOCAL_HOSTS.has(host) && rawHosts[i] !== host) {
      throw refuse(
        "write a local host exactly as localhost or 127.0.0.1 (lower case, no trailing dot)",
      );
    }
  }
  if (url.port === "") {
    throw refuse(
      "the database URL must name its port (pg would otherwise use PGPORT or 5432)",
    );
  }
  let database = url.pathname.replace(/^\//, "");
  try {
    database = decodeURIComponent(database);
  } catch {
    throw refuse("the database name does not decode");
  }
  if (database === "") {
    throw refuse(
      "the database URL must name its database (pg would otherwise use PGDATABASE or the user's name)",
    );
  }
  const remoteAt = parsed.hosts.findIndex((h) => !LOCAL_HOSTS.has(h));
  const remote = remoteAt === -1 ? undefined : parsed.hosts[remoteAt];
  if (remote === undefined) {
    if (options.production) {
      throw refuse(
        `--production names a local host (${parsed.hosts[0]}); path C is for the production database only`,
      );
    }
    return {
      kind: "local",
      url: raw,
      display: displayOf(parsed.hosts[0], url.port, database),
    };
  }
  if (!options.production || allowProdIngest !== "1") {
    throw refuse(
      `non-local database host ${remote} needs both --production and ALLOW_PROD_INGEST=1 set inline (path C, Josh only)`,
    );
  }
  let caCert: string | undefined;
  try {
    caCert = rootCertFrom(env.POSTGRES_SSL_ROOT_CERT);
  } catch {
    throw refuse("POSTGRES_SSL_ROOT_CERT is not a PEM certificate");
  }
  if (caCert === undefined) {
    throw refuse(
      "--production needs POSTGRES_SSL_ROOT_CERT (Supabase's root CA, PEM) in this shell",
    );
  }
  return {
    kind: "production",
    url: raw,
    display: displayOf(rawHosts[remoteAt] ?? remote, url.port, database),
    caCert,
  };
}

/** The line printed before connecting (S0.2d16). */
export function targetLine(target: IngestTarget): string {
  if (target.kind === "dry-run") return "target database: none (dry-run)";
  return `target database: ${target.display} (${target.kind === "local" ? "local" : "PRODUCTION"})`;
}
