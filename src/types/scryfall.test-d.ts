// T8's type half (S2.4 AC-5): ScryfallError carries Scryfall's optional
// `type`, and ScryfallApiError exposes it as string | undefined.
import type { ScryfallApiError } from "@/lib/scryfall";
import { expectTypeOf, test } from "vitest";
import type { ScryfallError } from "./scryfall";

test("ScryfallError.type is optional string", () => {
  expectTypeOf<ScryfallError["type"]>().toEqualTypeOf<string | undefined>();
  expectTypeOf<{
    object: "error";
    code: string;
    status: number;
    details: string;
  }>().toExtend<ScryfallError>();
});

test("ScryfallApiError carries status, code and type", () => {
  expectTypeOf<ScryfallApiError["status"]>().toEqualTypeOf<number>();
  expectTypeOf<ScryfallApiError["code"]>().toEqualTypeOf<string>();
  expectTypeOf<ScryfallApiError["type"]>().toEqualTypeOf<string | undefined>();
});
