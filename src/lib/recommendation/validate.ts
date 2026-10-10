import { InvalidRecommendationInputError } from "./errors";
import { MAX_ASKING_PRICE_CENTS, MIN_ASKING_PRICE_CENTS } from "./limits";
import type { RecommendationInput } from "./types";

/**
 * Validates user input (AC-3). Only the asking price is user-typed; cardId and
 * finish are resolved upstream (F1 Fields). Market data never reaches here:
 * a missing or non-positive market price is insufficient_data (S1.2 AC-4).
 */
export function validateRecommendationInput(input: RecommendationInput): void {
  const cents: unknown = input.askingPriceCents;
  if (
    typeof cents !== "number" ||
    !Number.isInteger(cents) ||
    cents < MIN_ASKING_PRICE_CENTS ||
    cents > MAX_ASKING_PRICE_CENTS
  ) {
    throw new InvalidRecommendationInputError(
      "askingPriceCents",
      `askingPriceCents must be an integer from ${MIN_ASKING_PRICE_CENTS} to ${MAX_ASKING_PRICE_CENTS}`,
    );
  }
}
