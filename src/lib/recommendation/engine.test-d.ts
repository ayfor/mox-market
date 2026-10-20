// T19 (AC-1, AC-6; S1.2d2): computeRecommendation's signature. S3.1 T15
// (F3 Engine API): computeTieredRecommendation, servedRecommendation and the
// flag's type. S3.2 T15: the shock annotation and the five F3 params.
import { describe, expectTypeOf, test } from "vitest";
import {
  computeRecommendation,
  computeTieredRecommendation,
  servedRecommendation,
} from "./engine";
import type { RecommendationParams } from "./params";
import type {
  MarketSnapshot,
  Recommendation,
  RecommendationInput,
  ShockAnnotation,
  TieredRecommendation,
} from "./types";

describe("computeRecommendation signature", () => {
  test("takes input, market and optional params; returns a Recommendation", () => {
    expectTypeOf<Parameters<typeof computeRecommendation>>().toEqualTypeOf<
      [RecommendationInput, MarketSnapshot, RecommendationParams?]
    >();
    expectTypeOf<
      ReturnType<typeof computeRecommendation>
    >().toEqualTypeOf<Recommendation>();
  });

  test("a market without asOf does not compile (the engine never reads the clock)", () => {
    const input: RecommendationInput = {
      askingPriceCents: 7400,
      cardId: "2a3d3a51-24c4-4a3a-b4ea-d9b0d4e6a6f2",
      finish: "normal",
    };
    // Type-level only: wrapped so the call never runs.
    expectTypeOf(() => {
      // @ts-expect-error asOf is required: the caller passes the request date
      computeRecommendation(input, {
        appliedFinish: "normal",
        currentPriceCents: 8150,
        history: [],
        source: "scryfall",
        latestSnapshotAt: null,
      });
    }).toBeFunction();
    // The same literal with asOf compiles.
    expectTypeOf(() => {
      computeRecommendation(input, {
        appliedFinish: "normal",
        currentPriceCents: 8150,
        history: [],
        asOf: "2026-10-10",
        source: "scryfall",
        latestSnapshotAt: null,
      });
    }).toBeFunction();
  });
});

describe("the tiered API (S3.1 T15)", () => {
  test("computeTieredRecommendation takes input, market and optional params; returns both tiers", () => {
    expectTypeOf<
      Parameters<typeof computeTieredRecommendation>
    >().toEqualTypeOf<
      [RecommendationInput, MarketSnapshot, RecommendationParams?]
    >();
    expectTypeOf<
      ReturnType<typeof computeTieredRecommendation>
    >().toEqualTypeOf<TieredRecommendation>();
  });

  test("TieredRecommendation is { tier1: Recommendation; tier2: Recommendation | null }", () => {
    expectTypeOf<TieredRecommendation>().toEqualTypeOf<{
      tier1: Recommendation;
      tier2: Recommendation | null;
    }>();
  });

  test("servedRecommendation takes exactly one TieredRecommendation (no params)", () => {
    expectTypeOf<Parameters<typeof servedRecommendation>>().toEqualTypeOf<
      [TieredRecommendation]
    >();
    expectTypeOf<
      ReturnType<typeof servedRecommendation>
    >().toEqualTypeOf<Recommendation>();
  });

  test("TIER2_ENABLED is a boolean", () => {
    expectTypeOf<
      RecommendationParams["TIER2_ENABLED"]
    >().toEqualTypeOf<boolean>();
  });
});

describe("S3.2's types (T15)", () => {
  test("signals.shockAnnotation is ShockAnnotation | null on every tier", () => {
    expectTypeOf<
      Recommendation["signals"]["shockAnnotation"]
    >().toEqualTypeOf<ShockAnnotation | null>();
    expectTypeOf<ShockAnnotation>().toEqualTypeOf<{
      readonly detected: true;
      readonly magnitude: number;
      readonly window: number;
    }>();
  });

  test("the five F3 params S3.2 reads are numbers", () => {
    expectTypeOf<RecommendationParams["staleDays"]>().toEqualTypeOf<number>();
    expectTypeOf<RecommendationParams["volatileCV"]>().toEqualTypeOf<number>();
    expectTypeOf<
      RecommendationParams["volatilityWideningCap"]
    >().toEqualTypeOf<number>();
    expectTypeOf<
      RecommendationParams["shockWindowDays"]
    >().toEqualTypeOf<number>();
    expectTypeOf<
      RecommendationParams["shockMagnitudePct"]
    >().toEqualTypeOf<number>();
  });
});
