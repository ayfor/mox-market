// T5 (AC-3): user-input validation throws InvalidRecommendationInputError.
import { describe, expect, test } from "vitest";
import { InvalidRecommendationInputError } from "./errors";
import { MAX_ASKING_PRICE_CENTS } from "./limits";
import type { RecommendationInput } from "./types";
import { validateRecommendationInput } from "./validate";

const input = (askingPriceCents: unknown): RecommendationInput => ({
  askingPriceCents: askingPriceCents as number,
  cardId: "2a3d3a51-24c4-4a3a-b4ea-d9b0d4e6a6f2",
  finish: "normal",
});

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("validateRecommendationInput", () => {
  test.each([
    ["0", 0],
    ["-1", -1],
    ["-7499", -7499],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["74.99 (dollars, not cents)", 74.99],
    ["0.5", 0.5],
    ["10,000,001 (over the cap)", 10_000_001],
    ["the string '7499'", "7499"],
    ["null", null],
    ["undefined", undefined],
  ])("throws for askingPriceCents %s", (_label, value) => {
    const error = thrownBy(() => validateRecommendationInput(input(value)));
    expect(error).toBeInstanceOf(InvalidRecommendationInputError);
    expect(error).toBeInstanceOf(Error);
    const e = error as InvalidRecommendationInputError;
    expect(e.name).toBe("InvalidRecommendationInputError");
    expect(e.field).toBe("askingPriceCents");
    expect(e.message).toBe(
      "askingPriceCents must be an integer from 1 to 10000000",
    );
  });

  test.each([
    ["1 (the inclusive floor)", 1],
    ["7499", 7499],
    ["10,000,000 (the inclusive cap)", 10_000_000],
  ])("returns for askingPriceCents %s", (_label, value) => {
    expect(validateRecommendationInput(input(value))).toBeUndefined();
  });

  test("the cap is $100,000 in cents", () => {
    expect(MAX_ASKING_PRICE_CENTS).toBe(10_000_000);
  });

  test("cardId is not validated (it resolves upstream)", () => {
    expect(() =>
      validateRecommendationInput({
        askingPriceCents: 7499,
        cardId: "",
        finish: "etched",
      }),
    ).not.toThrow();
  });

  // S1.2 D6 (ADV-3): the finish comes from the URL, so it is user input.
  test.each(["normal", "foil", "etched"] as const)(
    "returns for finish %s",
    (finish) => {
      expect(
        validateRecommendationInput({ ...input(7499), finish }),
      ).toBeUndefined();
    },
  );

  test.each([
    ["undefined", undefined],
    ["null", null],
    ['"Foil"', "Foil"],
    ['"nonfoil"', "nonfoil"],
    ['""', ""],
    ["1", 1],
  ])("throws for finish %s with field finish", (_label, finish) => {
    const error = thrownBy(() =>
      validateRecommendationInput({
        ...input(7499),
        finish: finish as RecommendationInput["finish"],
      }),
    );
    expect(error).toBeInstanceOf(InvalidRecommendationInputError);
    const e = error as InvalidRecommendationInputError;
    expect(e.field).toBe("finish");
    expect(e.message).toBe("finish must be one of normal, foil, etched");
  });

  // S1.2 D7 (ADV-6): never a TypeError for a non-object input.
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["42", 42],
    ['"x"', "x"],
  ])("throws the typed error for input %s", (_label, value) => {
    const error = thrownBy(() =>
      validateRecommendationInput(value as unknown as RecommendationInput),
    );
    expect(error).toBeInstanceOf(InvalidRecommendationInputError);
    expect((error as InvalidRecommendationInputError).field).toBe(
      "askingPriceCents",
    );
  });
});
