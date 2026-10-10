// T5 (AC-13; S2.1d2 pivot): the empty reader returns no rows and null
// freshness, and it is the default until S0.1 repoints it (S0.1 flips the
// last assertion to its reader in its PR).
import { describe, expect, test } from "vitest";
import { defaultHistoryReader, emptyHistoryReader } from "./history-reader";

describe("emptyHistoryReader (T5)", () => {
  test("getPriceHistory returns no rows and a null latestSnapshotAt", async () => {
    await expect(
      emptyHistoryReader.getPriceHistory(
        "f3537373-ef54-4578-9d05-6216420ee349",
        "foil",
        "2026-10-10",
      ),
    ).resolves.toEqual({ history: [], latestSnapshotAt: null });
  });

  test("getHistoryFreshness returns null lastSuccessAt and sourceDate", async () => {
    await expect(emptyHistoryReader.getHistoryFreshness()).resolves.toEqual({
      lastSuccessAt: null,
      sourceDate: null,
    });
  });

  test("each call returns a fresh array, so no caller can mutate a shared one", async () => {
    const a = await emptyHistoryReader.getPriceHistory(
      "x",
      "normal",
      "2026-10-10",
    );
    const b = await emptyHistoryReader.getPriceHistory(
      "x",
      "normal",
      "2026-10-10",
    );
    expect(a.history).not.toBe(b.history);
    a.history.push({ date: "2026-10-09", priceCents: 1 });
    const c = await emptyHistoryReader.getPriceHistory(
      "x",
      "normal",
      "2026-10-10",
    );
    expect(c.history).toEqual([]);
  });

  test("is frozen", () => {
    expect(Object.isFrozen(emptyHistoryReader)).toBe(true);
  });

  test("defaultHistoryReader is emptyHistoryReader until S0.1", () => {
    expect(defaultHistoryReader).toBe(emptyHistoryReader);
  });
});
