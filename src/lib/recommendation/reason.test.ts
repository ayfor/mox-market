// T18 (AC-10, AC-1; C1.24, C1.41 = A; S1.2d9): the Tier-1 reason sentence.
// Reasons are asserted as F1 design copy; S1.3 AC-3 locks them.
import { describe, expect, test } from "vitest";
import { fillTemplate, REASON_COPY } from "./copy";
import { computeRecommendation } from "./engine";
import {
  CANONICAL_FIXTURES,
  fixtureInput,
  fixtureMarket,
  flat,
  INSUFFICIENT_DATA_SENTENCE,
} from "./fixtures";
import { buildReason } from "./reason";
import type { Confidence, RecommendationKind } from "./types";

const reasonFor = (
  kind: RecommendationKind,
  deltaBp: number | null,
  confidence: Confidence = "high",
  snapshotCount30d = 30,
) => buildReason({ kind, deltaBp, bandPct: 5, confidence, snapshotCount30d });

const collected: string[] = [];
const keep = (reason: string) => {
  collected.push(reason);
  return reason;
};

describe("X rounding (T18, AC-10)", () => {
  test("8130 against 8150 with 30 flat snapshots: deltaBp −25, fair, At market price", () => {
    const r = computeRecommendation(
      fixtureInput(8130),
      fixtureMarket(8150, flat(30, 8150)),
    );
    expect(r.signals.deltaBp).toBe(-25);
    expect(r.kind).toBe("fair");
    expect(keep(r.reason)).toBe("At market price.");
  });

  test.each([
    ["fair", -49, "At market price."],
    ["fair", 49, "At market price."],
    ["fair", 0, "At market price."],
    ["fair", -50, "Within 1% of market."],
    ["fair", -149, "Within 1% of market."],
    ["fair", -150, "Within 2% of market."],
    ["fair", -500, "Within 5% of market."],
    ["fair", 500, "Within 5% of market."],
    ["fair", -501, "5% below market."],
    ["fair", -833, "8% below market."],
    ["fair", 700, "7% above market."],
    ["buy", -840, "8% below market."],
    ["buy", -920, "9% below market."],
    ["wait", 510, "5% above market."],
    ["wait", 1043, "10% above market."],
  ] as const)("%s at deltaBp %i → %j", (kind, bp, expected) => {
    expect(keep(reasonFor(kind, bp))).toBe(expected);
  });
});

describe("thin-data caveat (T18; Josh's ruling 2026-10-08)", () => {
  test("low confidence adds the caveat on buy, fair and wait", () => {
    expect(keep(reasonFor("buy", -840, "low", 7))).toBe(
      "8% below market; only 7 price snapshots.",
    );
    expect(keep(reasonFor("fair", -25, "low", 10))).toBe(
      "At market price; only 10 price snapshots.",
    );
    expect(keep(reasonFor("fair", -184, "low", 13))).toBe(
      "Within 2% of market; only 13 price snapshots.",
    );
    expect(keep(reasonFor("wait", 1905, "low", 10))).toBe(
      "19% above market; only 10 price snapshots.",
    );
  });

  test.each(["medium", "high"] as const)("%s confidence never adds it", (c) => {
    for (const [kind, bp] of [
      ["buy", -920],
      ["fair", -184],
      ["fair", 0],
      ["wait", 1043],
    ] as const) {
      expect(keep(reasonFor(kind, bp, c, 20))).not.toContain("only");
    }
  });

  test("insufficient_data ignores the caveat and every other field", () => {
    expect(reasonFor("insufficient_data", null, "low", 6)).toBe(
      INSUFFICIENT_DATA_SENTENCE,
    );
    expect(reasonFor("insufficient_data", 1905, "low", 6)).toBe(
      INSUFFICIENT_DATA_SENTENCE,
    );
    expect(reasonFor("insufficient_data", -920, "high", 30)).toBe(
      INSUFFICIENT_DATA_SENTENCE,
    );
  });

  test("the copy module holds the insufficient_data sentence verbatim", () => {
    expect(REASON_COPY.insufficientData).toBe(INSUFFICIENT_DATA_SENTENCE);
    expect(Object.isFrozen(REASON_COPY)).toBe(true);
  });
});

describe("fillTemplate", () => {
  test("fills known placeholders and leaves unknown ones", () => {
    expect(fillTemplate("{X}% of {n}", { X: 9, n: 3 })).toBe("9% of 3");
    expect(fillTemplate("{X} and {Y}", { X: 1 })).toBe("1 and {Y}");
    expect(fillTemplate("{toString}", {})).toBe("{toString}");
  });
});

describe("well-formed sentences (T18)", () => {
  test("no reason across T1, T2, T4 and T18 has a placeholder, a bad number or a double space", () => {
    const fromEngine = [
      ...CANONICAL_FIXTURES.map((f) =>
        computeRecommendation(f.input, f.market),
      ),
      // T2's edges.
      ...[
        [9167, 10000],
        [9166, 10000],
        [9160, 10000],
        [10500, 10000],
        [10501, 10000],
        [10510, 10000],
        [18333, 20000],
        [18332, 20000],
        [21000, 20000],
        [21001, 20000],
        [52502, 50000],
        [100000, 100001],
      ].map(([asking, market]) =>
        computeRecommendation(
          fixtureInput(asking),
          fixtureMarket(market, flat(30, market)),
        ),
      ),
      // T4's counts.
      ...[7, 13, 14, 27, 28, 29, 30].map((n) =>
        computeRecommendation(
          fixtureInput(8150),
          fixtureMarket(8150, flat(n, 8150)),
        ),
      ),
    ].map((r) => r.reason);
    const all = [...collected, ...fromEngine];
    expect(all.length).toBeGreaterThan(40);
    for (const reason of all) {
      for (const bad of [
        "{",
        "}",
        "NaN",
        "undefined",
        "Infinity",
        "-0",
        "  ",
      ]) {
        expect(reason, reason).not.toContain(bad);
      }
      expect(reason).toMatch(/[^.]\.$/);
      expect(reason.trim()).toBe(reason);
    }
  });
});
