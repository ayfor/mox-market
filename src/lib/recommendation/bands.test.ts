// T2, T3 (AC-2, AC-7; C1.41 = A, S1.2d6): band edges in integer basis points.
import { describe, expect, test } from "vitest";
import { bandKind, deltaBpOf, thresholdsBp, trendThresholdBp } from "./bands";
import { computeRecommendation } from "./engine";
import {
  CANONICAL_FIXTURES,
  fixtureInput,
  fixtureMarket,
  flat,
} from "./fixtures";
import { RECOMMENDATION_PARAMS } from "./params";

/** [asking, market, deltaBp, kind] */
const EDGES = [
  [9167, 10000, -833, "fair"],
  [9166, 10000, -834, "buy"],
  [9160, 10000, -840, "buy"],
  [10500, 10000, 500, "fair"],
  [10501, 10000, 501, "wait"],
  [10510, 10000, 510, "wait"],
  // Half-bp rounding: Math.round goes toward +∞.
  [18333, 20000, -833, "fair"], // raw −833.5
  [18332, 20000, -834, "buy"], // raw −834
  [21000, 20000, 500, "fair"],
  [21001, 20000, 501, "wait"], // raw +500.5
  [52502, 50000, 500, "fair"], // raw +500.4
] as const;

describe("trendThresholdBp (ADV-1)", () => {
  test("F1's 0.5 %/day is 50 bp/day, rounded to whole bp like the bands", () => {
    expect(trendThresholdBp(RECOMMENDATION_PARAMS)).toBe(50);
    const at = (trendThresholdPct: number) =>
      trendThresholdBp({ ...RECOMMENDATION_PARAMS, trendThresholdPct });
    expect(at(0.4)).toBe(40);
    expect(at(0.504)).toBe(50);
    expect(at(0.506)).toBe(51);
    expect(Object.is(at(0), 0)).toBe(true);
  });
});

describe("thresholdsBp (T2)", () => {
  test("F1's params give −833 and +500", () => {
    expect(thresholdsBp(RECOMMENDATION_PARAMS)).toEqual({
      buyBp: -833,
      waitBp: 500,
    });
  });
});

describe("band edges (T2, AC-2)", () => {
  test.each(EDGES)(
    "asking %i against market %i → deltaBp %i, %s",
    (asking, market, bp, kind) => {
      expect(deltaBpOf(asking, market)).toBe(bp);
      expect(bandKind(bp, thresholdsBp(RECOMMENDATION_PARAMS))).toBe(kind);
      // The engine uses the same comparison.
      const r = computeRecommendation(
        fixtureInput(asking),
        fixtureMarket(market, flat(30, market)),
      );
      expect(r.signals.deltaBp).toBe(bp);
      expect(r.kind).toBe(kind);
      expect(r.confidence).toBe("high");
    },
  );

  test("18333 against 20000 is Fair in integer bp, though a float compare says Buy (C1.41 = A)", () => {
    const rawPct = ((18333 - 20000) / 20000) * 100;
    expect(rawPct).toBeLessThan(-25 / 3);
    const r = computeRecommendation(
      fixtureInput(18333),
      fixtureMarket(20000, flat(30, 20000)),
    );
    expect(r.kind).toBe("fair");
  });

  test("equality with either threshold is Fair; one bp past it is not", () => {
    const t = thresholdsBp(RECOMMENDATION_PARAMS);
    expect(bandKind(t.buyBp, t)).toBe("fair");
    expect(bandKind(t.buyBp - 1, t)).toBe("buy");
    expect(bandKind(t.waitBp, t)).toBe("fair");
    expect(bandKind(t.waitBp + 1, t)).toBe("wait");
  });
});

describe("reported deltas and thresholds (T3, AC-2, AC-7; S1.2d6)", () => {
  const outcomes = [
    ...CANONICAL_FIXTURES.map((f) => computeRecommendation(f.input, f.market)),
    ...EDGES.map(([asking, market]) =>
      computeRecommendation(
        fixtureInput(asking),
        fixtureMarket(market, flat(30, market)),
      ),
    ),
  ];

  test("deltaPct is deltaBp / 100 on every T1 and T2 case", () => {
    for (const r of outcomes) {
      if (r.signals.deltaBp === null) {
        expect(r.signals.deltaPct).toBeNull();
      } else {
        expect(r.signals.deltaPct).toBe(r.signals.deltaBp / 100);
      }
    }
  });

  test("asking 100000 against 100001 gives +0, never −0, and At market price", () => {
    expect(
      Object.is(Math.round(((100000 - 100001) * 10000) / 100001), -0),
    ).toBe(true);
    expect(Object.is(deltaBpOf(100000, 100001), 0)).toBe(true);
    const r = computeRecommendation(
      fixtureInput(100000),
      fixtureMarket(100001, flat(30, 100001)),
    );
    expect(Object.is(r.signals.deltaBp, 0)).toBe(true);
    expect(Object.is(r.signals.deltaPct, 0)).toBe(true);
    expect(r.kind).toBe("fair");
    expect(r.reason).toBe("At market price.");
  });

  test("every outcome, insufficient_data included, reports the Tier-1 band constants", () => {
    expect(outcomes.some((r) => r.kind === "insufficient_data")).toBe(true);
    for (const r of outcomes) {
      expect(r.signals.bandPct).toBe(5);
      expect(r.signals.wideningFactor).toBe(1);
      expect(r.signals.buyThresholdPct).toBe(-8.33);
      expect(r.signals.waitThresholdPct).toBe(5);
    }
  });
});
