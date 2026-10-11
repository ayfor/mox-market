// T15 (AC-3, AC-6; S0.1d2): the F0 reader is S2.1's PriceHistoryReader, and
// the generated CardFinish is F1's Finish.
import type { CardFinish } from "@/generated/prisma/enums";
import type { PriceHistoryReader } from "@/lib/evaluation/history-reader";
import type { Finish } from "@/lib/recommendation/types";
import { describe, expectTypeOf, test } from "vitest";
import {
  createPriceHistoryReader,
  prismaHistoryReader,
  type RawQueryClient,
  type RawQueryClientGetter,
} from "./price-history";

describe("price-history types (T15)", () => {
  test("prismaHistoryReader is a PriceHistoryReader", () => {
    expectTypeOf(prismaHistoryReader).toEqualTypeOf<PriceHistoryReader>();
  });

  test("createPriceHistoryReader takes a client getter and returns a PriceHistoryReader", () => {
    expectTypeOf(createPriceHistoryReader).parameters.toEqualTypeOf<
      [RawQueryClientGetter]
    >();
    expectTypeOf(
      createPriceHistoryReader,
    ).returns.toEqualTypeOf<PriceHistoryReader>();
    expectTypeOf<RawQueryClientGetter>().toEqualTypeOf<
      () => Promise<RawQueryClient>
    >();
  });

  test("the app's PrismaClient satisfies RawQueryClient", () => {
    type AppClient = typeof import("@/lib/prisma").prisma;
    expectTypeOf<AppClient>().toExtend<RawQueryClient>();
  });

  test("the generated CardFinish equals F1's Finish", () => {
    expectTypeOf<CardFinish>().toEqualTypeOf<Finish>();
  });
});
