import type { RecommendationInput } from "./types";

/** Thrown for invalid user input only; bad market data is insufficient_data. */
export class InvalidRecommendationInputError extends Error {
  readonly field: keyof RecommendationInput;

  constructor(field: keyof RecommendationInput, message: string) {
    super(message);
    this.name = "InvalidRecommendationInputError";
    this.field = field;
  }
}
