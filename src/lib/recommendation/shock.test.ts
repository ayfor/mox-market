// S3.2 T4 (AC-4; S3.2d6, S3.2d7): F3's shock annotation. latest = the newest
// real window row; ref = the newest real window row at least
// shockWindowDays before latest; |move| ≥ shockMagnitudePct annotates and
// never changes the verdict. Expected values were computed independently of
// the engine (plan Test Manifest).
import { describe, expect, test } from "vitest";
import { computeTieredRecommendation, servedRecommendation } from "./engine";
import {
  canonicalFixture,
  FIXTURE_AS_OF,
  fixtureInput,
  fixtureMarket,
  flat,
  historyEndingAt,
  ramp,
  s32FixtureNamed,
  S3_2_FIXTURES,
  TIER2_DATA_EDGE_FIXTURES,
  type S3_2Fixture,
  type Tier2Fixture,
} from "./fixtures";
import { RECOMMENDATION_PARAMS } from "./params";
import { decimalRatio, shockAnnotationOf } from "./shock";
import type { Recommendation } from "./types";
import { readWindow } from "./window";

const tiersOf = (f: Pick<S3_2Fixture, "input" | "market">) =>
  computeTieredRecommendation(f.input, f.market);

/** One S3.1 data-edge fixture by name (S3.1 adversarial review). */
function dataEdge(name: string): Tier2Fixture {
  const found = TIER2_DATA_EDGE_FIXTURES.find((d) => d.name === name);
  if (!found) throw new Error(`no data-edge fixture named ${name}`);
  return found;
}

/** The window rows the engine reads for a fixture's market. */
const windowOf = (f: Pick<S3_2Fixture, "market">) =>
  readWindow(f.market.history, f.market.asOf, RECOMMENDATION_PARAMS.windowDays);

describe("shockAnnotationOf on the window rows (S3.2d6)", () => {
  test("SHOCK45: latest 14500 at asOf − 1, ref 10000 at asOf − 8, exactly +45", () => {
    const rows = windowOf(s32FixtureNamed("SHOCK45"));
    expect(rows.at(-1)).toMatchObject({
      date: "2026-10-09",
      priceCents: 14500,
    });
    expect(rows.find((r) => r.date === "2026-10-02")?.priceCents).toBe(10000);
    expect(shockAnnotationOf(rows, RECOMMENDATION_PARAMS)).toStrictEqual({
      detected: true,
      magnitude: 45,
      window: 7,
    });
  });

  test.each([
    ["SHOCK35", 35],
    ["SHOCK34.99", null],
    ["SHOCK-35", -35],
    ["SHOCK-34.99", null],
  ] as const)(
    "%s: the boundary is inclusive and exact (magnitude %s)",
    (name, magnitude) => {
      const shock = shockAnnotationOf(
        windowOf(s32FixtureNamed(name)),
        RECOMMENDATION_PARAMS,
      );
      if (magnitude === null) {
        expect(shock).toBeNull();
      } else {
        expect(shock).toStrictEqual({ detected: true, magnitude, window: 7 });
        expect(shock?.magnitude).toBe(magnitude);
      }
    },
  );

  test("SHOCK45-GAP: no rows on asOf − 9 and − 8, so ref is asOf − 10; magnitude 45", () => {
    const rows = windowOf(s32FixtureNamed("SHOCK45-GAP"));
    expect(rows.map((r) => r.date)).not.toContain("2026-10-01");
    expect(rows.map((r) => r.date)).not.toContain("2026-10-02");
    expect(rows.map((r) => r.date)).toContain("2026-09-30");
    expect(shockAnnotationOf(rows, RECOMMENDATION_PARAMS)).toStrictEqual({
      detected: true,
      magnitude: 45,
      window: 7,
    });
  });

  test("crash-ramp-7: seven rows inside the last 7 days have no ref, so no annotation (−90%)", () => {
    const f = dataEdge("crash-ramp-7");
    const rows = windowOf(f);
    expect(rows).toHaveLength(7);
    expect(rows[0].priceCents).toBe(5000);
    expect(rows.at(-1)?.priceCents).toBe(500);
    expect(shockAnnotationOf(rows, RECOMMENDATION_PARAMS)).toBeNull();
    expect(tiersOf(f).tier1.signals.shockAnnotation).toBeNull();
  });

  test("an empty window has no annotation", () => {
    expect(shockAnnotationOf([], RECOMMENDATION_PARAMS)).toBeNull();
  });

  test("ref is the newest row at least shockWindowDays before latest, not the oldest", () => {
    // 10000 at asOf − 30, 12000 at asOf − 9, 14500 at asOf − 1: ref is
    // asOf − 9 (index 21 ≤ 29 − 7), a +20.8% move, so no annotation.
    const rows = readWindow(
      [
        ...historyEndingAt([10000], 30),
        ...historyEndingAt([12000], 9),
        ...historyEndingAt([14500], 1),
      ],
      FIXTURE_AS_OF,
      RECOMMENDATION_PARAMS.windowDays,
    );
    expect(shockAnnotationOf(rows, RECOMMENDATION_PARAMS)).toBeNull();
  });

  test("the latest is the newest real row, even when it is days before asOf − 1", () => {
    // VOL30-STALE8 ends at asOf − 8: latest 10595 (index 22), ref 5705 (15).
    const shock = shockAnnotationOf(
      windowOf(s32FixtureNamed("VOL30-STALE8")),
      RECOMMENDATION_PARAMS,
    );
    expect(shock?.magnitude).toBe(((10595 - 5705) * 100) / 5705);
  });

  test("window is shockWindowDays on every annotated fixture", () => {
    for (const f of S3_2_FIXTURES) {
      const shock = shockAnnotationOf(windowOf(f), RECOMMENDATION_PARAMS);
      if (shock === null) continue;
      expect(shock.window).toBe(RECOMMENDATION_PARAMS.shockWindowDays);
    }
  });

  // ADV TC-1: an annotation needs |move| ≥ 35%, so no default-params case
  // reaches 0. With shockMagnitudePct 0 a flat week annotates, and the
  // magnitude is exactly +0 (integer cents never give −0).
  test("a zero move under shockMagnitudePct 0 has magnitude exactly +0", () => {
    const rows = windowOf(canonicalFixture("B"));
    const shock = shockAnnotationOf(rows, {
      ...RECOMMENDATION_PARAMS,
      shockMagnitudePct: 0,
    });
    expect(shock).not.toBeNull();
    expect(Object.is(shock?.magnitude, 0)).toBe(true);
    expect(shock?.window).toBe(RECOMMENDATION_PARAMS.shockWindowDays);
  });

  // Codex P2 on PR #21: the threshold is compared at its configured
  // precision, not rounded to hundredths (35.005 once became 35.01).
  test("shockMagnitudePct 35.005 is applied exactly, not rounded to 35.01", () => {
    const params = { ...RECOMMENDATION_PARAMS, shockMagnitudePct: 35.005 };
    const rowsEnding = (latest: number) =>
      readWindow(
        [
          ...historyEndingAt([1000000], 8),
          ...historyEndingAt(flat(7, latest), 1),
        ],
        FIXTURE_AS_OF,
        RECOMMENDATION_PARAMS.windowDays,
      );
    expect(shockAnnotationOf(rowsEnding(1350050), params)).toStrictEqual({
      detected: true,
      magnitude: 35.005,
      window: 7,
    });
    expect(shockAnnotationOf(rowsEnding(1350049), params)).toBeNull();
    expect(shockAnnotationOf(rowsEnding(649950), params)).toStrictEqual({
      detected: true,
      magnitude: -35.005,
      window: 7,
    });
    expect(shockAnnotationOf(rowsEnding(649951), params)).toBeNull();
  });

  test("a threshold in exponent form (1e-7) is applied exactly, not rounded to 0", () => {
    const params = { ...RECOMMENDATION_PARAMS, shockMagnitudePct: 1e-7 };
    const rowsEnding = (latest: number) =>
      readWindow(
        [
          ...historyEndingAt([1000000000], 8),
          ...historyEndingAt(flat(7, latest), 1),
        ],
        FIXTURE_AS_OF,
        RECOMMENDATION_PARAMS.windowDays,
      );
    expect(shockAnnotationOf(rowsEnding(1000000001), params)).not.toBeNull();
    expect(shockAnnotationOf(rowsEnding(1000000000), params)).toBeNull();
  });

  test.each([
    [35, BigInt(35), BigInt(1)],
    [35.005, BigInt(35005), BigInt(1000)],
    [0.1, BigInt(1), BigInt(10)],
    [1e-7, BigInt(1), BigInt(10000000)],
    [1e21, BigInt(`1${"0".repeat(21)}`), BigInt(1)],
    [0, BigInt(0), BigInt(1)],
  ] as const)("decimalRatio(%s) is %s / %s", (x, num, den) => {
    expect(decimalRatio(x)).toStrictEqual({ num, den });
  });

  test("shockWindowDays and shockMagnitudePct come from params", () => {
    const rows = windowOf(s32FixtureNamed("SHOCK45"));
    expect(
      shockAnnotationOf(rows, {
        ...RECOMMENDATION_PARAMS,
        shockMagnitudePct: 46,
      }),
    ).toBeNull();
    // A 3-day window compares asOf − 1 with asOf − 4: both 14500.
    expect(
      shockAnnotationOf(rows, { ...RECOMMENDATION_PARAMS, shockWindowDays: 3 }),
    ).toBeNull();
    expect(
      shockAnnotationOf(rows, { ...RECOMMENDATION_PARAMS, shockWindowDays: 8 }),
    ).toStrictEqual({ detected: true, magnitude: 45, window: 8 });
  });
});

describe("the annotation through the engine (T4, AC-4)", () => {
  test("SHOCK45: the same annotation on tier1, tier2 and the served result; the verdict is the non-shock one", () => {
    const tiers = tiersOf(s32FixtureNamed("SHOCK45"));
    const expected = { detected: true, magnitude: 45, window: 7 };
    expect(tiers.tier1.signals.shockAnnotation).toStrictEqual(expected);
    expect(tiers.tier2?.signals.shockAnnotation).toStrictEqual(expected);
    expect(servedRecommendation(tiers).signals.shockAnnotation).toStrictEqual(
      expected,
    );

    expect(tiers.tier1.kind).toBe("fair");
    expect(tiers.tier1.confidence).toBe("high");
    expect(tiers.tier1.reason).toBe("At market price.");
    const t2 = tiers.tier2 as Recommendation;
    expect(t2.kind).toBe("fair");
    expect(t2.confidence).toBe("high");
    expect(t2.signals.buyThresholdPct).toBe(-3.83);
    expect(t2.signals.waitThresholdPct).toBe(11.48);
    expect(t2.signals.wideningFactor).toBeCloseTo(1.14829, 5);
    expect(t2.reason).toBe(
      "At market price; 30-day trend is rising 44%; price has been volatile (±17%).",
    );
  });

  test("control: shockMagnitudePct 46 removes the annotation and changes nothing else on either tier", () => {
    const f = s32FixtureNamed("SHOCK45");
    const shocked = tiersOf(f);
    const control = computeTieredRecommendation(f.input, f.market, {
      ...RECOMMENDATION_PARAMS,
      shockMagnitudePct: 46,
    });
    expect(control.tier1.signals.shockAnnotation).toBeNull();
    expect(control.tier2?.signals.shockAnnotation).toBeNull();
    const strip = (r: Recommendation | null) =>
      r === null
        ? null
        : { ...r, signals: { ...r.signals, shockAnnotation: null } };
    expect(strip(control.tier1)).toStrictEqual(strip(shocked.tier1));
    expect(strip(control.tier2)).toStrictEqual(strip(shocked.tier2));
  });

  test.each(["SHOCK45-no-market", "SHOCK-6-rows"])(
    "%s: insufficient_data carries no annotation (S3.2d7)",
    (name) => {
      const f = s32FixtureNamed(name);
      const { tier1, tier2 } = tiersOf(f);
      expect(tier1.kind).toBe("insufficient_data");
      expect(tier1.signals.shockAnnotation).toBeNull();
      expect(tier2).toBeNull();
      // The window itself would annotate: the null comes from the kind.
      expect(
        shockAnnotationOf(windowOf(f), RECOMMENDATION_PARAMS),
      ).not.toBeNull();
    },
  );

  test.each(S3_2_FIXTURES.map((f) => [f.name, f] as const))(
    "%s: the annotation matches the fixture table on both tiers",
    (_name, f) => {
      const { tier1, tier2 } = tiersOf(f);
      const expected =
        f.expected.shockMagnitude === null
          ? null
          : {
              detected: true,
              magnitude: f.expected.shockMagnitude,
              window: 7,
            };
      expect(tier1.signals.shockAnnotation).toStrictEqual(expected);
      if (tier2 !== null) {
        expect(tier2.signals.shockAnnotation).toStrictEqual(expected);
      }
    },
  );

  test("crash-ramp-30 annotates −68.24 (latest 505, ref 1590); crash-step-30 does not (the step is 10 days old)", () => {
    const named = dataEdge;
    expect(
      tiersOf(named("crash-ramp-30")).tier1.signals.shockAnnotation,
    ).toStrictEqual({
      detected: true,
      magnitude: ((505 - 1590) * 100) / 1590,
      window: 7,
    });
    expect(
      tiersOf(named("crash-step-30")).tier1.signals.shockAnnotation,
    ).toBeNull();
    expect(
      tiersOf(named("surge-ramp-30")).tier1.signals.shockAnnotation,
    ).toBeNull();
  });

  test("a shock never changes the kind: a +45% step at any asking price keeps Tier 1's band kind", () => {
    for (const asking of [10000, 13000, 14500, 16000]) {
      const market = fixtureMarket(14500, [
        ...flat(23, 10000),
        ...flat(7, 14500),
      ]);
      const flatControl = fixtureMarket(14500, flat(30, 14500));
      const shocked = computeTieredRecommendation(fixtureInput(asking), market);
      const control = computeTieredRecommendation(
        fixtureInput(asking),
        flatControl,
      );
      expect(shocked.tier1.signals.shockAnnotation).not.toBeNull();
      expect(control.tier1.signals.shockAnnotation).toBeNull();
      expect(shocked.tier1.kind).toBe(control.tier1.kind);
    }
  });

  test("a ramp's 7-day move is read from the rows, not the slope", () => {
    // 30 rows rising 100 a day from 10000: latest 12900, ref 12200 (+5.7%).
    const { tier1 } = computeTieredRecommendation(
      fixtureInput(12900),
      fixtureMarket(12900, ramp(30, 10000, 100)),
    );
    expect(tier1.signals.shockAnnotation).toBeNull();
  });
});
