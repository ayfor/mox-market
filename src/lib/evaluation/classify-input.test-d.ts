// S4.1 T11 (S4.1d3): the engine may not import @/types/scryfall, so classify
// takes a structural ClassifiableCard. Outside the engine, this pins that
// every Scryfall card object (and so the evaluated printing) is one, and that
// each field classify reads is the type F4 names.
import type { classify } from "@/lib/recommendation/classify";
import type { ClassifiableCard } from "@/lib/recommendation/types";
import type { ScryfallCard } from "@/types/scryfall";
import { describe, expectTypeOf, test } from "vitest";

describe("ScryfallCard is a ClassifiableCard (T11)", () => {
  test("a ScryfallCard is assignable to classify's card parameter", () => {
    expectTypeOf<ScryfallCard>().toExtend<ClassifiableCard>();
    expectTypeOf<ScryfallCard>().toExtend<Parameters<typeof classify>[0]>();
  });

  test("Scryfall's types for the five fields are the ones F4 reads", () => {
    expectTypeOf<ScryfallCard["reserved"]>().toEqualTypeOf<boolean>();
    expectTypeOf<ScryfallCard["digital"]>().toEqualTypeOf<boolean>();
    expectTypeOf<ScryfallCard["released_at"]>().toEqualTypeOf<string>();
    expectTypeOf<ScryfallCard["edhrec_rank"]>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf<ScryfallCard["legalities"]["commander"]>().toEqualTypeOf<
      "legal" | "not_legal" | "restricted" | "banned"
    >();
  });
});
