// S3.2 T1 to T3, T6, T8 to T11 (AC-1, AC-2, AC-3, AC-5, AC-7, AC-8, AC-9;
// S3.1d13 re-check): F3 Tier 2's volatility widening, staleness cap and the
// single caveat slot, through computeTieredRecommendation. Every expected
// value was computed before the build by a scratch reference model,
// independent of the engine (plan Test Manifest). Reasons are exact.
import { describe, expect, test } from "vitest";
import { computeTieredRecommendation } from "./engine";
import {
  CANONICAL_FIXTURES,
  canonicalFixture,
  s32FixtureNamed,
  S3_2_FIXTURES,
  TIER2_DATA_EDGE_FIXTURES,
  TIER2_FIXTURES,
  type S3_2Fixture,
} from "./fixtures";
import { RECOMMENDATION_PARAMS } from "./params";
import { latestAgeDays, volatilityWiden } from "./tier2";
import type {
  MarketSnapshot,
  Recommendation,
  RecommendationInput,
} from "./types";
import { readWindow } from "./window";

interface Case {
  readonly name: string;
  readonly input: RecommendationInput;
  readonly market: MarketSnapshot;
}

const tiersOf = (f: Case) => computeTieredRecommendation(f.input, f.market);

/** tier2, asserted present. */
function tier2Of(f: Case): Recommendation {
  const { tier2 } = tiersOf(f);
  if (tier2 === null) throw new Error(`expected a Tier 2 result for ${f.name}`);
  return tier2;
}

const named = s32FixtureNamed;

/** Whole bp from a threshold in percent. */
const bp = (pct: number) => Math.round(pct * 100);

/** The two thresholds of a result, in whole bp. */
const thresholdsOf = (r: Recommendation) => [
  bp(r.signals.buyThresholdPct),
  bp(r.signals.waitThresholdPct),
];

const MS_PER_DAY = 86_400_000;

/**
 * utcDay(asOf) − the newest window row's date, from the dates themselves
 * (not the engine's index arithmetic), or null for an empty window.
 */
function ageFromDates(market: MarketSnapshot): number | null {
  const rows = readWindow(
    market.history,
    market.asOf,
    RECOMMENDATION_PARAMS.windowDays,
  );
  const latest = rows.at(-1);
  if (latest === undefined) return null;
  return (Date.parse(market.asOf) - Date.parse(latest.date)) / MS_PER_DAY;
}

describe("every S3.2 fixture matches its table row (T1 to T12)", () => {
  test.each(S3_2_FIXTURES.map((f) => [f.name, f] as const))(
    "%s: tier1 and tier2 match exactly",
    (_name, f: S3_2Fixture) => {
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
      const t2 = tier2 as Recommendation;
      const actual: Record<string, unknown> = {
        kind: t2.kind,
        confidence: t2.confidence,
        reason: t2.reason,
        buyThresholdPct: t2.signals.buyThresholdPct,
        waitThresholdPct: t2.signals.waitThresholdPct,
        bandPct: t2.signals.bandPct,
        wideningFactor: t2.signals.wideningFactor,
      };
      const pinned = Object.fromEntries(
        Object.keys(f.expected.tier2).map((k) => [k, actual[k]]),
      );
      expect(pinned).toEqual(f.expected.tier2);
    },
  );

  test("the fixture names are unique and s32FixtureNamed throws on an unknown one", () => {
    const names = S3_2_FIXTURES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    expect(() => named("nope")).toThrow(/no S3.2 fixture named nope/);
  });
});

describe("AC-1: widening flips the verdict (T1)", () => {
  test("VOL30: tier1 buy at −1200 bp; CV exactly 0.3, flat; tier2 fair, factor 2, band 10, −1667 / 1000 bp, the volatility clause", () => {
    const { tier1, tier2 } = tiersOf(named("VOL30"));
    expect(tier1.kind).toBe("buy");
    expect(tier1.confidence).toBe("high");
    expect(tier1.signals.deltaBp).toBe(-1200);
    expect(tier1.reason).toBe("12% below market.");
    expect(tier1.signals.volatility30d).toBe(0.3);
    expect(tier1.signals.trendDirection).toBe("flat");
    expect(Math.abs(tier1.signals.slope30dPct as number)).toBeLessThan(0.21);
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe("fair");
    expect(t2.confidence).toBe("high");
    expect(t2.signals.wideningFactor).toBe(2);
    expect(t2.signals.bandPct).toBe(10);
    expect(t2.signals.buyThresholdPct).toBe(-16.67);
    expect(t2.signals.waitThresholdPct).toBe(10);
    expect(thresholdsOf(t2)).toEqual([-1667, 1000]);
    expect(t2.reason).toBe("12% below market; price has been volatile (±30%).");
    expect(t2.signals.shockAnnotation).not.toBeNull();
  });

  test("VOL30-low-first: the same tier2 kind, factor and reason, flat", () => {
    const { tier1, tier2 } = tiersOf(named("VOL30-low-first"));
    expect(tier1.signals.trendDirection).toBe("flat");
    expect(tier2?.kind).toBe("fair");
    expect(tier2?.signals.wideningFactor).toBe(2);
    expect(tier2?.reason).toBe(
      "12% below market; price has been volatile (±30%).",
    );
  });

  test("CALM5 (CV exactly 0.05, the identical −1200 bp): tier2 buy, factor 1, band 5, no volatility clause, no shock", () => {
    const { tier1, tier2 } = tiersOf(named("CALM5"));
    expect(tier1.signals.deltaBp).toBe(-1200);
    expect(tier1.signals.volatility30d).toBe(0.05);
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe("buy");
    expect(t2.signals.wideningFactor).toBe(1);
    expect(t2.signals.bandPct).toBe(5);
    expect(thresholdsOf(t2)).toEqual([-833, 500]);
    expect(t2.reason).toBe("12% below market.");
    expect(t2.reason).not.toContain("volatile");
    expect(t2.signals.shockAnnotation).toBeNull();
  });
});

describe("AC-2: worked example D on Tier 2 (T2)", () => {
  test("D: wait, low, factor 1.5, band 7.5, volatility30d null, the thin-data caveat only", () => {
    const t2 = tier2Of(canonicalFixture("D"));
    expect(t2.kind).toBe("wait");
    expect(t2.confidence).toBe("low");
    expect(t2.signals.wideningFactor).toBe(1.5);
    expect(t2.signals.bandPct).toBe(7.5);
    expect(t2.signals.volatility30d).toBeNull();
    expect(t2.reason).toBe("19% above market; only 10 price snapshots.");
  });
});

describe("AC-3: staleness caps Tier 2's confidence at low (T3)", () => {
  test("STALE8-20 (newest row asOf − 8, −184 bp): tier1 fair, medium; tier2 fair, low, factor 1.5, −1250 / 750 bp, the stale clause", () => {
    const f = named("STALE8-20");
    expect(ageFromDates(f.market)).toBe(8);
    const { tier1, tier2 } = tiersOf(f);
    expect(tier1.signals.deltaBp).toBe(-184);
    expect(tier1.kind).toBe("fair");
    expect(tier1.confidence).toBe("medium");
    expect(tier1.reason).toBe("Within 2% of market.");
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe("fair");
    expect(t2.confidence).toBe("low");
    expect(t2.signals.wideningFactor).toBe(1.5);
    expect(t2.signals.bandPct).toBe(7.5);
    expect(thresholdsOf(t2)).toEqual([-1250, 750]);
    expect(t2.reason).toBe(
      "Within 2% of market; latest price data is 8 days old.",
    );
  });

  test("STALE7-20 (newest row asOf − 7): tier2 fair, medium, factor 1, band 5, no caveat", () => {
    const f = named("STALE7-20");
    expect(ageFromDates(f.market)).toBe(7);
    const t2 = tier2Of(f);
    expect(t2.kind).toBe("fair");
    expect(t2.confidence).toBe("medium");
    expect(t2.signals.wideningFactor).toBe(1);
    expect(t2.signals.bandPct).toBe(5);
    expect(t2.reason).toBe("Within 2% of market.");
  });

  test("STALE8-14: tier1 medium, tier2 low with STALE8-20's reason", () => {
    const { tier1, tier2 } = tiersOf(named("STALE8-14"));
    expect(tier1.confidence).toBe("medium");
    expect(tier2?.confidence).toBe("low");
    expect(tier2?.reason).toBe(
      "Within 2% of market; latest price data is 8 days old.",
    );
  });

  test("D-STALE15: the stale clause states 15 days", () => {
    const f = named("D-STALE15");
    expect(ageFromDates(f.market)).toBe(15);
    expect(tier2Of(f).reason).toBe(
      "19% above market; latest price data is 15 days old.",
    );
  });

  test("Tier 1's confidence never moves; staleDays comes from params", () => {
    const f = named("STALE8-20");
    expect(tiersOf(f).tier1.confidence).toBe("medium");
    const lenient = computeTieredRecommendation(f.input, f.market, {
      ...RECOMMENDATION_PARAMS,
      staleDays: 8,
    });
    expect(lenient.tier1.confidence).toBe("medium");
    expect(lenient.tier2?.confidence).toBe("medium");
    expect(lenient.tier2?.reason).toBe("Within 2% of market.");
  });

  test("a row dated asOf (outside the window) never makes a card fresh (S3.2d4)", () => {
    const f = named("STALE8-20");
    const market = {
      ...f.market,
      history: [...f.market.history, { date: f.market.asOf, priceCents: 8150 }],
    };
    expect(computeTieredRecommendation(f.input, market).tier2?.confidence).toBe(
      "low",
    );
  });

  test("latestAgeDays: windowDays − the newest index, null for no rows", () => {
    const rows = readWindow(
      named("STALE8-20").market.history,
      named("STALE8-20").market.asOf,
      RECOMMENDATION_PARAMS.windowDays,
    );
    expect(latestAgeDays(rows, RECOMMENDATION_PARAMS)).toBe(8);
    expect(latestAgeDays([], RECOMMENDATION_PARAMS)).toBeNull();
  });
});

describe("AC-5: CV 0 never widens (T6)", () => {
  test.each(["A", "B", "F", "G"])(
    "%s (flat): tier2 wideningFactor exactly 1, band 5, no volatility clause",
    (name) => {
      const f = canonicalFixture(name);
      const t2 = tier2Of(f);
      expect(t2.signals.volatility30d).toBe(0);
      expect(Object.is(t2.signals.wideningFactor, 1)).toBe(true);
      expect(t2.signals.bandPct).toBe(5);
      expect(t2.reason).not.toContain("volatile");
    },
  );

  test("volatilityWiden: null and 0 give 1; the clamp holds at both ends", () => {
    const p = RECOMMENDATION_PARAMS;
    expect(volatilityWiden(null, p)).toBe(1);
    expect(volatilityWiden(0, p)).toBe(1);
    expect(volatilityWiden(0.15, p)).toBe(1);
    expect(volatilityWiden(0.3, p)).toBe(2);
    expect(volatilityWiden(0.9, p)).toBe(2);
    expect(volatilityWiden(0.225, p)).toBeCloseTo(1.5, 12);
  });
});

describe("AC-7: the caveat slot, stale > thin-data > volatility (T8)", () => {
  test("D-STALE8: tier1 wait, low, thin-data; tier2 wait, low, factor 1.5, −1250 / 750 bp, stale outranks thin-data", () => {
    const { tier1, tier2 } = tiersOf(named("D-STALE8"));
    expect(tier1.kind).toBe("wait");
    expect(tier1.confidence).toBe("low");
    expect(tier1.reason).toBe("19% above market; only 10 price snapshots.");
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe("wait");
    expect(t2.confidence).toBe("low");
    expect(t2.signals.wideningFactor).toBe(1.5);
    expect(thresholdsOf(t2)).toEqual([-1250, 750]);
    expect(t2.reason).toBe(
      "19% above market; latest price data is 8 days old.",
    );
  });

  test("VOL30-STALE8: tier1 buy, medium; tier2 fair, low, factor 2 (1.97… × 1.5 capped), −1667 / 1000 bp, stale outranks volatility", () => {
    const { tier1, tier2 } = tiersOf(named("VOL30-STALE8"));
    expect(tier1.kind).toBe("buy");
    expect(tier1.confidence).toBe("medium");
    const cv = tier1.signals.volatility30d as number;
    expect(cv).toBeCloseTo(0.29586, 5);
    expect((cv / 0.15) * 1.5).toBeGreaterThan(2);
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe("fair");
    expect(t2.confidence).toBe("low");
    expect(t2.signals.wideningFactor).toBe(2);
    expect(thresholdsOf(t2)).toEqual([-1667, 1000]);
    expect(t2.reason).toBe(
      "12% below market; latest price data is 8 days old.",
    );
  });

  test("C-STALE8 (23 rows in the window): tier2 fair, low, factor 1.5, −2000 / 0 bp, the trend clause then the stale caveat", () => {
    const { tier1, tier2 } = tiersOf(named("C-STALE8"));
    expect(tier1.signals.snapshotCount30d).toBe(23);
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe("fair");
    expect(t2.confidence).toBe("low");
    expect(t2.signals.wideningFactor).toBe(1.5);
    expect(thresholdsOf(t2)).toEqual([-2000, 0]);
    expect(t2.reason).toBe(
      "9% below market; 30-day trend is falling 18%; latest price data is 8 days old.",
    );
  });

  test("M (re-pinned): the trend clause, then the volatility caveat", () => {
    const m = TIER2_FIXTURES.find((f) => f.name === "M") as Case;
    expect(tier2Of(m).reason).toBe(
      "5% below market; 30-day trend is rising 60%; price has been volatile (±17%).",
    );
  });

  test("thin-data and volatility never co-occur: under 14 rows volatility30d is null", () => {
    for (const f of [...TIER2_FIXTURES, ...TIER2_DATA_EDGE_FIXTURES]) {
      const { tier1 } = tiersOf(f);
      if (tier1.signals.snapshotCount30d < 14) {
        expect(tier1.signals.volatility30d, f.name).toBeNull();
      }
    }
  });

  /** Every case in the matrix: canonical, S3.1's, the data edges and S3.2's. */
  const MATRIX: readonly Case[] = [
    ...CANONICAL_FIXTURES,
    ...TIER2_FIXTURES,
    ...TIER2_DATA_EDGE_FIXTURES,
    ...S3_2_FIXTURES,
  ];

  const STALE = / latest price data is (\d+) days old\.$/;
  const THIN = / only (\d+) price snapshots\.$/;
  const VOLATILE = / price has been volatile \(±(\d+)%\)\.$/;

  test.each(MATRIX.map((f, i) => [`${i}:${f.name}`, f] as const))(
    "%s: primary, at most one trend clause, then the highest-precedence caveat only",
    (_name, f) => {
      const { tier1, tier2 } = tiersOf(f);
      if (tier2 === null) return;
      const clauses = tier2.reason.slice(0, -1).split("; ");
      expect(clauses.length).toBeLessThanOrEqual(3);
      const trendClauses = clauses.filter((c) => c.startsWith("30-day trend"));
      expect(trendClauses.length).toBeLessThanOrEqual(1);
      if (trendClauses.length === 1) expect(clauses[1]).toBe(trendClauses[0]);

      const age = ageFromDates(f.market) as number;
      const cv = tier1.signals.volatility30d;
      const caveats = [STALE, THIN, VOLATILE].filter((re) =>
        re.test(tier2.reason),
      );
      expect(caveats.length).toBeLessThanOrEqual(1);
      if (age > 7) {
        expect(tier2.reason).toMatch(STALE);
        expect(tier2.reason.match(STALE)?.[1]).toBe(String(age));
      } else if (tier2.confidence === "low") {
        expect(tier2.reason).toMatch(THIN);
        expect(tier2.reason.match(THIN)?.[1]).toBe(
          String(tier1.signals.snapshotCount30d),
        );
      } else if (cv !== null && cv / 0.15 > 1) {
        expect(tier2.reason).toMatch(VOLATILE);
        expect(tier2.reason.match(VOLATILE)?.[1]).toBe(
          String(Math.round(cv * 100)),
        );
      } else {
        expect(caveats).toEqual([]);
      }
      if (tier1.signals.snapshotCount30d < 14) {
        expect(tier2.reason).not.toMatch(VOLATILE);
      }
    },
  );
});

describe("AC-8: CV exactly 0.15 does not widen (T9)", () => {
  test("CV15: volatility30d 0.15, factor exactly 1, band 5, −833 / 500 bp, at market", () => {
    const { tier1, tier2 } = tiersOf(named("CV15"));
    expect(tier1.signals.volatility30d).toBe(0.15);
    const t2 = tier2 as Recommendation;
    expect(t2.signals.wideningFactor).toBe(1);
    expect(t2.signals.bandPct).toBe(5);
    expect(thresholdsOf(t2)).toEqual([-833, 500]);
    expect(t2.reason).toBe("At market price.");
  });
});

describe("AC-9: the widened boundary at adjacent cents (T10; C1.41 = A, C1.56)", () => {
  test.each([
    ["VOL30-90000-74993", -1667, "fair"],
    ["VOL30-90000-74992", -1668, "buy"],
  ] as const)("%s: deltaBp %i is tier2 %s", (name, deltaBp, kind) => {
    const { tier1, tier2 } = tiersOf(named(name));
    expect(tier1.signals.deltaBp).toBe(deltaBp);
    expect(tier1.kind).toBe("buy");
    expect(tier1.reason).toBe("17% below market.");
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe(kind);
    expect(t2.signals.wideningFactor).toBe(2);
    expect(t2.signals.trendDirection).toBe("flat");
    expect(bp(t2.signals.buyThresholdPct)).toBe(-1667);
    expect(t2.reason).toBe("17% below market; price has been volatile (±30%).");
  });
});

describe("S3.1d13 re-check: trendShiftFactor now takes effect (T11; S3.2d12)", () => {
  test("V-UNCLAMPED: CV ≈ 0.4425, slope ≈ 0.54203, factor 2, shift ≈ +8.1305 (inside ±10), −854 / 1813 bp", () => {
    const { tier1, tier2 } = tiersOf(named("V-UNCLAMPED"));
    expect(tier1.signals.volatility30d).toBeCloseTo(0.44247, 5);
    expect(tier1.signals.slope30dPct).toBeCloseTo(0.54203, 5);
    expect(tier1.signals.trendDirection).toBe("rising");
    const t2 = tier2 as Recommendation;
    expect(t2.kind).toBe("fair");
    expect(t2.confidence).toBe("high");
    expect(t2.signals.wideningFactor).toBe(2);
    expect(thresholdsOf(t2)).toEqual([-854, 1813]);
    const shift = (tier1.signals.slope30dPct as number) * 30 * 0.5;
    expect(shift).toBeCloseTo(8.1305, 4);
    expect(shift).toBeLessThan(t2.signals.bandPct);
    expect(t2.reason).toBe(
      "At market price; 30-day trend is rising 16%; price has been volatile (±44%).",
    );
  });

  test("trendShiftFactor 0.3 moves V-UNCLAMPED's thresholds to −1179 / 1488 bp", () => {
    const f = named("V-UNCLAMPED");
    const { tier2 } = computeTieredRecommendation(f.input, f.market, {
      ...RECOMMENDATION_PARAMS,
      trendShiftFactor: 0.3,
    });
    expect(thresholdsOf(tier2 as Recommendation)).toEqual([-1179, 1488]);
  });
});
