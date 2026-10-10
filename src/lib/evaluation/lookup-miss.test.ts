// T9 (AC-6, AC-7, AC-8; story Verification): the miss mapping as a pure
// function. Only Scryfall's own 404 is a miss; every other failure is
// unavailable, so it is never reported as not found.
import { ScryfallApiError } from "@/lib/scryfall";
import { ThrottleBacklogError } from "@/lib/throttle";
import { describe, expect, test } from "vitest";
import { classifyLookupError } from "./lookup-miss";

const apiError = (status: number, type?: unknown) =>
  new ScryfallApiError(status, "not_found", "x", type as string | undefined);

describe("classifyLookupError (T9)", () => {
  test('404 with type "ambiguous" → ambiguous', () => {
    expect(classifyLookupError(apiError(404, "ambiguous"))).toBe("ambiguous");
  });

  test.each<[string, unknown]>([
    ["no type", undefined],
    ['type "other"', "other"],
    ['type "Ambiguous" (case differs)', "Ambiguous"],
    ["a non-string type (5)", 5],
    ["a null type", null],
  ])("404 with %s → not_found", (_name, type) => {
    expect(classifyLookupError(apiError(404, type))).toBe("not_found");
  });

  test.each([400, 403, 410, 429, 500, 502, 503])(
    "a %i ScryfallApiError → unavailable, even with type ambiguous",
    (status) => {
      expect(classifyLookupError(apiError(status))).toBe("unavailable");
      expect(classifyLookupError(apiError(status, "ambiguous"))).toBe(
        "unavailable",
      );
    },
  );

  test.each<[string, unknown]>([
    ["a TypeError (rejected fetch)", new TypeError("fetch failed")],
    ["an AbortError (timeout)", new DOMException("aborted", "AbortError")],
    ["a ThrottleBacklogError (full queue)", new ThrottleBacklogError(5000)],
    ["a SyntaxError", new SyntaxError("Unexpected token <")],
    [
      "a look-alike object with status 404",
      { name: "ScryfallApiError", status: 404, type: "ambiguous" },
    ],
    ["a string", "404"],
    ["null", null],
    ["undefined", undefined],
  ])("%s → unavailable", (_name, error) => {
    expect(classifyLookupError(error)).toBe("unavailable");
  });
});
