// S3.1 T1 to T11 (AC-1, AC-2, AC-3, AC-6; F3 W2): Tier 2's trend band shift
// through computeTieredRecommendation, and tier2Thresholds on its own. Every
// expected value was computed independently of the engine (plain arithmetic
// and the OLS formula; plan Test Manifest). Reasons are asserted exactly.
import { describe, expect, test } from "vitest";
import { computeRecommendation, computeTieredRecommendation } from "./engine";
import {
  canonicalFixture,
  INSUFFICIENT_DATA_SENTENCE,
  TIER2_FIXTURES,
  tier2FixtureNamed,
  type Tier2Fixture,
} from "./fixtures";
import { RECOMMENDATION_PARAMS } from "./params";
import { exactSlopePct, type SeriesPoint } from "./signals";
import { tier2Thresholds, trendClauseX } from "./tier2";
import type { Recommendation } from "./types";

const tiersOf = (f: Pick<Tier2Fixture, "input" | "market">) =>
  computeTieredRecommendation(f.input, f.market);

/** tier2, asserted present. */
function tier2Of(f: Pick<Tier2Fixture, "input" | "market">): Recommendation {
  const { tier2 } = tiersOf(f);
  if (tier2 === null) throw new Error("expected a Tier 2 result");
  return tier2;
}

const named = tier2FixtureNamed;

describe("every Tier-2 fixture (T1 to T10)", () => {
  test.each(TIER2_FIXTURES.map((f) => [f.name, f] as const))(
    "%s: tier1 and tier2 match their expectations exactly",
    (_name, f) => {
      const { tier1, tier2 } = tiersOf(f);
      expect({
        kind: tier1.kind,
        confidence: tier1.confidence,
        reason: tier1.reason,
      }).toEqual(f.expected.tier1);
      if (f.expected.tier2 === null) {
        expect(tier2).toBeNull();
        return;
      }
      expect(tier2).not.toBeNull();
      const t2 = tier2 as Recommendation;
      expect({
        kind: t2.kind,
        confidence: t2.confidence,
        reason: t2.reason,
        buyThresholdPct: t2.signals.buyThresholdPct,
        waitThresholdPct: t2.signals.waitThresholdPct,
        bandPct: t2.signals.bandPct,
        wideningFactor: t2.signals.wideningFactor,
      }).toEqual(f.expected.tier2);
    },
  );

  test("the fixture names are unique", () => {
    const names = TIER2_FIXTURES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("tier2FixtureNamed throws on an unknown name", () => {
    expect(() => named("nope")).toThrow(/no Tier-2 fixture named nope/);
  });
});

describe("AC-1: worked example C (T1)", () => {
  test("tier1 buy at −920 bp; tier2 fair, thresholds −13.33 / 0, falling 18%", () => {
    const { tier1, tier2 } = tiersOf(canonicalFixture("C"));
    expect(tier1.kind).toBe("buy");
    expect(tier1.confidence).toBe("high");
    expect(tier1.signals.deltaBp).toBe(-920);
    expect(tier1.reason).toBe("9% below market.");
    expect(tier1.signals.buyThresholdPct).toBe(-8.33);
    expect(tier1.signals.waitThresholdPct).toBe(5);

    expect(tier2).not.toBeNull();
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe("fair");
    expect(t2.confidence).toBe("high");
    expect(t2.signals.buyThresholdPct).toBe(-13.33);
    expect(Object.is(t2.signals.waitThresholdPct, 0)).toBe(true);
    expect(t2.signals.bandPct).toBe(5);
    expect(t2.signals.wideningFactor).toBe(1);
    expect(t2.signals.slope30dPct).toBe(-0.6);
    expect(t2.signals.trendDirection).toBe("falling");
    expect(t2.reason).toBe("9% below market; 30-day trend is falling 18%.");
    expect(t2.reason).toContain("falling 18%");
  });

  test("the −9 shift clamps to −5: buy −1333 bp, wait 0 bp", () => {
    const t = tier2Thresholds(
      { confidence: "high", trendDirection: "falling", slope30dPct: -0.6 },
      RECOMMENDATION_PARAMS,
    );
    expect(t.shiftPct).toBe(-5);
    expect(t.buyBp).toBe(-1333);
    expect(Object.is(t.waitBp, 0)).toBe(true);
  });
});

describe("AC-2: A-rising (T2)", () => {
  test("tier1 fair at −500 bp; tier2 buy, thresholds −3.33 / 10, rising 18%", () => {
    const { tier1, tier2 } = tiersOf(canonicalFixture("A-rising"));
    expect(tier1.kind).toBe("fair");
    expect(tier1.confidence).toBe("high");
    expect(tier1.signals.deltaBp).toBe(-500);
    expect(tier1.reason).toBe("Within 5% of market.");
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe("buy");
    expect(t2.confidence).toBe("high");
    expect(t2.signals.buyThresholdPct).toBe(-3.33);
    expect(t2.signals.waitThresholdPct).toBe(10);
    expect(t2.signals.bandPct).toBe(5);
    expect(t2.signals.wideningFactor).toBe(1);
    expect(t2.reason).toBe("5% below market; 30-day trend is rising 18%.");
    expect(t2.reason).toContain("rising 18%");
  });

  test("the +9 shift clamps to +5: buy −333 bp, wait 1000 bp", () => {
    const t = tier2Thresholds(
      { confidence: "high", trendDirection: "rising", slope30dPct: 0.6 },
      RECOMMENDATION_PARAMS,
    );
    expect(t.shiftPct).toBe(5);
    expect(t.buyBp).toBe(-333);
    expect(t.waitBp).toBe(1000);
  });
});

describe("AC-3(a): no verdict, no Tier 2 (T3)", () => {
  test.each(["D0", "E"])(
    "%s: tier1 insufficient_data with the sentence verbatim; tier2 null",
    (name) => {
      const f = canonicalFixture(name);
      const { tier1, tier2 } = tiersOf(f);
      expect(tier1.kind).toBe("insufficient_data");
      expect(tier1.confidence).toBe("low");
      expect(tier1.reason).toBe(INSUFFICIENT_DATA_SENTENCE);
      expect(tier1.reason).toContain("—");
      expect(tier2).toBeNull();
      // Served with the flag on, it is still Tier 1's insufficient_data.
      expect(
        computeRecommendation(f.input, f.market, {
          ...RECOMMENDATION_PARAMS,
          TIER2_ENABLED: true,
        }),
      ).toStrictEqual(tier1);
    },
  );
});

describe("AC-3(b): thin data inside the dead zone (T4)", () => {
  test("D: wait, low, widened 1.5× to 7.5, −12.5 / 7.5, flat (not null), slope +0", () => {
    const t2 = tier2Of(canonicalFixture("D"));
    expect(t2.kind).toBe("wait");
    expect(t2.confidence).toBe("low");
    expect(t2.signals.wideningFactor).toBe(1.5);
    expect(t2.signals.bandPct).toBe(7.5);
    expect(t2.signals.buyThresholdPct).toBe(-12.5);
    expect(t2.signals.waitThresholdPct).toBe(7.5);
    expect(t2.signals.trendDirection).toBe("flat");
    expect(Object.is(t2.signals.slope30dPct, 0)).toBe(true);
    expect(t2.signals.volatility30d).toBeNull();
    expect(t2.reason).toBe("19% above market; only 10 price snapshots.");
  });

  test("D-buy: buy, the thin-data clause", () => {
    const t2 = tier2Of(canonicalFixture("D-buy"));
    expect(t2.kind).toBe("buy");
    expect(t2.reason).toBe("14% below market; only 10 price snapshots.");
  });

  test("Z10 (slope exactly 0.5 %/day) is flat: no shift, −12.5 / 7.5, at market", () => {
    const f = named("Z10");
    const { tier1, tier2 } = tiersOf(f);
    expect(tier1.signals.slope30dPct).toBe(0.5);
    expect(tier1.signals.trendDirection).toBe("flat");
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe("fair");
    expect(t2.signals.buyThresholdPct).toBe(-12.5);
    expect(t2.signals.waitThresholdPct).toBe(7.5);
    expect(t2.reason).toBe("At market price; only 10 price snapshots.");
    expect(t2.reason).not.toMatch(/trend/);
  });

  test.each([
    ["D-7", 7, "low", 1.5, 7.5, "19% above market; only 7 price snapshots."],
    ["D-13", 13, "low", 1.5, 7.5, "19% above market; only 13 price snapshots."],
    ["D-14", 14, "medium", 1, 5, "19% above market."],
  ] as const)(
    "%s (%i flat rows): %s, wideningFactor %d, bandPct %d",
    (name, n, confidence, factor, band, reason) => {
      const t2 = tier2Of(named(name));
      expect(t2.signals.snapshotCount30d).toBe(n);
      expect(t2.confidence).toBe(confidence);
      expect(t2.signals.wideningFactor).toBe(factor);
      expect(t2.signals.bandPct).toBe(band);
      expect(t2.kind).toBe("wait");
      expect(t2.reason).toBe(reason);
    },
  );
});

describe("widening flips the verdict; equality at a widened threshold is Fair (T5, C1.34, C1.41 = A)", () => {
  test.each([
    [
      "D-wide-4500",
      714,
      "wait",
      "fair",
      "Within 7% of market; only 10 price snapshots.",
    ],
    [
      "D-wide-4515",
      750,
      "wait",
      "fair",
      "Within 8% of market; only 10 price snapshots.",
    ],
    [
      "D-wide-4516",
      752,
      "wait",
      "wait",
      "8% above market; only 10 price snapshots.",
    ],
    [
      "D-wide-3675",
      -1250,
      "buy",
      "fair",
      "13% below market; only 10 price snapshots.",
    ],
    [
      "D-wide-3674",
      -1252,
      "buy",
      "buy",
      "13% below market; only 10 price snapshots.",
    ],
  ] as const)(
    "%s (deltaBp %i): tier1 %s, tier2 %s",
    (name, deltaBp, kind1, kind2, reason2) => {
      const { tier1, tier2 } = tiersOf(named(name));
      expect(tier1.signals.deltaBp).toBe(deltaBp);
      expect(tier1.kind).toBe(kind1);
      const t2 = tier2 as Recommendation;
      expect(t2.kind).toBe(kind2);
      expect(t2.reason).toBe(reason2);
      expect(t2.signals.waitThresholdPct).toBe(7.5);
      expect(t2.signals.buyThresholdPct).toBe(-12.5);
    },
  );
});

describe("trend on thin data: widen, then asymmetry, then a clamped shift (T6)", () => {
  test("D-rising: 1.5×, band 7.5, the +9 shift clamps to +7.5: −5 / 15", () => {
    const t = tier2Thresholds(
      { confidence: "low", trendDirection: "rising", slope30dPct: 0.6 },
      RECOMMENDATION_PARAMS,
    );
    expect(t.wideningFactor).toBe(1.5);
    expect(t.bandPct).toBe(7.5);
    expect(t.shiftPct).toBe(7.5);
    expect(t.buyBp).toBe(-500);
    expect(t.waitBp).toBe(1500);
  });

  test("asking 7600 (−500 bp, equal to the buy threshold) is fair; 7599 (−501) is buy", () => {
    const fair = tiersOf(named("D-rising-7600"));
    expect(fair.tier1.signals.deltaBp).toBe(-500);
    expect(fair.tier1.reason).toBe(
      "Within 5% of market; only 10 price snapshots.",
    );
    expect(fair.tier2?.kind).toBe("fair");
    expect(fair.tier2?.reason).toBe(
      "Within 5% of market; 30-day trend is rising 18%; only 10 price snapshots.",
    );
    const buy = tiersOf(named("D-rising-7599"));
    expect(buy.tier1.signals.deltaBp).toBe(-501);
    expect(buy.tier2?.kind).toBe("buy");
    expect(buy.tier2?.reason).toBe(
      "5% below market; 30-day trend is rising 18%; only 10 price snapshots.",
    );
  });

  test("C7: tier1 buy, low; tier2 fair at −20 / 0 with one trend clause, then the caveat", () => {
    const { tier1, tier2 } = tiersOf(named("C7"));
    expect(tier1.kind).toBe("buy");
    expect(tier1.confidence).toBe("low");
    expect(tier1.signals.slope30dPct).toBe(-0.6);
    expect(tier1.reason).toBe("9% below market; only 7 price snapshots.");
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe("fair");
    expect(t2.signals.buyThresholdPct).toBe(-20);
    expect(Object.is(t2.signals.waitThresholdPct, 0)).toBe(true);
    expect(t2.reason).toBe(
      "9% below market; 30-day trend is falling 18%; only 7 price snapshots.",
    );
    expect(t2.reason.match(/30-day trend/g)).toHaveLength(1);
    expect(t2.reason.indexOf("trend")).toBeLessThan(t2.reason.indexOf("only"));
  });
});

describe("AC-6: the boundary after the shift (T7)", () => {
  test("market 30000: 26000 (−1333 bp) is fair; 25999 (−1334 bp) is buy; tier1 buy for both", () => {
    const fair = tiersOf(named("C-30000-26000"));
    expect(fair.tier1.signals.deltaBp).toBe(-1333);
    expect(fair.tier1.kind).toBe("buy");
    expect(fair.tier2?.kind).toBe("fair");
    expect(fair.tier2?.signals.buyThresholdPct).toBe(-13.33);
    expect(fair.tier2?.reason).toBe(
      "13% below market; 30-day trend is falling 18%.",
    );
    const buy = tiersOf(named("C-30000-25999"));
    expect(buy.tier1.signals.deltaBp).toBe(-1334);
    expect(buy.tier1.kind).toBe("buy");
    expect(buy.tier2?.kind).toBe("buy");
    expect(buy.tier2?.reason).toBe(
      "13% below market; 30-day trend is falling 18%.",
    );
  });
});

describe("AC-6: the monster trend (T8)", () => {
  test("M: slope exactly 2, the +30 shift clamps to +5, the reason cites the raw 60%", () => {
    const { tier1, tier2 } = tiersOf(named("M"));
    expect(tier1.signals.slope30dPct).toBe(2);
    expect(tier1.signals.trendDirection).toBe("rising");
    expect(tier1.kind).toBe("fair");
    expect(tier1.reason).toBe("Within 5% of market.");
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe("buy");
    expect(t2.signals.buyThresholdPct).toBe(-3.33);
    expect(t2.signals.waitThresholdPct).toBe(10);
    expect(t2.reason).toBe("5% below market; 30-day trend is rising 60%.");
    expect(t2.reason).not.toMatch(/rising (5|15)%/);
  });
});

describe("the dead-zone edge at full history (T9, C1.10 = A)", () => {
  test.each(["Z30", "Z30-falling"])(
    "%s (slope exactly ±0.5) is flat: no shift, and tier2 deep-equals tier1",
    (name) => {
      const { tier1, tier2 } = tiersOf(named(name));
      expect(Math.abs(tier1.signals.slope30dPct as number)).toBe(0.5);
      expect(tier1.signals.trendDirection).toBe("flat");
      expect(tier2).toStrictEqual(tier1);
      expect(tier2?.signals.buyThresholdPct).toBe(-8.33);
      expect(tier2?.signals.waitThresholdPct).toBe(5);
    },
  );

  test("R41 (slope ≈ 0.5125) is rising and shifts by the clamped +5", () => {
    const { tier1, tier2 } = tiersOf(named("R41"));
    expect(tier1.signals.slope30dPct).toBeCloseTo(41 / 80.005, 12);
    expect(tier1.signals.trendDirection).toBe("rising");
    expect(tier2?.signals.buyThresholdPct).toBe(-3.33);
    expect(tier2?.signals.waitThresholdPct).toBe(10);
    expect(tier2?.reason).toBe("At market price; 30-day trend is rising 15%.");
  });

  test("no tier2 reason carries a trend clause when trendDirection is flat or null", () => {
    for (const f of TIER2_FIXTURES) {
      const { tier1, tier2 } = tiersOf(f);
      if (tier2 === null) continue;
      const trending =
        tier1.signals.trendDirection === "rising" ||
        tier1.signals.trendDirection === "falling";
      expect(/30-day trend/.test(tier2.reason), f.name).toBe(trending);
    }
  });

  test("tier2Thresholds never shifts on a flat or null trend, whatever the slope", () => {
    for (const trendDirection of ["flat", null] as const) {
      const t = tier2Thresholds(
        { confidence: "high", trendDirection, slope30dPct: 3 },
        RECOMMENDATION_PARAMS,
      );
      expect(Object.is(t.shiftPct, 0)).toBe(true);
      expect(t.buyBp).toBe(-833);
      expect(t.waitBp).toBe(500);
    }
  });
});

describe("the fair frames Tier 2 makes reachable (T10, C1.25; S3.1d12)", () => {
  test("A-rising at 8560 (+700 bp): tier1 wait, tier2 fair above the band", () => {
    const { tier1, tier2 } = tiersOf(named("A-rising-8560"));
    expect(tier1.signals.deltaBp).toBe(700);
    expect(tier1.kind).toBe("wait");
    expect(tier1.reason).toBe("7% above market.");
    expect(tier2?.kind).toBe("fair");
    expect(tier2?.reason).toBe("7% above market; 30-day trend is rising 18%.");
  });

  test("C at 8150 (0 bp): at market with the trend clause", () => {
    const { tier2 } = tiersOf(named("C-8150"));
    expect(tier2?.kind).toBe("fair");
    expect(tier2?.reason).toBe("At market price; 30-day trend is falling 18%.");
  });

  test('C at 8151 (+1 bp, above the shifted wait threshold 0): wait, "0% above market"', () => {
    const { tier1, tier2 } = tiersOf(named("C-8151"));
    expect(tier1.signals.deltaBp).toBe(1);
    expect(tier1.kind).toBe("fair");
    expect(tier2?.kind).toBe("wait");
    expect(tier2?.reason).toBe("0% above market; 30-day trend is falling 18%.");
  });
});

describe("tier2Thresholds on its own (T11; the S3.2 seam)", () => {
  test.each([
    [1, -833, 500],
    [1.5, -1250, 750],
    [2, -1667, 1000],
  ])("wideningFactor %d, flat: buy %i, wait %i", (factor, buyBp, waitBp) => {
    // At S3.1 the low-confidence factor is the only one; volWiden is S3.2's.
    const t = tier2Thresholds(
      { confidence: "high", trendDirection: "flat", slope30dPct: 0 },
      RECOMMENDATION_PARAMS,
      factor,
    );
    expect(t.wideningFactor).toBe(factor);
    expect(t.buyBp).toBe(buyBp);
    expect(t.waitBp).toBe(waitBp);
  });

  test("low confidence multiplies the volatility factor: 1 × 1.5", () => {
    const t = tier2Thresholds(
      { confidence: "low", trendDirection: "flat", slope30dPct: 0 },
      RECOMMENDATION_PARAMS,
    );
    expect(t.wideningFactor).toBe(1.5);
    expect(t.bandPct).toBe(7.5);
  });

  test("slope 0.6 rising at wideningFactor 2: the unclamped +9 shift, buy −767, wait 1900", () => {
    const t = tier2Thresholds(
      { confidence: "high", trendDirection: "rising", slope30dPct: 0.6 },
      RECOMMENDATION_PARAMS,
      2,
    );
    expect(t.shiftPct).toBeCloseTo(9, 12);
    expect(t.buyBp).toBe(-767);
    expect(t.waitBp).toBe(1900);
  });

  test("slope −0.6 falling at wideningFactor 2: buy −2567, wait 100", () => {
    const t = tier2Thresholds(
      { confidence: "high", trendDirection: "falling", slope30dPct: -0.6 },
      RECOMMENDATION_PARAMS,
      2,
    );
    expect(t.shiftPct).toBeCloseTo(-9, 12);
    expect(t.buyBp).toBe(-2567);
    expect(t.waitBp).toBe(100);
  });

  test("no threshold or shift is ever −0", () => {
    for (const confidence of ["high", "medium", "low"] as const) {
      for (const [trendDirection, slope30dPct] of [
        ["rising", 0.6],
        ["falling", -0.6],
        ["flat", 0],
        ["flat", -0.4],
        [null, null],
      ] as const) {
        for (const factor of [1, 1.5, 2]) {
          const t = tier2Thresholds(
            { confidence, trendDirection, slope30dPct },
            RECOMMENDATION_PARAMS,
            factor,
          );
          for (const v of [t.buyBp, t.waitBp, t.shiftPct]) {
            expect(Object.is(v, -0)).toBe(false);
          }
        }
      }
    }
  });

  test("a rising trend with a null slope never shifts (defensive)", () => {
    const t = tier2Thresholds(
      { confidence: "high", trendDirection: "rising", slope30dPct: null },
      RECOMMENDATION_PARAMS,
    );
    expect(Object.is(t.shiftPct, 0)).toBe(true);
  });
});

describe("trendClauseX (S3.1d7)", () => {
  const ratio = (num: number, den: number) => ({
    num: BigInt(num),
    den: BigInt(den),
  });

  test("X is |slope × windowDays| rounded half up on the exact ratio", () => {
    expect(trendClauseX(ratio(-3, 5), RECOMMENDATION_PARAMS)).toBe(18);
    expect(trendClauseX(ratio(2, 1), RECOMMENDATION_PARAMS)).toBe(60);
    // 0.51666… × 30 = 15.5 exactly: half rounds up, for either sign.
    expect(trendClauseX(ratio(31, 60), RECOMMENDATION_PARAMS)).toBe(16);
    expect(trendClauseX(ratio(-31, 60), RECOMMENDATION_PARAMS)).toBe(16);
    // Just under the half: 15.4999… rounds down.
    expect(trendClauseX(ratio(30999, 60000), RECOMMENDATION_PARAMS)).toBe(15);
  });

  test("R41's exact slope gives 15", () => {
    const points: SeriesPoint[] = Array.from({ length: 30 }, (_, x) => ({
      x,
      num: BigInt(7406 + 41 * x),
      den: BigInt(1),
    }));
    const exact = exactSlopePct(points);
    expect(exact).not.toBeNull();
    expect(trendClauseX(exact!, RECOMMENDATION_PARAMS)).toBe(15);
  });
});

describe("tier2 copies tier1 except the adjusted fields (S3.1d8)", () => {
  test("only kind, reason, bandPct, wideningFactor and the two thresholds differ", () => {
    for (const f of TIER2_FIXTURES) {
      const { tier1, tier2 } = tiersOf(f);
      if (tier2 === null) continue;
      expect(
        {
          ...tier2,
          kind: tier1.kind,
          reason: tier1.reason,
          signals: {
            ...tier2.signals,
            bandPct: tier1.signals.bandPct,
            wideningFactor: tier1.signals.wideningFactor,
            buyThresholdPct: tier1.signals.buyThresholdPct,
            waitThresholdPct: tier1.signals.waitThresholdPct,
          },
        },
        f.name,
      ).toStrictEqual(tier1);
    }
  });

  test("the inputs are not mutated", () => {
    const f = named("C7");
    const before = structuredClone({ input: f.input, market: f.market });
    tiersOf(f);
    expect({ input: f.input, market: f.market }).toStrictEqual(before);
  });
});
