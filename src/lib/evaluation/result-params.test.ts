// T1, T2 (AC-9; C1.52; S2.1d5): one price parser for the form and the
// server, and the result route's param guard.
import {
  MAX_ASKING_PRICE_CENTS,
  MIN_ASKING_PRICE_CENTS,
} from "@/lib/recommendation/limits";
import { describe, expect, test } from "vitest";
import {
  decodeCardSegment,
  normalisePrice,
  parseCardParam,
  parsePriceCents,
  parseResultParams,
  type ResultParams,
} from "./result-params";

describe("normalisePrice and parsePriceCents (T1)", () => {
  test("normalisePrice strips $, whitespace and thousands commas", () => {
    expect(normalisePrice(" $1,234.50 ")).toBe("1234.50");
    expect(normalisePrice("$ 74.99")).toBe("74.99");
    expect(normalisePrice("7 4.99\t")).toBe("74.99");
  });

  test.each([
    ["$74.99", 7499],
    [" 1,234.50 ", 123450],
    ["0.01", 1],
    ["100000", 10_000_000],
    ["$ 74.99", 7499],
    ["74.9", 7490],
    ["1", 100],
  ])("%j → %i cents", (raw, cents) => {
    expect(parsePriceCents(raw)).toBe(cents);
  });

  test.each([
    "74.999",
    "1e3",
    "0",
    "0.00",
    "-1",
    "",
    "100000.01",
    ".99",
    "74.",
    "１２",
    "NaN",
    "Infinity",
    "0x10",
    "1".repeat(40),
    "$",
    "12.3.4",
    "1000000",
  ])("rejects %j", (raw) => {
    expect(parsePriceCents(raw)).toBeNull();
  });

  test("commas only as thousands separators (ADV-3, S2.1d24)", () => {
    expect(parsePriceCents("74,99")).toBeNull();
    expect(parsePriceCents("0,50")).toBeNull();
    expect(parsePriceCents("1,5")).toBeNull();
    expect(parsePriceCents("1,00,000")).toBeNull();
    expect(parsePriceCents(",500")).toBeNull();
    expect(parsePriceCents("1,234.50")).toBe(123450);
    expect(parsePriceCents("1,000")).toBe(100000);
    expect(parsePriceCents("$100,000.00")).toBe(MAX_ASKING_PRICE_CENTS);
    expect(normalisePrice("74,99")).toBe("74,99");
    expect(normalisePrice("$ 1,000")).toBe("1000");
  });

  test("the accepted range is MIN_ASKING_PRICE_CENTS..MAX_ASKING_PRICE_CENTS", () => {
    expect(MIN_ASKING_PRICE_CENTS).toBe(1);
    expect(MAX_ASKING_PRICE_CENTS).toBe(10_000_000);
    expect(parsePriceCents("0.01")).toBe(MIN_ASKING_PRICE_CENTS);
    expect(parsePriceCents("100000.00")).toBe(MAX_ASKING_PRICE_CENTS);
    expect(parsePriceCents("0.00")).toBeNull();
    expect(parsePriceCents("100000.01")).toBeNull();
  });
});

const enc = encodeURIComponent;
const ok = (r: ResultParams) => {
  if (r.kind !== "ok") throw new Error(`expected ok, got ${r.kind}`);
  return r;
};

describe("parseResultParams (T2)", () => {
  test.each([
    ["a 200-char card", "x".repeat(200)],
    ["142 code points", "x".repeat(142)],
    ["a whitespace-only card", "   "],
    ["an empty card", ""],
    ["U+0000", "Esper\u0000Sentinel"],
    ["U+0007", "Esper\u0007Sentinel"],
    ["U+007F", "Esper\u007fSentinel"],
    ["U+0085", "Esper\u0085Sentinel"],
    ["a tab", "Esper\tSentinel"],
    ['the dot segment "."', "."],
    ['the dot segment ".."', ".."],
    ['" .. " (trimmed to a dot segment)', " .. "],
  ])("%s is not_found", (_name, card) => {
    expect(parseResultParams(enc(card), { price: "1" })).toEqual({
      kind: "not_found",
    });
  });

  test("a malformed percent encoding is not_found", () => {
    expect(parseResultParams("Esper%E0%A4%A", { price: "1" })).toEqual({
      kind: "not_found",
    });
    expect(decodeCardSegment("100%")).toBeNull();
  });

  test.each([
    ["141 code points", "x".repeat(141)],
    ["Lim-Dûl's Vault", "Lim-Dûl's Vault"],
    ["Fire // Ice", "Fire // Ice"],
    ["+2 Mace", "+2 Mace"],
    ["Question Elemental?", "Question Elemental?"],
    ["a 141-emoji card", "\u{1F0CF}".repeat(141)],
  ])("%s passes, decoded exactly once", (_name, card) => {
    expect(ok(parseResultParams(enc(card), { price: "1" })).card).toBe(card);
  });

  test("the segment is decoded once: %2541 stays %41", () => {
    expect(ok(parseResultParams("a%2541b", { price: "1" })).card).toBe("a%41b");
    expect(
      ok(parseResultParams("Esper%20Sentinel", { price: "74.99" })).card,
    ).toBe("Esper Sentinel");
  });

  test('dot segments only: "..." and ".Esper" are names (ADV-6)', () => {
    expect(parseCardParam("...")).toBe("...");
    expect(parseCardParam(".Esper")).toBe(".Esper");
    expect(parseCardParam("..")).toBeNull();
    expect(parseCardParam(".")).toBeNull();
  });

  test("the card is trimmed", () => {
    expect(
      ok(parseResultParams(enc("  Esper Sentinel "), { price: "1" })).card,
    ).toBe("Esper Sentinel");
    expect(parseCardParam("\u{1F0CF}".repeat(142))).toBeNull();
  });

  test("finish: absent → normal, foil → foil", () => {
    expect(ok(parseResultParams("Esper", { price: "1" })).finish).toBe(
      "normal",
    );
    expect(
      ok(parseResultParams("Esper", { price: "1", finish: "normal" })).finish,
    ).toBe("normal");
    expect(
      ok(parseResultParams("Esper", { price: "1", finish: "foil" })).finish,
    ).toBe("foil");
  });

  test.each([
    ["etched", "etched"],
    ["Foil", "Foil"],
    ["empty", ""],
    ["an array", ["foil", "foil"]],
  ])("finish %s → the form with the error", (_name, finish) => {
    expect(parseResultParams("Esper", { price: "74.99", finish })).toEqual({
      kind: "form",
      card: "Esper",
      price: "74.99",
      error: true,
    });
  });

  test("price absent or blank → the form without the error", () => {
    expect(parseResultParams("Esper", {})).toEqual({
      kind: "form",
      card: "Esper",
      price: "",
      error: false,
    });
    expect(parseResultParams("Esper", { price: "  " })).toEqual({
      kind: "form",
      card: "Esper",
      price: "  ",
      error: false,
    });
  });

  test.each([["74.999"], ["1e3"], ["0"], ["100000.01"], ["abc"]])(
    "price %j → the form with the error, the typed price kept",
    (price) => {
      expect(parseResultParams("Esper", { price })).toEqual({
        kind: "form",
        card: "Esper",
        price,
        error: true,
      });
    },
  );

  test("a repeated price (?price=1&price=2) → the form with the error", () => {
    expect(parseResultParams("Esper", { price: ["1", "2"] })).toEqual({
      kind: "form",
      card: "Esper",
      price: "1",
      error: true,
    });
  });

  test("a valid query carries cents, finish and the Suspense key", () => {
    expect(parseResultParams("Esper%20Sentinel", { price: "$74.99" })).toEqual({
      kind: "ok",
      card: "Esper Sentinel",
      price: "$74.99",
      askingPriceCents: 7499,
      finish: "normal",
      paramsKey: "Esper Sentinel|7499|normal",
    });
  });

  test("paramsKey differs when card, cents or finish differ, and is equal for 74.99 and $74.99", () => {
    const key = (card: string, search: Record<string, string>) =>
      ok(parseResultParams(card, search)).paramsKey;
    const base = key("Esper", { price: "74.99" });
    expect(key("Esper", { price: "$74.99" })).toBe(base);
    expect(key("Esper", { price: "74.99", finish: "normal" })).toBe(base);
    expect(key("Esper2", { price: "74.99" })).not.toBe(base);
    expect(key("Esper", { price: "74.98" })).not.toBe(base);
    expect(key("Esper", { price: "74.99", finish: "foil" })).not.toBe(base);
  });

  test("printing is ignored until S2.3", () => {
    expect(
      ok(parseResultParams("Esper", { price: "1", printing: "not-a-uuid" }))
        .paramsKey,
    ).toBe("Esper|100|normal");
  });
});
