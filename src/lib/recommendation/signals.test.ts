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
import { RECOMMENDATION_PARAMS } from "./params";
import {
  exactSlopePct,
  interpolatedSeries,
  type SeriesPoint,
  slopePct,
} from "./signals";
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

/** A real-row series point (den 1). */
const real = (x: number, y: number): SeriesPoint => ({
  x,
  num: BigInt(y),
  den: BigInt(1),
});

/** A seeded linear congruential generator, so sweeps are reproducible. */
function seeded(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return Math.floor((state / 2147483648) * below);
  };
}
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
      real(2, 100),
      { x: 3, num: BigInt(600), den: BigInt(3) },
      { x: 4, num: BigInt(900), den: BigInt(3) },
      real(5, 400),
      real(6, 50),
    ]);
    expect(series.map((p) => Number(p.num) / Number(p.den))).toEqual([
      100, 200, 300, 400, 50,
    ]);
  });

  test("an interpolated point that is not a whole cent stays exact (no float rounding)", () => {
    const series = interpolatedSeries([
      { index: 0, date: dateAt(0), priceCents: 100 },
      { index: 3, date: dateAt(3), priceCents: 101 },
    ]);
    expect(series[1]).toEqual({ x: 1, num: BigInt(301), den: BigInt(3) });
    expect(series[2]).toEqual({ x: 2, num: BigInt(302), den: BigInt(3) });
  });

  test("slopePct needs two points", () => {
    expect(slopePct([])).toBeNull();
    expect(slopePct([real(3, 100)])).toBeNull();
    expect(exactSlopePct([real(3, 100)])).toBeNull();
    expect(slopePct([real(0, 100), real(1, 101)])).toBeCloseTo(100 / 100.5, 12);
    expect(exactSlopePct([real(0, 100), real(1, 101)])).toEqual({
      num: BigInt(200),
      den: BigInt(201),
    });
  });

  test("prices beyond 2^53 / 30 keep an exact slope (BigInt sums)", () => {
    const big = Number.MAX_SAFE_INTEGER - 29;
    const points = Array.from({ length: 30 }, (_, i) => real(i, big + i));
    const exact = exactSlopePct(points);
    expect(exact).not.toBeNull();
    expect(exact && exact.num > BigInt(0)).toBe(true);
    expect(slopePct(points)).toBeGreaterThan(0);
  });
});

describe("slope7dPct needs two series points in the last 7 dates (ADV-8)", () => {
  test("real rows 0–5 and 23: one point in the last 7 dates, so slope7dPct is null", () => {
    const points = [0, 1, 2, 3, 4, 5, 23].map((i) => [i, RISING[i]] as const);
    const s = run(7600, marketAt(8000, points)).signals;
    expect(s.snapshotCount30d).toBe(7);
    expect(s.slope7dPct).toBeNull();
    expect(s.slope30dPct).toBeCloseTo(4800 / 7856, 12);
    expect(s.trendDirection).toBe("rising");
  });

  test("real rows 0–5 and 24: an interpolated day 23 and a real day 24 give a 2-point slope", () => {
    const points = [0, 1, 2, 3, 4, 5, 24].map((i) => [i, RISING[i]] as const);
    const s = run(7600, marketAt(8000, points)).signals;
    expect(s.snapshotCount30d).toBe(7);
    // 48 c/day over the mean of 8408 (interpolated) and 8456: 4800 / 8432.
    expect(s.slope7dPct).toBeCloseTo(300 / 527, 12);
    expect(s.slope7dPct).toBeCloseTo(0.5692599620493358, 12);
    expect(s.trendDirection).toBe("rising");
  });
});

describe("the trend label at exactly ±trendThresholdPct (ADV-1; C1.10 = A)", () => {
  // Non-linear integer histories whose exact slope30dPct is +0.5: Σy and
  // Σxy are fixed by the constraint Σy·(12000x − 178495) = 0. A float OLS
  // gave 0.5000000000000001 (rising) on this one.
  const PLUS_HALF = [
    5728, 3855, 7497, 8253, 7633, 8421, 8304, 8909, 7508, 8022, 8499, 8109,
    7747, 8733, 8698, 7342, 7871, 8001, 7802, 8442, 7325, 7367, 7852, 8743,
    7365, 8744, 7555, 8916, 7936, 8023,
  ];
  // Its mirror satisfies Σy·(12000x − 169505) = 0, so it is exactly −0.5; a
  // float OLS gave −0.5000000000000001 (falling).
  const MINUS_HALF = [...PLUS_HALF].reverse();

  const weighted = (values: readonly number[], offset: number) =>
    values.reduce((t, y, x) => t + y * (12000 * x - offset), 0);

  test("the fixtures sit exactly on the boundary", () => {
    expect(weighted(PLUS_HALF, 178495)).toBe(0);
    expect(weighted(MINUS_HALF, 169505)).toBe(0);
    const pts = (v: readonly number[]) => v.map((y, x) => real(x, y));
    expect(exactSlopePct(pts(PLUS_HALF))).toEqual({
      num: BigInt(1),
      den: BigInt(2),
    });
    expect(exactSlopePct(pts(MINUS_HALF))).toEqual({
      num: BigInt(-1),
      den: BigInt(2),
    });
  });

  test.each([
    ["+0.5", PLUS_HALF, 0.5],
    ["−0.5", MINUS_HALF, -0.5],
  ] as const)(
    "exact %s is flat, and slope30dPct is exactly %s",
    (_l, values, slope) => {
      const s = run(8000, fixtureMarket(8000, values)).signals;
      expect(s.slope30dPct).toBe(slope);
      expect(s.trendDirection).toBe("flat");
    },
  );

  test("one cent past the boundary on the newest day turns the label", () => {
    const up = [...PLUS_HALF.slice(0, 29), PLUS_HALF[29] + 1];
    const down = [...MINUS_HALF.slice(0, 29), MINUS_HALF[29] - 1];
    expect(run(8000, fixtureMarket(8000, up)).signals.trendDirection).toBe(
      "rising",
    );
    expect(run(8000, fixtureMarket(8000, down)).signals.trendDirection).toBe(
      "falling",
    );
  });

  test("300 non-linear histories exactly on ±0.5, with and without gaps, are all flat", () => {
    // A ±40 c/day ramp around 8000 is exactly ±0.5. Adding (+a, −a, −a, +a)
    // at x = i, i + 1, j, j + 1 keeps Σy and Σxy, so the slope stays exact.
    // Every other history drops the rows inside one gap whose ends stay on
    // the ramp, so the interpolated points (den > 1) are the ramp's values.
    const next = seeded(20261010);
    for (let t = 0; t < 300; t += 1) {
      const sign = t % 2 === 0 ? 1 : -1;
      const values = ramp(30, 8000 - sign * 580, sign * 40);
      const gapStart = next(20);
      const gapEnd = t % 4 < 2 ? gapStart : gapStart + 3 + next(5);
      const free = (x: number) => x < gapStart || x > gapEnd;
      for (let m = 0; m < 6; m += 1) {
        const i = next(29);
        const j = next(29);
        if (![i, i + 1, j, j + 1].every(free)) continue;
        const a = next(400);
        values[i] += a;
        values[i + 1] -= a;
        values[j] -= a;
        values[j + 1] += a;
      }
      const points = values.flatMap((y, x) =>
        x > gapStart && x < gapEnd ? [] : [[x, y] as const],
      );
      const s = run(8000, marketAt(8000, points)).signals;
      const label = `${points.length} rows: ${values.join(",")}`;
      expect(s.slope30dPct, label).toBe(sign * 0.5);
      expect(s.trendDirection, label).toBe("flat");
    }
  });

  test("the exact slope matches an independent centred-sum reference on 300 gappy histories", () => {
    // Reference: Σ(x − x̄)(y − ȳ) / Σ(x − x̄)² × 100 / ȳ in BigInt fractions.
    type Q = readonly [bigint, bigint];
    const g = (a: bigint, b: bigint): bigint =>
      b === BigInt(0) ? a : g(b, a % b);
    const norm = ([n, d]: Q): Q => {
      const k = g(n < BigInt(0) ? -n : n, d < BigInt(0) ? -d : d);
      const sgn = d < BigInt(0) ? BigInt(-1) : BigInt(1);
      return [(sgn * n) / k, (sgn * d) / k];
    };
    const add = (a: Q, b: Q): Q =>
      norm([a[0] * b[1] + b[0] * a[1], a[1] * b[1]]);
    const mul = (a: Q, b: Q): Q => norm([a[0] * b[0], a[1] * b[1]]);
    const div = (a: Q, b: Q): Q => norm([a[0] * b[1], a[1] * b[0]]);
    const neg = (a: Q): Q => [-a[0], a[1]];
    const q = (n: number | bigint, d: number | bigint = 1): Q =>
      norm([BigInt(n), BigInt(d)]);

    const next = seeded(7);
    for (let t = 0; t < 300; t += 1) {
      const rows = Array.from({ length: 30 }, (_, x) => x).filter(
        () => next(3) > 0,
      );
      if (rows.length < 7) continue;
      const pts = rows.map((x) => [x, 1 + next(20000)] as const);
      const series = interpolatedSeries(
        pts.map(([index, priceCents]) => ({
          index,
          date: dateAt(index),
          priceCents,
        })),
      );
      const ys = series.map((p) => q(p.num, p.den));
      const n = q(series.length);
      const xBar = div(
        series.reduce((a, p) => add(a, q(p.x)), q(0)),
        n,
      );
      const yBar = div(
        ys.reduce((a, y) => add(a, y), q(0)),
        n,
      );
      let sxy = q(0);
      let sxx = q(0);
      series.forEach((p, i) => {
        const dx = add(q(p.x), neg(xBar));
        sxy = add(sxy, mul(dx, add(ys[i], neg(yBar))));
        sxx = add(sxx, mul(dx, dx));
      });
      const reference = div(mul(div(sxy, sxx), q(100)), yBar);
      const exact = exactSlopePct(series);
      expect(exact && [exact.num, exact.den]).toEqual(reference);
      const s = run(8000, marketAt(8000, pts)).signals;
      expect(s.slope30dPct).toBe(
        reference[0] === BigInt(0)
          ? 0
          : Number(reference[0]) / Number(reference[1]),
      );
    }
  });

  test("the threshold is compared in whole bp per day, as C1.41 = A rounds the bands", () => {
    const market = fixtureMarket(8000, PLUS_HALF);
    const at = (trendThresholdPct: number) =>
      computeRecommendation(fixtureInput(8000), market, {
        ...RECOMMENDATION_PARAMS,
        trendThresholdPct,
      }).signals.trendDirection;
    expect(at(0.5)).toBe("flat");
    expect(at(0.49)).toBe("rising");
    expect(at(0.501)).toBe("flat"); // rounds to 50 bp
  });
});

describe("an exactly zero slope is +0, not a float residue (ADV-2)", () => {
  const PALINDROME = [
    8439, 8172, 7860, 8888, 7538, 8129, 8528, 7611, 7818, 7063, 8162, 8805,
    8801, 7963, 7680, 7680, 7963, 8801, 8805, 8162, 7063, 7818, 7611, 8528,
    8129, 7538, 8888, 7860, 8172, 8439,
  ];

  test("the reviewer's palindrome: slope30dPct is +0 and flat", () => {
    expect(PALINDROME).toEqual([...PALINDROME].reverse());
    const s = run(8000, fixtureMarket(8000, PALINDROME)).signals;
    expect(Object.is(s.slope30dPct, 0)).toBe(true);
    expect(s.trendDirection).toBe("flat");
  });

  test("500 random palindromes all give slope30dPct +0", () => {
    const next = seeded(42);
    for (let t = 0; t < 500; t += 1) {
      const half = Array.from({ length: 15 }, () => 7000 + next(2000));
      const values = [...half, ...[...half].reverse()];
      const s = run(8000, fixtureMarket(8000, values)).signals;
      expect(Object.is(s.slope30dPct, 0), values.join(",")).toBe(true);
    }
  });
});

describe("no −0 and no float residue (T13, ADV-2)", () => {
  test("no numeric signal on any fixture in this file or T1 is −0 or a nonzero value under 1e-12", () => {
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
        expect(value !== 0 && Math.abs(value) < 1e-12, `${key} ${value}`).toBe(
          false,
        );
      }
    }
  });
});
