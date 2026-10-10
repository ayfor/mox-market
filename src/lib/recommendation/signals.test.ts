// T9–T15 (AC-7, AC-8; S1.2d8): F1's descriptive signals. Expected values come
// from an exact-rational reference (Python fractions, decimal for the square
// root), independent of the engine. Floats use toBeCloseTo(v, 12); integers
// and nulls use toBe.
import { describe, expect, test } from "vitest";
import { computeRecommendation } from "./engine";
import {
  CANONICAL_FIXTURES,
  canonicalFixture,
  fixtureInput,
  fixtureMarket,
  flat,
  ramp,
} from "./fixtures";
import { interpolatedSeries, slopePct } from "./signals";
import type {
  MarketSnapshot,
  Recommendation,
  RecommendationSignals,
} from "./types";

/** Window index i (0…29) is 2026-09-10 + i for asOf 2026-10-10. */
const dateAt = (index: number) =>
  new Date(Date.UTC(2026, 8, 10 + index)).toISOString().slice(0, 10);

/** A market whose history holds price p on window index i for each [i, p]. */
function marketAt(
  currentPriceCents: number,
  points: ReadonlyArray<readonly [number, number]>,
): MarketSnapshot {
  return {
    ...fixtureMarket(currentPriceCents, []),
    history: points.map(([i, priceCents]) => ({ date: dateAt(i), priceCents })),
  };
}

const RISING = ramp(30, 7304, 48);
const FIXTURE_S = [
  8150, 8020, 8310, 7990, 8100, 8240, 7870, 8060, 8180, 7950, 8400, 8010, 8120,
  7780, 8290, 8050, 7930, 8210, 8070, 8330, 7900, 8160, 8040, 8260, 7820, 8190,
  8090, 7960, 8270, 8130,
];

const NUMERIC_KEYS = [
  "deltaPct",
  "deltaBp",
  "marketPriceCents",
  "median30dCents",
  "rangePosition",
  "slope7dPct",
  "slope30dPct",
  "volatility30d",
  "snapshotCount30d",
  "bandPct",
  "wideningFactor",
  "buyThresholdPct",
  "waitThresholdPct",
] as const satisfies ReadonlyArray<keyof RecommendationSignals>;

/** Every numeric signal, the range's three fields included. */
function numericSignals(s: RecommendationSignals): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const key of NUMERIC_KEYS) {
    const v = s[key];
    if (typeof v === "number") out.push([key, v]);
  }
  if (s.range30dCents) {
    for (const [k, v] of Object.entries(s.range30dCents)) {
      out.push([`range30dCents.${k}`, v]);
    }
  }
  return out;
}

const seen: Recommendation[] = [];
const run = (asking: number, market: MarketSnapshot) => {
  const r = computeRecommendation(fixtureInput(asking), market);
  seen.push(r);
  return r;
};

describe("A-rising (T9, AC-7)", () => {
  test("every signal is exact", () => {
    const s = run(7600, fixtureMarket(8000, RISING)).signals;
    expect(s.median30dCents).toBe(7976);
    expect(s.range30dCents).toEqual({ low: 7304, high: 8696, avg: 8000 });
    expect(s.rangePosition).toBeCloseTo(37 / 174, 12);
    expect(s.slope30dPct).toBeCloseTo(0.6, 12);
    expect(s.slope7dPct).toBeCloseTo(600 / 1069, 12);
    expect(s.slope7dPct).toBeCloseTo(0.56127221702525, 12);
    expect(s.volatility30d).toBeCloseTo(0.05193264869039514, 12);
    expect(s.trendDirection).toBe("rising");
    expect(s.snapshotCount30d).toBe(30);
  });
});

describe("fixture S, non-linear (T10, AC-7)", () => {
  test("every signal is exact, and OLS differs from an endpoint slope", () => {
    const r = run(8000, fixtureMarket(8150, FIXTURE_S));
    const s = r.signals;
    expect(s.median30dCents).toBe(8090);
    expect(s.range30dCents).toEqual({ low: 7780, high: 8400, avg: 8096 });
    expect(s.rangePosition).toBeCloseTo(11 / 31, 12);
    expect(s.slope30dPct).toBeCloseTo(-250 / 227447, 12);
    expect(s.slope30dPct).toBeCloseTo(-0.00109915716628489, 12);
    expect(s.slope7dPct).toBeCloseTo(175 / 1418, 12);
    expect(s.slope7dPct).toBeCloseTo(0.1234132581100141, 12);
    expect(s.volatility30d).toBeCloseTo(0.019011576944286428, 12);
    expect(s.trendDirection).toBe("flat");
    expect(r.kind).toBe("fair");
    expect(r.confidence).toBe("high");
    expect(r.reason).toBe("Within 2% of market.");
  });
});

describe("flat histories (T11, AC-7)", () => {
  test.each(["A", "B", "G"])(
    "%s: zero-width range, zero slopes and volatility",
    (name) => {
      const f = canonicalFixture(name);
      const r = computeRecommendation(f.input, f.market);
      seen.push(r);
      const s = r.signals;
      expect(s.rangePosition).toBeNull();
      expect(s.median30dCents).toBe(8150);
      expect(s.range30dCents).toEqual({ low: 8150, high: 8150, avg: 8150 });
      expect(Object.is(s.slope30dPct, 0)).toBe(true);
      expect(Object.is(s.slope7dPct, 0)).toBe(true);
      expect(Object.is(s.volatility30d, 0)).toBe(true);
      expect(s.trendDirection).toBe("flat");
      expect(s.snapshotCount30d).toBe(name === "G" ? 20 : 30);
    },
  );
});

describe("C, falling (T12, AC-7; C1.10 = A)", () => {
  test("every signal is exact; buy, high", () => {
    const r = run(7400, fixtureMarket(8150, ramp(30, 8696, -48)));
    const s = r.signals;
    expect(s.slope30dPct).toBeCloseTo(-0.6, 12);
    expect(s.slope7dPct).toBeCloseTo(-600 / 931, 12);
    expect(s.trendDirection).toBe("falling");
    expect(s.median30dCents).toBe(7976);
    expect(s.range30dCents).toEqual({ low: 7304, high: 8696, avg: 8000 });
    expect(s.rangePosition).toBeCloseTo(2 / 29, 12);
    expect(s.volatility30d).toBeCloseTo(0.05193264869039514, 12);
    expect(r.kind).toBe("buy");
    expect(r.confidence).toBe("high");
    expect(r.reason).toBe("9% below market.");
  });
});

describe("minimums (T13, AC-7)", () => {
  test("6 window snapshots: every history signal is null", () => {
    const s = run(8000, fixtureMarket(8000, ramp(6, 7900, 40))).signals;
    expect(s.snapshotCount30d).toBe(6);
    expect(s.median30dCents).toBeNull();
    expect(s.range30dCents).toBeNull();
    expect(s.rangePosition).toBeNull();
    expect(s.volatility30d).toBeNull();
    expect(s.slope30dPct).toBeNull();
    expect(s.slope7dPct).toBeNull();
    expect(s.trendDirection).toBeNull();
  });

  test.each([7, 13])(
    "%i snapshots: slopes and trend set; median, range, position and volatility null",
    (n) => {
      const s = run(8000, fixtureMarket(8000, ramp(n, 7900, 40))).signals;
      expect(s.snapshotCount30d).toBe(n);
      expect(s.slope30dPct).not.toBeNull();
      expect(s.slope7dPct).not.toBeNull();
      expect(s.trendDirection).not.toBeNull();
      expect(s.median30dCents).toBeNull();
      expect(s.range30dCents).toBeNull();
      expect(s.rangePosition).toBeNull();
      expect(s.volatility30d).toBeNull();
    },
  );

  test("14 snapshots: every signal is set", () => {
    const s = run(8000, fixtureMarket(8000, ramp(14, 7740, 40))).signals;
    expect(s.snapshotCount30d).toBe(14);
    for (const key of [
      "median30dCents",
      "range30dCents",
      "rangePosition",
      "volatility30d",
      "slope30dPct",
      "slope7dPct",
      "trendDirection",
    ] as const) {
      expect(s[key]).not.toBeNull();
    }
  });

  test("thirteen 8000s and one 8007: range avg 8001 (mean 8000.5, Math.round)", () => {
    const s = run(8000, fixtureMarket(8000, [...flat(13, 8000), 8007])).signals;
    expect(s.range30dCents).toEqual({ low: 8000, high: 8007, avg: 8001 });
    expect(s.median30dCents).toBe(8000);
  });

  test("asking below the range low gives 0, above the high gives 1", () => {
    expect(run(1, fixtureMarket(8000, RISING)).signals.rangePosition).toBe(0);
    expect(run(7304, fixtureMarket(8000, RISING)).signals.rangePosition).toBe(
      0,
    );
    expect(run(8696, fixtureMarket(8000, RISING)).signals.rangePosition).toBe(
      1,
    );
    expect(run(99999, fixtureMarket(8000, RISING)).signals.rangePosition).toBe(
      1,
    );
  });
});

describe("trend label (T14, AC-7; C1.10 = A, strict)", () => {
  test.each([
    ["+40/day", ramp(30, 7420, 40), 0.5, "flat"],
    ["+48/day", ramp(30, 7304, 48), 0.6, "rising"],
    ["−40/day", ramp(30, 8580, -40), -0.5, "flat"],
    ["−48/day", ramp(30, 8696, -48), -0.6, "falling"],
  ] as const)("%s → slope %d, %s", (_label, values, slope, direction) => {
    const s = run(8000, fixtureMarket(8000, values)).signals;
    if (Math.abs(slope) === 0.5) expect(s.slope30dPct).toBe(slope);
    else expect(s.slope30dPct).toBeCloseTo(slope, 12);
    expect(s.trendDirection).toBe(direction);
  });
});

describe("gaps (T15, AC-8; S1.2d8)", () => {
  test("GAP: interpolated for slope only; median, range and volatility from real rows", () => {
    const points = RISING.flatMap((p, i) =>
      i >= 3 && i <= 12 ? [] : [[i, p] as const],
    );
    expect(points).toHaveLength(20);
    const r = run(7600, marketAt(8000, points));
    const s = r.signals;
    expect(s.snapshotCount30d).toBe(20);
    expect(r.confidence).toBe("medium");
    expect(s.median30dCents).toBe(8216);
    expect(s.range30dCents).toEqual({ low: 7304, high: 8696, avg: 8168 });
    expect(s.volatility30d).toBeCloseTo(0.0496910906717564, 12);
    expect(s.slope30dPct).toBeCloseTo(0.6, 12);
    expect(s.slope30dPct).not.toBeCloseTo(0.58766, 4);
    expect(s.slope7dPct).toBeCloseTo(600 / 1069, 12);
  });

  test("BIGGAP: a 23-day gap still gives the ramp's slope; range-family signals null", () => {
    const points = [0, 24, 25, 26, 27, 28, 29].map(
      (i) => [i, RISING[i]] as const,
    );
    const s = run(7600, marketAt(8000, points)).signals;
    expect(s.snapshotCount30d).toBe(7);
    expect(s.slope30dPct).toBeCloseTo(0.6, 12);
    expect(s.slope30dPct).not.toBeCloseTo(0.57182, 4);
    expect(s.slope7dPct).toBeCloseTo(600 / 1069, 12);
    expect(s.median30dCents).toBeNull();
    expect(s.range30dCents).toBeNull();
    expect(s.rangePosition).toBeNull();
    expect(s.volatility30d).toBeNull();
  });

  test("NONLIN: interpolated OLS, not a real-row OLS", () => {
    const points = [
      ...[0, 1, 2, 3, 4, 5].map((i) => [i, 8000] as const),
      [29, 8290] as const,
    ];
    const s = run(8000, marketAt(8000, points)).signals;
    expect(s.slope30dPct).toBeCloseTo(8200 / 60419, 12);
    expect(s.slope30dPct).toBeCloseTo(0.1357188963736573, 12);
    expect(s.slope30dPct).not.toBeCloseTo(0.13224, 4);
    expect(s.slope7dPct).toBeCloseTo(2900 / 19809, 12);
    expect(s.trendDirection).toBe("flat");
  });

  test("LEAD: no extrapolation past the last real row; slope7dPct null", () => {
    const points = RISING.slice(0, 10).map((p, i) => [i, p] as const);
    const s = run(7600, marketAt(8000, points)).signals;
    expect(s.snapshotCount30d).toBe(10);
    expect(s.slope30dPct).toBeCloseTo(30 / 47, 12);
    expect(s.slope7dPct).toBeNull();
    expect(s.trendDirection).toBe("rising");
  });

  test("a trailing gap is not extrapolated either", () => {
    const points = RISING.slice(20).map((p, i) => [i + 20, p] as const);
    const series = interpolatedSeries(
      points.map(([index, priceCents]) => ({
        index,
        date: dateAt(index),
        priceCents,
      })),
    );
    expect(series.map((p) => p.x)).toEqual([
      20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    ]);
  });

  test("interpolation fills each gap linearly, between its real neighbours", () => {
    const series = interpolatedSeries([
      { index: 2, date: dateAt(2), priceCents: 100 },
      { index: 5, date: dateAt(5), priceCents: 400 },
      { index: 6, date: dateAt(6), priceCents: 50 },
    ]);
    expect(series).toEqual([
      { x: 2, y: 100 },
      { x: 3, y: 200 },
      { x: 4, y: 300 },
      { x: 5, y: 400 },
      { x: 6, y: 50 },
    ]);
  });

  test("slopePct needs two points", () => {
    expect(slopePct([])).toBeNull();
    expect(slopePct([{ x: 3, y: 100 }])).toBeNull();
    expect(
      slopePct([
        { x: 0, y: 100 },
        { x: 1, y: 101 },
      ]),
    ).toBeCloseTo(100 / 100.5, 12);
  });
});

describe("no −0 (T13)", () => {
  test("no numeric signal on any fixture in this file or T1 is −0", () => {
    const all = [
      ...seen,
      ...CANONICAL_FIXTURES.map((f) =>
        computeRecommendation(f.input, f.market),
      ),
    ];
    expect(all.length).toBeGreaterThan(CANONICAL_FIXTURES.length);
    for (const r of all) {
      for (const [key, value] of numericSignals(r.signals)) {
        expect(Object.is(value, -0), key).toBe(false);
      }
    }
  });
});
