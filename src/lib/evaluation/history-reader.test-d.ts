// T5 (AC-13; S2.1d2): the reader contract carries F0 W3's signatures and
// F1's PriceSnapshot, so S0.1's reader drops in without a change here.
import type { Finish, PriceSnapshot } from "@/lib/recommendation/types";
import { describe, expectTypeOf, test } from "vitest";
import {
  defaultHistoryReader,
  emptyHistoryReader,
  type HistoryFreshness,
  type PriceHistoryReader,
  type PriceHistoryResult,
} from "./history-reader";

describe("PriceHistoryReader (T5)", () => {
  test("getPriceHistory(scryfallId, finish, asOf) → { history, latestSnapshotAt }", () => {
    expectTypeOf<PriceHistoryReader["getPriceHistory"]>().toEqualTypeOf<
      (
        scryfallId: string,
        finish: Finish,
        asOf: string,
      ) => Promise<{ history: PriceSnapshot[]; latestSnapshotAt: Date | null }>
    >();
    expectTypeOf<PriceHistoryResult>().toEqualTypeOf<{
      history: PriceSnapshot[];
      latestSnapshotAt: Date | null;
    }>();
  });

  test("getHistoryFreshness() → { lastSuccessAt, sourceDate }", () => {
    expectTypeOf<PriceHistoryReader["getHistoryFreshness"]>().toEqualTypeOf<
      () => Promise<{ lastSuccessAt: Date | null; sourceDate: string | null }>
    >();
    expectTypeOf<HistoryFreshness>().toEqualTypeOf<{
      lastSuccessAt: Date | null;
      sourceDate: string | null;
    }>();
  });

  test("the empty and default readers are PriceHistoryReaders", () => {
    expectTypeOf(emptyHistoryReader).toEqualTypeOf<PriceHistoryReader>();
    expectTypeOf(defaultHistoryReader).toEqualTypeOf<PriceHistoryReader>();
  });
});
