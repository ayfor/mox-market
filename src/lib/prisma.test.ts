// T25 (AC-14, env contract): one variable, and a missing one fails loudly.
// S0.1 ADV.1 and ADV.4: both runtime clients get the explicit TLS posture,
// and the history client the bounded pool (S0.1d20, S0.1d21).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HISTORY_POOL_LIMITS } from "./prisma-pool";

// This file tests the real module, so it opts out of the unit project's
// no-database mock (src/test/no-database.ts). It never connects.
vi.unmock("@/lib/prisma");

const LOCAL = "postgresql://postgres:postgres@localhost:5432/mox_market";

function clearCachedClient() {
  delete (globalThis as { prisma?: unknown }).prisma;
  delete (globalThis as { historyPrisma?: unknown }).historyPrisma;
}

beforeEach(() => {
  vi.resetModules();
  clearCachedClient();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@prisma/adapter-pg");
  clearCachedClient();
});

/** PrismaPg constructions recorded with their pool config. */
function recordAdapters() {
  const configs: unknown[] = [];
  vi.doMock("@prisma/adapter-pg", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@prisma/adapter-pg")>();
    class RecordingPrismaPg extends actual.PrismaPg {
      constructor(...args: ConstructorParameters<typeof actual.PrismaPg>) {
        configs.push(args[0]);
        super(...args);
      }
    }
    return { ...actual, PrismaPg: RecordingPrismaPg };
  });
  return configs;
}

const PEM =
  "-----BEGIN CERTIFICATE-----\nTUlJQnRlc3Q=\n-----END CERTIFICATE-----\n";
const POOLER =
  "postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true";

describe("@/lib/prisma", () => {
  test("throws 'POSTGRES_PRISMA_URL unset' when the variable is missing", async () => {
    vi.stubEnv("POSTGRES_PRISMA_URL", undefined);
    await expect(import("@/lib/prisma")).rejects.toThrow(
      "POSTGRES_PRISMA_URL unset",
    );
  });

  test("throws when the variable is empty", async () => {
    vi.stubEnv("POSTGRES_PRISMA_URL", "");
    await expect(import("@/lib/prisma")).rejects.toThrow(
      "POSTGRES_PRISMA_URL unset",
    );
  });

  test("does not fall back to DATABASE_URL", async () => {
    vi.stubEnv("POSTGRES_PRISMA_URL", undefined);
    vi.stubEnv("DATABASE_URL", LOCAL);
    await expect(import("@/lib/prisma")).rejects.toThrow(
      "POSTGRES_PRISMA_URL unset",
    );
  });

  test("a cached client from an earlier load does not mask a missing variable", async () => {
    (globalThis as { prisma?: unknown }).prisma = { cached: true };
    vi.stubEnv("POSTGRES_PRISMA_URL", undefined);
    await expect(import("@/lib/prisma")).rejects.toThrow(
      "POSTGRES_PRISMA_URL unset",
    );
  });

  test("builds a client from a localhost URL without connecting", async () => {
    // Port 1: any connection attempt would fail, so success proves none was made.
    vi.stubEnv(
      "POSTGRES_PRISMA_URL",
      "postgresql://postgres:postgres@localhost:1/mox_market",
    );
    const { prisma } = await import("@/lib/prisma");
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe("function");
    expect(typeof prisma.trackedCard.findMany).toBe("function");
  });

  test("a remote URL: both clients verify TLS against POSTGRES_SSL_ROOT_CERT, sslmode stripped (S0.1d20)", async () => {
    vi.stubEnv("POSTGRES_PRISMA_URL", POOLER);
    vi.stubEnv("POSTGRES_SSL_ROOT_CERT", PEM);
    const configs = recordAdapters();
    const { prisma, historyPrisma } = await import("@/lib/prisma");
    expect(prisma).not.toBe(historyPrisma);
    expect(configs).toHaveLength(2);
    for (const config of configs as {
      connectionString: string;
      ssl: unknown;
    }[]) {
      expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: PEM });
      expect(new URL(config.connectionString).searchParams.has("sslmode")).toBe(
        false,
      );
    }
  });

  test("the history client alone carries HISTORY_POOL_LIMITS (S0.1d21)", async () => {
    vi.stubEnv(
      "POSTGRES_PRISMA_URL",
      "postgresql://postgres:postgres@localhost:1/mox_market",
    );
    vi.stubEnv("POSTGRES_SSL_ROOT_CERT", undefined);
    const configs = recordAdapters();
    await import("@/lib/prisma");
    expect(configs).toEqual([
      {
        connectionString:
          "postgresql://postgres:postgres@localhost:1/mox_market",
      },
      {
        connectionString:
          "postgresql://postgres:postgres@localhost:1/mox_market",
        ...HISTORY_POOL_LIMITS,
      },
    ]);
  });

  test("a malformed POSTGRES_SSL_ROOT_CERT fails the load without echoing it", async () => {
    vi.stubEnv("POSTGRES_PRISMA_URL", POOLER);
    vi.stubEnv("POSTGRES_SSL_ROOT_CERT", "secret-looking-garbage");
    const error = await import("@/lib/prisma").then(
      () => null,
      (e: unknown) => e,
    );
    expect(String(error)).toContain(
      "POSTGRES_SSL_ROOT_CERT is not a PEM certificate",
    );
    expect(String(error)).not.toContain("secret-looking-garbage");
  });
});
