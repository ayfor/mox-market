// T1 (AC-1): the contract matches F1's literal shapes exactly (S1.1d7).
// S4.1 T11 (F4 Fields; S4.1d3): CardCategory, ClassifiableCard and
// signals.category.
import { describe, expectTypeOf, test } from "vitest";
import type {
  CardCategory,
  ClassifiableCard,
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
  ShockAnnotation,
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
      shockAnnotation: {
        readonly detected: true;
        readonly magnitude: number;
        readonly window: number;
      } | null;
      category: {
        readonly reservedList: boolean;
        readonly age: "recent" | "modern-era" | "vintage-era" | "unknown";
        readonly popularity: "top1000" | "top5000" | "longtail" | "unranked";
        readonly formatProfile: "competitive" | "edh" | "casual";
        readonly digital: boolean;
      } | null;
    }>();
    // S3.2 T15: F3's shock annotation, null meaning no annotation.
    expectTypeOf<
      RecommendationSignals["shockAnnotation"]
    >().toEqualTypeOf<ShockAnnotation | null>();
    expectTypeOf<ShockAnnotation>().toEqualTypeOf<{
      readonly detected: true;
      readonly magnitude: number;
      readonly window: number;
    }>();
    expectTypeOf<
      RecommendationSignals["buyThresholdPct"]
    >().toEqualTypeOf<number>();
    expectTypeOf<
      RecommendationSignals["waitThresholdPct"]
    >().toEqualTypeOf<number>();
  });

  test("CardCategory and signals.category (S4.1 T11)", () => {
    expectTypeOf<CardCategory>().toEqualTypeOf<{
      readonly reservedList: boolean;
      readonly age: "recent" | "modern-era" | "vintage-era" | "unknown";
      readonly popularity: "top1000" | "top5000" | "longtail" | "unranked";
      readonly formatProfile: "competitive" | "edh" | "casual";
      readonly digital: boolean;
    }>();
    expectTypeOf<
      RecommendationSignals["category"]
    >().toEqualTypeOf<CardCategory | null>();
    expectTypeOf<ClassifiableCard>().toEqualTypeOf<{
      readonly reserved?: unknown;
      readonly released_at?: unknown;
      readonly edhrec_rank?: unknown;
      readonly legalities?: unknown;
      readonly digital?: unknown;
    }>();
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
