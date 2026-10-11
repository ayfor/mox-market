// S0.1 ADV.10 (S0.1d23): a unit test never reaches Postgres, even with a
// database URL stubbed in and the default history reader left in place.
import { afterEach, describe, expect, test, vi } from "vitest";
import { NO_DATABASE_MESSAGE } from "./no-database";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@prisma/adapter-pg");
  vi.resetModules();
});

describe("the unit project's database barrier", () => {
  test("the project starts with every database URL empty", () => {
    for (const name of [
      "POSTGRES_PRISMA_URL",
      "POSTGRES_URL_NON_POOLING",
      "DATABASE_URL",
    ]) {
      expect(process.env[name] ?? "").toBe("");
    }
  });

  test("defaultHistoryReader rejects with the barrier message and builds no adapter, even with a URL set", async () => {
    vi.stubEnv(
      "POSTGRES_PRISMA_URL",
      "postgresql://u:p@db.example.invalid:5432/postgres",
    );
    const adapterBuilt = vi.fn();
    vi.doMock("@prisma/adapter-pg", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@prisma/adapter-pg")>();
      class CountingPrismaPg extends actual.PrismaPg {
        constructor(...args: ConstructorParameters<typeof actual.PrismaPg>) {
          adapterBuilt();
          super(...args);
        }
      }
      return { ...actual, PrismaPg: CountingPrismaPg };
    });
    vi.resetModules();
    const { defaultHistoryReader } =
      await import("@/lib/evaluation/history-reader");
    await expect(
      defaultHistoryReader.getPriceHistory(
        "f3537373-ef54-4578-9d05-6216420ee349",
        "normal",
        "2026-10-10",
      ),
    ).rejects.toThrow(NO_DATABASE_MESSAGE);
    await expect(defaultHistoryReader.getHistoryFreshness()).rejects.toThrow(
      NO_DATABASE_MESSAGE,
    );
    expect(adapterBuilt).not.toHaveBeenCalled();
  });
});
