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

describe("extreme deltas (ADV-4, D8)", () => {
  test("a below clause never reads 100%: X is at most 99", () => {
    expect(keep(reasonFor("buy", -9849))).toBe("98% below market.");
    expect(keep(reasonFor("buy", -9850))).toBe("99% below market.");
    expect(keep(reasonFor("buy", -9949))).toBe("99% below market.");
    expect(keep(reasonFor("buy", -9950))).toBe("99% below market.");
    expect(keep(reasonFor("buy", -9999))).toBe("99% below market.");
    expect(keep(reasonFor("buy", -10000))).toBe("99% below market.");
    expect(keep(reasonFor("buy", -9999, "low", 7))).toBe(
      "99% below market; only 7 price snapshots.",
    );
  });

  test("an above clause is not capped: it states the observed multiple", () => {
    expect(keep(reasonFor("wait", 10000))).toBe("100% above market.");
    expect(keep(reasonFor("wait", 99_999_990_000))).toBe(
      "999999900% above market.",
    );
  });

  test.each([
    [1, 8150, -9999, "buy", "99% below market."],
    [41, 8150, -9950, "buy", "99% below market."],
    [1, 30000, -10000, "buy", "99% below market."],
    [10_000_000, 1, 99_999_990_000, "wait", "999999900% above market."],
    [10_000_000, 10_000_000, 0, "fair", "At market price."],
  ] as const)(
    "asking %i against market %i (30 flat snapshots): deltaBp %i, %s, %s",
    (asking, market, deltaBp, kind, reason) => {
      const r = computeRecommendation(
        fixtureInput(asking),
        fixtureMarket(market, flat(30, market)),
      );
      expect(r.signals.deltaBp).toBe(deltaBp);
      expect(r.signals.deltaPct).toBe(deltaBp / 100);
      expect(r.kind).toBe(kind);
      expect(r.confidence).toBe("high");
      expect(keep(r.reason)).toBe(reason);
    },
  );
});

describe("extreme trends (S3.1 adversarial review UB-1; S3.1d16)", () => {
  const withTrend = (
    direction: "rising" | "falling",
    X: number,
    confidence: Confidence = "high",
  ) =>
    buildReason({
      kind: "fair",
      deltaBp: -1000,
      bandPct: 5,
      confidence,
      snapshotCount30d: confidence === "low" ? 7 : 30,
      trend: { direction, X },
    });

  test("a falling trend clause never reads 100% or more: X is at most 99", () => {
    expect(withTrend("falling", 98)).toBe(
      "10% below market; 30-day trend is falling 98%.",
    );
    expect(withTrend("falling", 99)).toBe(
      "10% below market; 30-day trend is falling 99%.",
    );
    expect(withTrend("falling", 100)).toBe(
      "10% below market; 30-day trend is falling 99%.",
    );
    expect(withTrend("falling", 818, "low")).toBe(
      "10% below market; 30-day trend is falling 99%; only 7 price snapshots.",
    );
  });

  test("a rising trend clause is not capped", () => {
    expect(withTrend("rising", 100)).toBe(
      "10% below market; 30-day trend is rising 100%.",
    );
    expect(withTrend("rising", 169)).toBe(
      "10% below market; 30-day trend is rising 169%.",
    );
  });
});

describe("the caveat slot: stale > thin-data > volatility (S3.2 T14; S3.2d5)", () => {
  const base = {
    kind: "fair" as const,
    deltaBp: -184,
    bandPct: 7.5,
    snapshotCount30d: 20,
  };

  test("stale gives the stale clause whatever the confidence", () => {
    for (const confidence of ["high", "medium", "low"] as const) {
      expect(keep(buildReason({ ...base, confidence, stale: { d: 8 } }))).toBe(
        "Within 2% of market; latest price data is 8 days old.",
      );
    }
  });

  test("low confidence without stale gives the thin-data clause", () => {
    expect(
      keep(
        buildReason({
          ...base,
          confidence: "low",
          snapshotCount30d: 10,
          volatility: { X: 30 },
        }),
      ),
    ).toBe("Within 2% of market; only 10 price snapshots.");
  });

  test("volatility without stale or low confidence gives the volatility clause", () => {
    expect(
      keep(
        buildReason({
          ...base,
          kind: "fair",
          deltaBp: -1200,
          bandPct: 10,
          confidence: "high",
          volatility: { X: 30 },
        }),
      ),
    ).toBe("12% below market; price has been volatile (±30%).");
  });

  test("all three passed give the stale clause only", () => {
    const reason = keep(
      buildReason({
        ...base,
        confidence: "low",
        snapshotCount30d: 10,
        stale: { d: 15 },
        volatility: { X: 30 },
      }),
    );
    expect(reason).toBe(
      "Within 2% of market; latest price data is 15 days old.",
    );
    expect(reason).not.toContain("snapshots");
    expect(reason).not.toContain("volatile");
  });

  test("the trend clause always sits before the caveat", () => {
    const trend = { direction: "falling" as const, X: 18 };
    expect(
      keep(
        buildReason({
          ...base,
          kind: "fair",
          deltaBp: -920,
          confidence: "low",
          trend,
          stale: { d: 8 },
        }),
      ),
    ).toBe(
      "9% below market; 30-day trend is falling 18%; latest price data is 8 days old.",
    );
    expect(
      keep(
        buildReason({
          ...base,
          kind: "buy",
          deltaBp: -500,
          bandPct: 5.77,
          confidence: "high",
          trend: { direction: "rising", X: 60 },
          volatility: { X: 17 },
        }),
      ),
    ).toBe(
      "5% below market; 30-day trend is rising 60%; price has been volatile (±17%).",
    );
  });

  test("the strings are F1's locked templates, filled", () => {
    expect(buildReason({ ...base, confidence: "high", stale: { d: 9 } })).toBe(
      `Within 2% of market; ${fillTemplate(REASON_COPY.stale, { d: 9 })}.`,
    );
    expect(
      buildReason({ ...base, confidence: "high", volatility: { X: 44 } }),
    ).toBe(
      `Within 2% of market; ${fillTemplate(REASON_COPY.volatility, { X: 44 })}.`,
    );
  });

  test("Tier-1 inputs (no stale, no volatility) give S1.2's reasons unchanged", () => {
    for (const f of CANONICAL_FIXTURES) {
      expect(computeRecommendation(f.input, f.market).reason, f.name).toBe(
        f.expected.reason,
      );
    }
    expect(reasonFor("fair", -184, "medium", 20)).toBe("Within 2% of market.");
    expect(reasonFor("wait", 1905, "low", 10)).toBe(
      "19% above market; only 10 price snapshots.",
    );
  });

  test("insufficient_data ignores stale and volatility", () => {
    expect(
      buildReason({
        kind: "insufficient_data",
        deltaBp: null,
        bandPct: 5,
        confidence: "low",
        snapshotCount30d: 3,
        stale: { d: 20 },
        volatility: { X: 40 },
      }),
    ).toBe(INSUFFICIENT_DATA_SENTENCE);
  });
});

describe("fillTemplate", () => {
  test("fills known placeholders and leaves unknown ones", () => {
    expect(fillTemplate("{X}% of {n}", { X: 9, n: 3 })).toBe("9% of 3");
    // String-typed templates: a literal one would not compile without every
    // key (S1.3d7), but at run time a missing key keeps its placeholder.
    const partial: string = "{X} and {Y}";
    const inherited: string = "{toString}";
    expect(fillTemplate(partial, { X: 1 })).toBe("1 and {Y}");
    expect(fillTemplate(inherited, {})).toBe("{toString}");
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
