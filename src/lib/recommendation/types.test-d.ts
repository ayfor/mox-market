// T1 (AC-1): the contract matches F1's literal shapes exactly (S1.1d7).
import { describe, expectTypeOf, test } from "vitest";
import type {
  Confidence,
  Finish,
  MarketSnapshot,
  MarketSource,
  PriceRange,
  PriceSnapshot,
  Recommendation,
  RecommendationInput,
  RecommendationKind,
  RecommendationSignals,
  TrendDirection,
} from "./types";

describe("F1 contract types", () => {
  test("enum unions", () => {
    expectTypeOf<Finish>().toEqualTypeOf<"normal" | "foil" | "etched">();
    expectTypeOf<RecommendationKind>().toEqualTypeOf<
      "buy" | "fair" | "wait" | "insufficient_data"
    >();
    expectTypeOf<Confidence>().toEqualTypeOf<"high" | "medium" | "low">();
    expectTypeOf<TrendDirection>().toEqualTypeOf<
      "rising" | "falling" | "flat"
    >();
    expectTypeOf<MarketSource>().toEqualTypeOf<"scryfall">();
  });

  test("PriceSnapshot", () => {
    expectTypeOf<PriceSnapshot>().toEqualTypeOf<{
      date: string;
      priceCents: number;
    }>();
  });

  test("RecommendationInput", () => {
    expectTypeOf<RecommendationInput>().toEqualTypeOf<{
      askingPriceCents: number;
      cardId: string;
      finish: "normal" | "foil" | "etched";
    }>();
  });

  test("MarketSnapshot", () => {
    expectTypeOf<MarketSnapshot>().toEqualTypeOf<{
      appliedFinish: "normal" | "foil" | "etched";
      currentPriceCents: number | null;
      history: { date: string; priceCents: number }[];
      asOf: string;
      source: "scryfall";
      latestSnapshotAt: Date | null;
    }>();
    expectTypeOf<MarketSnapshot["appliedFinish"]>().toEqualTypeOf<
      "normal" | "foil" | "etched"
    >();
  });

  test("PriceRange", () => {
    expectTypeOf<PriceRange>().toEqualTypeOf<{
      low: number;
      high: number;
      avg: number;
    }>();
  });

  test("RecommendationSignals", () => {
    expectTypeOf<RecommendationSignals>().toEqualTypeOf<{
      deltaPct: number | null;
      deltaBp: number | null;
      marketPriceCents: number | null;
      median30dCents: number | null;
      range30dCents: { low: number; high: number; avg: number } | null;
      rangePosition: number | null;
      slope7dPct: number | null;
      slope30dPct: number | null;
      volatility30d: number | null;
      snapshotCount30d: number;
      trendDirection: "rising" | "falling" | "flat" | null;
      fallbackNotice: boolean;
      bandPct: number;
      wideningFactor: number;
      buyThresholdPct: number;
      waitThresholdPct: number;
    }>();
    expectTypeOf<
      RecommendationSignals["buyThresholdPct"]
    >().toEqualTypeOf<number>();
    expectTypeOf<
      RecommendationSignals["waitThresholdPct"]
    >().toEqualTypeOf<number>();
  });

  test("Recommendation", () => {
    expectTypeOf<Recommendation>().toEqualTypeOf<{
      kind: "buy" | "fair" | "wait" | "insufficient_data";
      confidence: "high" | "medium" | "low";
      reason: string;
      signals: RecommendationSignals;
    }>();
  });
});
