// The runtime pg pool settings behind src/lib/prisma.ts (S0.1d20, S0.1d21).
//
// TLS (S0.1 ADV.1). pg-connection-string treats sslmode=require as
// verify-full against Node's CA store, while the Prisma CLI only encrypts, so
// Josh's schema-engine steps can pass while every runtime read fails a
// certificate check. This module makes the runtime posture explicit instead
// of leaving it to the URL: a remote host always gets TLS with certificate
// and host-name verification, never plaintext and never an unverified
// fallback, whatever sslmode the URL carries. POSTGRES_SSL_ROOT_CERT (PEM)
// pins the root it trusts (Supabase's own root CA in production); unset, it
// is Node's CA store. localhost URLs pass through unchanged.
//
// Bounds (S0.1 ADV.4). F2's race abandons a read at HISTORY_TIMEOUT_MS but
// cannot cancel it, so the history client's pool bounds its own work: a
// connect or a pool-slot wait gives up after connectionTimeoutMillis, a query
// after query_timeout (pg then destroys that connection, freeing its slot),
// and at most `max` connections exist per instance. These are client-side
// limits; a server-side statement_timeout is open for Josh (S0.1d21).
import type { PrismaPg } from "@prisma/adapter-pg";

/** The pool config PrismaPg accepts (it bundles its own pg typings). */
export type RuntimePoolConfig = Exclude<
  ConstructorParameters<typeof PrismaPg>[0],
  { connect: unknown }
>;

/** What runtimePoolConfig sets on a pool, as its own type for tests. */
export interface PoolLimits {
  readonly max: number;
  readonly connectionTimeoutMillis: number;
  readonly query_timeout: number;
  readonly idleTimeoutMillis: number;
}

/** The history reader's pool (S0.1d21): small, and nothing waits unbounded. */
export const HISTORY_POOL_LIMITS: PoolLimits = Object.freeze({
  max: 5,
  connectionTimeoutMillis: 3_000,
  query_timeout: 2_000,
  idleTimeoutMillis: 10_000,
});

/** Hosts that never get TLS forced on them (local development and CI). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * URL parameters that pg-connection-string turns into its own `ssl` value,
 * which would override the explicit one: stripped from a remote URL.
 */
export const URL_TLS_PARAMS: readonly string[] = [
  "ssl",
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "sslpassword",
  "sslnegotiation",
  "uselibpqcompat",
];

const PEM_CERTIFICATE =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

/**
 * POSTGRES_SSL_ROOT_CERT as PEM text, or undefined when unset or empty.
 * Literal "\n" sequences (a single-line paste) become newlines. Anything that
 * is not a PEM certificate throws, without echoing the value.
 */
export function rootCertFrom(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const pem = value.replace(/\\n/g, "\n").trim();
  if (!PEM_CERTIFICATE.test(pem)) {
    throw new Error("POSTGRES_SSL_ROOT_CERT is not a PEM certificate");
  }
  return `${pem}\n`;
}

/** Every host a URL can reach: its hostname and each `host` parameter. */
function hostsOf(url: URL): string[] {
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
  const params = url.searchParams
    .getAll("host")
    .flatMap((h) => h.split(","))
    .map((h) => h.trim());
  return [hostname, ...params];
}

/** True when every host is localhost, 127.0.0.1, ::1 or a socket directory. */
export function isLocalOnly(url: URL): boolean {
  const hosts = hostsOf(url);
  return hosts.every(
    (h) => h !== "" && (LOCAL_HOSTS.has(h) || h.startsWith("/")),
  );
}

/** Verified TLS: the pinned root when given, else Node's CA store. */
export function remoteTls(caCert: string | undefined): {
  rejectUnauthorized: true;
  ca?: string;
} {
  return caCert === undefined
    ? { rejectUnauthorized: true }
    : { rejectUnauthorized: true, ca: caCert };
}

/**
 * The pool config for a runtime client. A local URL is passed through as is;
 * a remote one loses its URL TLS parameters and gets remoteTls(caCert).
 * Throws, without echoing the URL, when it does not parse.
 */
export function runtimePoolConfig(
  connectionString: string,
  options: { caCert?: string; limits?: PoolLimits } = {},
): RuntimePoolConfig {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("POSTGRES_PRISMA_URL does not parse as a URL");
  }
  const limits = options.limits ?? {};
  if (isLocalOnly(url)) return { connectionString, ...limits };
  for (const name of URL_TLS_PARAMS) url.searchParams.delete(name);
  return {
    connectionString: url.toString(),
    ssl: remoteTls(options.caCert),
    ...limits,
  };
}
