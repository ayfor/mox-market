// S3.1 T12 (AC-4; S3.1d10): the dark launch. With TIER2_ENABLED off, the
// served recommendation deep-equals the S1.2 result across the full fixture
// matrix. "The S1.2 result" is a recording, not the refactored code itself:
// __snapshots__/tiered-parity.s1.2.json was written once, from the engine at
// 97b4bba before any S3.1 engine edit, and no later commit touches it. CI
// runs with the snapshot update mode none (S1.3 ADV-1), so a missing or
// changed recording fails there.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { computeRecommendation } from "./engine";
import {
  CANONICAL_FIXTURES,
  fixtureInput,
  fixtureMarket,
  flat,
  TIER2_FIXTURES,
} from "./fixtures";
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
