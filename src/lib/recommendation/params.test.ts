// T3, T4 (AC-2): F1's eleven params at design values, and PARAMS_VERSION.
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  canonicalJson,
  PARAMS_VERSION,
  paramsVersionOf,
  RECOMMENDATION_PARAMS,
  type RecommendationParams,
} from "./params";

const F1_PARAMS = {
  fairBandPct: 5,
  buyThresholdAsymmetry: 0.6,
  minSnapshotsForVerdict: 7,
  minSnapshotsForRange: 14,
  lowConfidenceSnapshotCount: 14,
  highConfidenceSnapshotCount: 28,
  trendThresholdPct: 0.5,
  minSnapshotsForTrend: 7,
  minSnapshotsForVolatility: 14,
  windowDays: 30,
  shortSlopeDays: 7,
};

describe("RECOMMENDATION_PARAMS (T3)", () => {
  test("deep-equals exactly F1's eleven params at design values", () => {
    expect(RECOMMENDATION_PARAMS).toStrictEqual(F1_PARAMS);
    expect(Object.keys(RECOMMENDATION_PARAMS).sort()).toEqual(
      Object.keys(F1_PARAMS).sort(),
    );
  });

  test("holds no F3 params or TIER2_ENABLED yet (S1.1d8, C3.7 = B)", () => {
    for (const key of [
      "TIER2_ENABLED",
      "staleDays",
      "trendShiftFactor",
      "volatileCV",
      "volatilityWideningCap",
      "lowConfidenceWidening",
      "shockWindowDays",
      "shockMagnitudePct",
    ]) {
      expect(RECOMMENDATION_PARAMS).not.toHaveProperty(key);
    }
  });

  test("is frozen, so a stray write cannot retune the engine", () => {
    expect(Object.isFrozen(RECOMMENDATION_PARAMS)).toBe(true);
    expect(() => {
      (RECOMMENDATION_PARAMS as { fairBandPct: number }).fairBandPct = 99;
    }).toThrow(TypeError);
    expect(RECOMMENDATION_PARAMS.fairBandPct).toBe(5);
  });
});

describe("PARAMS_VERSION (T4)", () => {
  test("is the first 8 hex chars of SHA-256 over sorted-key JSON", () => {
    const p = F1_PARAMS as Record<string, unknown>;
    const expected = createHash("sha256")
      .update(JSON.stringify(p, Object.keys(p).sort()))
      .digest("hex")
      .slice(0, 8);
    expect(PARAMS_VERSION).toMatch(/^[0-9a-f]{8}$/);
    expect(PARAMS_VERSION).toBe(expected);
    expect(paramsVersionOf(RECOMMENDATION_PARAMS)).toBe(PARAMS_VERSION);
  });

  test("ignores key order", () => {
    const reversed = Object.fromEntries(
      Object.entries(RECOMMENDATION_PARAMS).reverse(),
    ) as unknown as RecommendationParams;
    expect(Object.keys(reversed)[0]).toBe("shortSlopeDays");
    expect(paramsVersionOf(reversed)).toBe(PARAMS_VERSION);
  });

  test.each(Object.keys(F1_PARAMS))("changes when %s changes", (key) => {
    const bumped = {
      ...RECOMMENDATION_PARAMS,
      [key]: RECOMMENDATION_PARAMS[key as keyof RecommendationParams] + 1,
    };
    expect(paramsVersionOf(bumped)).not.toBe(PARAMS_VERSION);
  });

  test("canonicalJson sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[{"x":2,"y":1}]},"b":1}',
    );
  });

  test("pins today's value (a param change shows up here as a diff, F1 W2)", () => {
    expect(PARAMS_VERSION).toMatchInlineSnapshot(`"46ec1cd7"`);
  });
});
