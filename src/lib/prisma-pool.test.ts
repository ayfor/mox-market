// S0.1 ADV.1 (S0.1d20) and ADV.4 (S0.1d21): the runtime pool's TLS posture
// and bounds. No database: the config tests build pg's own connection
// parameters offline, and the socket tests talk to a fake server on
// 127.0.0.1 that this file starts and stops.
import { PrismaClient } from "@/generated/prisma/client";
import { HISTORY_TIMEOUT_MS } from "@/lib/evaluation/consts";
import { errorCodes } from "@/lib/evaluation/load-market-snapshot";
import {
  HistoryTimeoutError,
  withTimeout,
} from "@/lib/evaluation/with-timeout";
import { createPriceHistoryReader } from "@/lib/price-history";
import { PrismaPg } from "@prisma/adapter-pg";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  HISTORY_POOL_LIMITS,
  isLocalOnly,
  remoteTls,
  rootCertFrom,
  runtimePoolConfig,
  URL_TLS_PARAMS,
} from "./prisma-pool";

const ID_A = "f3537373-ef54-4578-9d05-6216420ee349";
const POOLER =
  "postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const CA = [
  "-----BEGIN CERTIFICATE-----",
  "TUlJQnRlc3Q=",
  "-----END CERTIFICATE-----",
  "",
].join("\n");

/** What pg itself would use: its ConnectionParameters, built offline. */
function effectiveSsl(config: ReturnType<typeof runtimePoolConfig>) {
  const client = new pg.Client(config as pg.ClientConfig);
  return (client as unknown as { ssl: unknown }).ssl;
}

describe("TLS to a remote host is explicit and verified (ADV.1, S0.1d20)", () => {
  test("the control: pg reads sslmode=require as verify-full against Node's CA store, with no pinned root", () => {
    const raw = new pg.Client({
      connectionString: `${POOLER}?sslmode=require&pgbouncer=true`,
    });
    // ssl {} means TLS with rejectUnauthorized defaulting to true and Node's
    // default roots: a Supabase-signed chain fails that check (ADV-UP-1).
    expect((raw as unknown as { ssl: unknown }).ssl).toEqual({});
  });

  test("a Supabase pooler URL with sslmode=require&pgbouncer=true verifies against the pinned root", () => {
    const config = runtimePoolConfig(
      `${POOLER}?sslmode=require&pgbouncer=true`,
      { caCert: CA },
    );
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: CA });
    const url = new URL(config.connectionString!);
    expect(url.searchParams.has("sslmode")).toBe(false);
    expect(url.searchParams.get("pgbouncer")).toBe("true");
    expect(url.hostname).toBe("aws-0-us-east-1.pooler.supabase.com");
    // pg's merge would let a URL sslmode override ssl; stripped, it cannot.
    expect(effectiveSsl(config)).toEqual({ rejectUnauthorized: true, ca: CA });
  });

  test("without POSTGRES_SSL_ROOT_CERT it still verifies, against Node's CA store", () => {
    const config = runtimePoolConfig(`${POOLER}?sslmode=require`);
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(effectiveSsl(config)).toEqual({ rejectUnauthorized: true });
  });

  test.each([
    ["no sslmode at all (never plaintext)", ""],
    ["sslmode=disable", "?sslmode=disable"],
    ["sslmode=prefer", "?sslmode=prefer"],
    ["sslmode=no-verify", "?sslmode=no-verify"],
    ["libpq-compatible require", "?uselibpqcompat=true&sslmode=require"],
    ["ssl=false", "?ssl=false"],
    ["a sslrootcert path", "?sslmode=verify-full&sslrootcert=/tmp/x.crt"],
  ])("%s on a remote host still gets verified TLS", (_name, query) => {
    const config = runtimePoolConfig(`${POOLER}${query}`, { caCert: CA });
    expect(effectiveSsl(config)).toEqual({ rejectUnauthorized: true, ca: CA });
    const url = new URL(config.connectionString!);
    for (const name of URL_TLS_PARAMS) {
      expect(url.searchParams.has(name)).toBe(false);
    }
  });

  test("a localhost URL with ?host= naming a remote host is remote", () => {
    const config = runtimePoolConfig(
      "postgresql://u:p@localhost:5432/db?host=db.x.supabase.co",
    );
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  test.each([
    "postgresql://postgres:postgres@localhost:5432/mox_market",
    "postgresql://postgres@127.0.0.1:55432/postgres",
    "postgresql://postgres@[::1]:5432/postgres",
    "postgresql://postgres@localhost/postgres?host=/var/run/postgresql",
    "postgresql://postgres@localhost:5432/postgres?sslmode=disable",
  ])("a local URL passes through unchanged: %s", (url) => {
    expect(runtimePoolConfig(url)).toEqual({ connectionString: url });
    expect(isLocalOnly(new URL(url))).toBe(true);
  });

  test("an unparsable URL throws without echoing it", () => {
    expect(() => runtimePoolConfig("not a url secret-pw")).toThrow(
      "POSTGRES_PRISMA_URL does not parse as a URL",
    );
    try {
      runtimePoolConfig("not a url secret-pw");
    } catch (error) {
      expect(String(error)).not.toContain("secret-pw");
    }
  });

  test("remoteTls never disables verification", () => {
    expect(remoteTls(undefined)).toEqual({ rejectUnauthorized: true });
    expect(remoteTls(CA)).toEqual({ rejectUnauthorized: true, ca: CA });
  });
});

describe("POSTGRES_SSL_ROOT_CERT (rootCertFrom)", () => {
  test("unset or blank → undefined (Node's CA store)", () => {
    expect(rootCertFrom(undefined)).toBeUndefined();
    expect(rootCertFrom("")).toBeUndefined();
    expect(rootCertFrom("  \n")).toBeUndefined();
  });

  test("a PEM certificate is kept; literal \\n sequences become newlines", () => {
    expect(rootCertFrom(CA)).toBe(CA);
    expect(rootCertFrom(CA.trim().split("\n").join("\\n"))).toBe(CA);
  });

  test("anything else throws without echoing the value", () => {
    expect(() => rootCertFrom("not-a-cert-secret")).toThrow(
      "POSTGRES_SSL_ROOT_CERT is not a PEM certificate",
    );
    try {
      rootCertFrom("not-a-cert-secret");
    } catch (error) {
      expect(String(error)).not.toContain("not-a-cert-secret");
    }
  });
});

describe("the history pool's bounds (ADV.4, S0.1d21)", () => {
  test("HISTORY_POOL_LIMITS are finite and frozen", () => {
    expect(HISTORY_POOL_LIMITS).toEqual({
      max: 5,
      connectionTimeoutMillis: 3_000,
      query_timeout: 2_000,
      idleTimeoutMillis: 10_000,
    });
    expect(Object.isFrozen(HISTORY_POOL_LIMITS)).toBe(true);
    // Each bound outlasts F2's race, so a slow but healthy read still
    // completes and keeps its warm connection.
    expect(HISTORY_POOL_LIMITS.query_timeout).toBeGreaterThan(
      HISTORY_TIMEOUT_MS,
    );
  });

  test("limits are merged into both local and remote configs", () => {
    expect(
      runtimePoolConfig("postgresql://u@localhost:5432/db", {
        limits: HISTORY_POOL_LIMITS,
      }),
    ).toEqual({
      connectionString: "postgresql://u@localhost:5432/db",
      ...HISTORY_POOL_LIMITS,
    });
    expect(
      runtimePoolConfig(POOLER, { limits: HISTORY_POOL_LIMITS }),
    ).toMatchObject({
      ...HISTORY_POOL_LIMITS,
      ssl: { rejectUnauthorized: true },
    });
  });

  test("a server that accepts and never answers: every raced read settles at the race, and the pool drains", async () => {
    const sockets = new Set<net.Socket>();
    const silent = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => undefined);
      // Read and discard, so the client's close reaches this side as EOF.
      socket.resume();
    });
    await new Promise<void>((resolve) =>
      silent.listen(0, "127.0.0.1", resolve),
    );
    const { port } = silent.address() as net.AddressInfo;
    const pool = new pg.Pool(
      runtimePoolConfig(`postgresql://u:p@127.0.0.1:${port}/x`, {
        limits: HISTORY_POOL_LIMITS,
      }) as pg.PoolConfig,
    );
    pool.on("error", () => undefined);
    const prisma = new PrismaClient({
      adapter: new PrismaPg(
        pool as unknown as ConstructorParameters<typeof PrismaPg>[0],
      ),
    });
    const reader = createPriceHistoryReader(async () => prisma);
    try {
      const inner: Promise<unknown>[] = [];
      const started = Date.now();
      const raced = Array.from({ length: 12 }, () =>
        withTimeout(() => {
          const read = reader.getPriceHistory(ID_A, "normal", "2026-10-10");
          inner.push(read.catch((e: unknown) => e));
          return read;
        }, HISTORY_TIMEOUT_MS).then(
          () => null,
          (e: unknown) => e,
        ),
      );
      const outcomes = await Promise.all(raced);
      expect(Date.now() - started).toBeLessThan(HISTORY_TIMEOUT_MS + 400);
      for (const outcome of outcomes) {
        expect(outcome).toBeInstanceOf(HistoryTimeoutError);
      }
      expect(pool.totalCount).toBeLessThanOrEqual(HISTORY_POOL_LIMITS.max);
      // Nothing waits forever: every abandoned read settles once the
      // connect or pool-wait bound passes.
      const settled = await Promise.all(inner);
      expect(Date.now() - started).toBeLessThan(
        HISTORY_POOL_LIMITS.connectionTimeoutMillis + 1_500,
      );
      expect(settled.every((e) => e instanceof Error)).toBe(true);
      expect(pool.waitingCount).toBe(0);
      // Connect attempts the pool started for already timed-out waiters end
      // within one more connect bound; then no socket is left open.
      const deadline =
        Date.now() + HISTORY_POOL_LIMITS.connectionTimeoutMillis + 1_500;
      while (
        (pool.totalCount > 0 || sockets.size > 0) &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(pool.totalCount).toBe(0);
      expect(sockets.size).toBe(0);
    } finally {
      await prisma.$disconnect().catch(() => undefined);
      await pool.end().catch(() => undefined);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  }, 20_000);
});

// A fake Postgres that answers SSLRequest with 'S', completes TLS with a
// leaf certificate from a throwaway root (generated here with openssl), then
// refuses the startup with SQLSTATE 28000. Reaching 28000 proves the TLS
// handshake, certificate check included, succeeded.
const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;
const IN_CI = process.env.CI === "true";

describe.skipIf(!hasOpenssl && !IN_CI)(
  "the TLS handshake through runtimePoolConfig (ADV.1)",
  () => {
    let dir: string;
    let rootPem: string;
    let server: net.Server;
    let port: number;
    let handshakes = 0;

    const openssl = (...args: string[]) => {
      const r = spawnSync("openssl", args, { cwd: dir, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`openssl ${args[0]}: ${r.stderr}`);
    };

    /** A Postgres ErrorResponse: FATAL 28000 "fake server". */
    function errorResponse(): Buffer {
      const fields = Buffer.from("SFATAL\0C28000\0Mfake server\0\0", "latin1");
      const head = Buffer.alloc(5);
      head.write("E", 0, "latin1");
      head.writeInt32BE(fields.length + 4, 1);
      return Buffer.concat([head, fields]);
    }

    beforeAll(async () => {
      dir = mkdtempSync(path.join(tmpdir(), "mox-tls-"));
      openssl(
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        "root.key",
        "-out",
        "root.pem",
        "-days",
        "2",
        "-subj",
        "/CN=Mox Test Root",
      );
      openssl(
        "req",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        "leaf.key",
        "-out",
        "leaf.csr",
        "-subj",
        "/CN=db.mox.test",
      );
      writeFileSync(
        path.join(dir, "ext.cnf"),
        "subjectAltName=DNS:db.mox.test,DNS:localhost,IP:127.0.0.1\n",
      );
      openssl(
        "x509",
        "-req",
        "-in",
        "leaf.csr",
        "-CA",
        "root.pem",
        "-CAkey",
        "root.key",
        "-CAcreateserial",
        "-out",
        "leaf.pem",
        "-days",
        "2",
        "-extfile",
        "ext.cnf",
      );
      rootPem = readFileSync(path.join(dir, "root.pem"), "utf8");
      const key = readFileSync(path.join(dir, "leaf.key"));
      const cert = readFileSync(path.join(dir, "leaf.pem"));
      server = net.createServer((socket) => {
        socket.on("error", () => undefined);
        socket.once("data", (request) => {
          if (request.length < 8 || request.readInt32BE(4) !== 80877103) {
            socket.destroy();
            return;
          }
          socket.write("S");
          const secure = new tls.TLSSocket(socket, {
            isServer: true,
            key,
            cert,
          });
          secure.on("error", () => undefined);
          secure.on("secure", () => {
            handshakes++;
          });
          secure.once("data", () => secure.end(errorResponse()));
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      port = (server.address() as net.AddressInfo).port;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    /** A remote-shaped URL whose ?host= sends pg to the fake server. */
    const url = () =>
      `postgresql://u:p@db.mox.test:${port}/x?sslmode=require&host=127.0.0.1`;

    async function connectWith(caCert: string | undefined) {
      const client = new pg.Client(
        runtimePoolConfig(url(), { caCert }) as pg.ClientConfig,
      );
      try {
        await client.connect();
        return null;
      } catch (error) {
        return error as { code?: string };
      } finally {
        await client.end().catch(() => undefined);
      }
    }

    test("with the pinned root, the handshake and certificate check pass (the server's 28000 arrives)", async () => {
      const before = handshakes;
      const error = await connectWith(rootPem);
      expect(error?.code).toBe("28000");
      expect(handshakes).toBe(before + 1);
    });

    test("without it, the same server fails Node's CA store check", async () => {
      const error = await connectWith(undefined);
      expect(error?.code).toMatch(
        /^(UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT_LOCALLY)$/,
      );
    });

    test("through Prisma and the reader, a certificate failure is logged as TlsConnectionError, not as a missing table (ADV.5)", async () => {
      const prisma = new PrismaClient({
        adapter: new PrismaPg(runtimePoolConfig(url(), {})),
      });
      try {
        const error = await createPriceHistoryReader(async () => prisma)
          .getHistoryFreshness()
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(errorCodes(error)).toContain("TlsConnectionError");
        expect(errorCodes(error)).not.toContain("42P01");
      } finally {
        await prisma.$disconnect().catch(() => undefined);
      }
    });
  },
);
