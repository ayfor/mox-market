// S3.1 T12 (AC-4; S3.1d10): the dark launch. With TIER2_ENABLED off, the
// served recommendation deep-equals the S1.2 result across the full fixture
// matrix. "The S1.2 result" is a recording, not the refactored code itself:
// __snapshots__/tiered-parity.s1.2.json was written once, from the engine at
// 97b4bba before any S3.1 engine edit, and no later commit touches it. CI
// runs with the snapshot update mode none (S1.3 ADV-1), so a missing or
// changed recording fails there. S3.1 T13 adds the flag: with TIER2_ENABLED
// on, Tier 2 is served wherever it exists.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  computeRecommendation,
  computeTieredRecommendation,
  servedRecommendation,
} from "./engine";
import {
  CANONICAL_FIXTURES,
  fixtureInput,
  fixtureMarket,
  flat,
  TIER2_FIXTURES,
} from "./fixtures";
import { RECOMMENDATION_PARAMS } from "./params";
import type {
  MarketSnapshot,
  Recommendation,
  RecommendationInput,
} from "./types";

const RECORDING = "./__snapshots__/tiered-parity.s1.2.json";

/** S1.2 T2's band edges (bands.test.ts EDGES): [asking, market], 30 flat rows. */
const BAND_EDGES = [
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
] as const;

interface MatrixCase {
  readonly name: string;
  readonly input: RecommendationInput;
  readonly market: MarketSnapshot;
}

/** The full fixture matrix, each case under a unique name. */
const PARITY_MATRIX: readonly MatrixCase[] = [
  ...CANONICAL_FIXTURES.map((f) => ({
    name: `canonical:${f.name}`,
    input: f.input,
    market: f.market,
  })),
  ...TIER2_FIXTURES.map((f) => ({
    name: `tier2:${f.name}`,
    input: f.input,
    market: f.market,
  })),
  ...BAND_EDGES.map(([asking, market]) => ({
    name: `edge:${asking}@${market}`,
    input: fixtureInput(asking),
    market: fixtureMarket(market, flat(30, market)),
  })),
];

const recorded = (): Record<string, Recommendation> =>
  JSON.parse(readFileSync(path.join(__dirname, RECORDING), "utf8"));

describe("the S1.2 recording (T12, AC-4; S3.1d10)", () => {
  test("the matrix names are unique and cover every fixture", () => {
    const names = PARITY_MATRIX.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(
      CANONICAL_FIXTURES.length + TIER2_FIXTURES.length + BAND_EDGES.length,
    );
  });

  test("computeRecommendation over the matrix matches the recording", async () => {
    const results = Object.fromEntries(
      PARITY_MATRIX.map((c) => [
        c.name,
        computeRecommendation(c.input, c.market),
      ]),
    );
    await expect(`${JSON.stringify(results, null, 2)}\n`).toMatchFileSnapshot(
      RECORDING,
    );
  });

  test.each(PARITY_MATRIX.map((c) => [c.name, c] as const))(
    "%s: the served recommendation deep-equals the S1.2 result",
    (name, c) => {
      expect(computeRecommendation(c.input, c.market)).toStrictEqual(
        recorded()[name],
      );
    },
  );
});

describe("Tier 1 of the tiered call is the S1.2 result (T12, AC-4)", () => {
  test.each(PARITY_MATRIX.map((c) => [c.name, c] as const))(
    "%s: computeTieredRecommendation(...).tier1 deep-equals the recording",
    (name, c) => {
      const { tier1 } = computeTieredRecommendation(c.input, c.market);
      expect(tier1).toStrictEqual(recorded()[name]);
      expect(tier1.signals.wideningFactor).toBe(1);
      expect(tier1.signals.bandPct).toBe(5);
    },
  );
});

/** Every signal F1 owns: identical on both tiers (F3 Engine API). */
const DESCRIPTIVE_SIGNALS = [
  "deltaPct",
  "deltaBp",
  "marketPriceCents",
  "median30dCents",
  "range30dCents",
  "rangePosition",
  "slope7dPct",
  "slope30dPct",
  "volatility30d",
  "snapshotCount30d",
  "trendDirection",
  "fallbackNotice",
] as const;

describe("the flag (T13, AC-4; F3 Engine API)", () => {
  const ON = { ...RECOMMENDATION_PARAMS, TIER2_ENABLED: true };

  test.each(PARITY_MATRIX.map((c) => [c.name, c] as const))(
    "%s: with TIER2_ENABLED on, computeRecommendation serves tier2 when present, else tier1",
    (_name, c) => {
      const tiers = computeTieredRecommendation(c.input, c.market);
      expect(computeRecommendation(c.input, c.market, ON)).toStrictEqual(
        tiers.tier2 ?? tiers.tier1,
      );
    },
  );

  test.each(PARITY_MATRIX.map((c) => [c.name, c] as const))(
    "%s: servedRecommendation under the shipped params is tier1",
    (_name, c) => {
      const tiers = computeTieredRecommendation(c.input, c.market);
      expect(servedRecommendation(tiers)).toBe(tiers.tier1);
      expect(computeRecommendation(c.input, c.market)).toStrictEqual(
        tiers.tier1,
      );
    },
  );

  test.each(PARITY_MATRIX.map((c) => [c.name, c] as const))(
    "%s: tier1 and tier2 share every descriptive signal and the confidence",
    (_name, c) => {
      const { tier1, tier2 } = computeTieredRecommendation(c.input, c.market);
      if (tier2 === null) {
        expect(tier1.kind).toBe("insufficient_data");
        return;
      }
      expect(tier2.confidence).toBe(tier1.confidence);
      for (const key of DESCRIPTIVE_SIGNALS) {
        expect(tier2.signals[key], key).toStrictEqual(tier1.signals[key]);
      }
    },
  );

  test("the shipped params keep Tier 2 dark", () => {
    expect(RECOMMENDATION_PARAMS.TIER2_ENABLED).toBe(false);
  });

  test("with the flag on, at least one matrix case is served a different kind (the flag is live)", () => {
    const flipped = PARITY_MATRIX.filter(
      (c) =>
        computeRecommendation(c.input, c.market, ON).kind !==
        computeRecommendation(c.input, c.market).kind,
    ).map((c) => c.name);
    expect(flipped).toEqual(
      expect.arrayContaining(["canonical:C", "canonical:A-rising"]),
    );
  });
});
