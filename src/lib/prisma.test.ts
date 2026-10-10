// T25 (AC-14, env contract): one variable, and a missing one fails loudly.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const LOCAL = "postgresql://postgres:postgres@localhost:5432/mox_market";

function clearCachedClient() {
  delete (globalThis as { prisma?: unknown }).prisma;
}

beforeEach(() => {
  vi.resetModules();
  clearCachedClient();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearCachedClient();
});

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
});
