import { InvalidRecommendationInputError } from "./errors";
import { MAX_ASKING_PRICE_CENTS, MIN_ASKING_PRICE_CENTS } from "./limits";
import { FINISHES, type RecommendationInput } from "./types";

/**
 * Validates user input (AC-3). The asking price is user-typed and the finish
 * comes from the URL (F2 rejects a bad one before any Scryfall call; this is
 * the engine's own check, D6); cardId is resolved upstream (F1 Fields).
 * Market data never reaches here: a missing or non-positive market price is
 * insufficient_data (S1.2 AC-4). An input that is not an object fails on the
 * asking price, so a caller never sees a TypeError (D7).
 */
export function validateRecommendationInput(input: RecommendationInput): void {
  const fields: Partial<Record<keyof RecommendationInput, unknown>> =
    input !== null && typeof input === "object" ? input : {};
  const cents = fields.askingPriceCents;
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
  if (!(FINISHES as readonly unknown[]).includes(fields.finish)) {
    throw new InvalidRecommendationInputError(
      "finish",
      `finish must be one of ${FINISHES.join(", ")}`,
    );
  }
}
