// T6 (AC-3, market clause, structural): market data cannot reach the validator.
// Behaviour (insufficient_data for a missing or non-positive market price) is
// asserted in S1.2 AC-4.
import { describe, expectTypeOf, test } from "vitest";
import type { MarketSnapshot, RecommendationInput } from "./types";
import { validateRecommendationInput } from "./validate";

describe("validateRecommendationInput signature", () => {
  test("takes only the user input", () => {
    expectTypeOf<
      Parameters<typeof validateRecommendationInput>
    >().toEqualTypeOf<[RecommendationInput]>();
    expectTypeOf<
      ReturnType<typeof validateRecommendationInput>
    >().toEqualTypeOf<void>();
  });

  test("a MarketSnapshot second argument does not compile", () => {
    const input: RecommendationInput = {
      askingPriceCents: 7499,
      cardId: "2a3d3a51-24c4-4a3a-b4ea-d9b0d4e6a6f2",
      finish: "normal",
    };
    const market: MarketSnapshot = {
      appliedFinish: "normal",
      currentPriceCents: null,
      history: [],
      asOf: "2026-10-10",
      source: "scryfall",
      latestSnapshotAt: null,
    };
    // Type-level only: wrapped so the call never runs.
    expectTypeOf(() => {
      // @ts-expect-error market data never reaches the validator
      validateRecommendationInput(input, market);
    }).toBeFunction();
  });
});
