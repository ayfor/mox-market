// T19 (AC-1, AC-6; S1.2d2): computeRecommendation's signature.
import { describe, expectTypeOf, test } from "vitest";
import { computeRecommendation } from "./engine";
import type { RecommendationParams } from "./params";
import type {
  MarketSnapshot,
  Recommendation,
  RecommendationInput,
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
