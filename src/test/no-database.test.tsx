// S0.1 ADV.10 (S0.1d23): the component project carries the same barrier, so
// a component left on its default reader never reaches Postgres.
import { describe, expect, test } from "vitest";
import { NO_DATABASE_MESSAGE } from "./no-database";

describe("the component project's database barrier", () => {
  test("every database URL is empty and the default reader cannot load a client", async () => {
    expect(process.env.POSTGRES_PRISMA_URL ?? "").toBe("");
    expect(process.env.POSTGRES_URL_NON_POOLING ?? "").toBe("");
    const { defaultHistoryReader } =
      await import("@/lib/evaluation/history-reader");
    await expect(defaultHistoryReader.getHistoryFreshness()).rejects.toThrow(
      NO_DATABASE_MESSAGE,
    );
  });
});
