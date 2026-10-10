// F1 tunables (S1.1, AC-2). Every tunable lives here; tuning never needs a
// logic change. Changing a value needs a plan-doc deviation and Josh's ruling.
// F3's params and TIER2_ENABLED join at S3.1/S3.2 (S1.1d8, C3.7 = B).
// Server-side only (node:crypto); client-safe limits live in ./limits.
import { createHash } from "node:crypto";

/**
 * F1's eleven tunables. Each field's JSDoc gives its meaning, unit and
 * rationale (S1.3d9); params.test.ts checks every field has "Unit:" and
 * "Why:". Comments never change PARAMS_VERSION.
 */
export interface RecommendationParams {
  /**
   * Half-width of the Fair band: Wait iff deltaBp > Math.round(fairBandPct × 100).
   * Unit: percent (5 → ±5%, 500 bp).
   * Why: F1, a research-backed conservative band.
   */
  readonly fairBandPct: number;
  /**
   * Buy threshold = −fairBandPct ÷ buyThresholdAsymmetry (−8.33%, −833 bp at 5 and 0.6).
   * Unit: ratio (dimensionless).
   * Why: F1, a wrong Wait costs $0 while a wrong Buy costs money, so Buy needs a deeper discount.
   */
  readonly buyThresholdAsymmetry: number;
  /**
   * Fewer real snapshots in the window give insufficient_data, even with a market price.
   * Unit: real snapshots in the window.
   * Why: C1.05 = B, no Buy, Fair or Wait on under a week of data.
   */
  readonly minSnapshotsForVerdict: number;
  /**
   * Below this, median30dCents, range30dCents and rangePosition are null.
   * Unit: real snapshots in the window.
   * Why: F1, equal to the medium-confidence floor, so range signals appear when confidence reaches medium.
   */
  readonly minSnapshotsForRange: number;
  /**
   * Below this, confidence is low; 7 to 13 snapshots also add the thin-data caveat.
   * Unit: real snapshots in the window.
   * Why: F1 and Josh's ruling of 2026-10-08 (the caveat on buy, fair and wait alike).
   */
  readonly lowConfidenceSnapshotCount: number;
  /**
   * At or above this, confidence is high; between the two counts it is medium.
   * Unit: real snapshots in the window.
   * Why: C1.09 = A, one missed daily sync does not downgrade the whole catalogue.
   */
  readonly highConfidenceSnapshotCount: number;
  /**
   * Dead zone for trendDirection (and F3's trend shift), compared exactly at 50 bp per day.
   * Unit: percent per day.
   * Why: C1.10 = A, one test makes every shifted result explainable; S1.2 D9 rounds it to whole bp.
   */
  readonly trendThresholdPct: number;
  /**
   * Below this, slope7dPct, slope30dPct and trendDirection are null.
   * Unit: real snapshots in the window.
   * Why: F1, the same floor as a verdict.
   */
  readonly minSnapshotsForTrend: number;
  /**
   * Below this, volatility30d is null (F3's volWiden stays 1.0).
   * Unit: real snapshots in the window.
   * Why: F1 (Signal definitions), the same floor as the range signals.
   */
  readonly minSnapshotsForVolatility: number;
  /**
   * Length of the counting window: the UTC dates asOf − windowDays to asOf − 1.
   * Unit: UTC dates.
   * Why: C1.09 = A, the window ends at asOf − 1, so high confidence never waits on the day's 06:00 UTC sync.
   */
  readonly windowDays: number;
  /**
   * slope7dPct runs over the last shortSlopeDays dates of the window.
   * Unit: UTC dates.
   * Why: F1 (Signal definitions), a one-week slope beside the 30-day one.
   */
  readonly shortSlopeDays: number;
}

export const RECOMMENDATION_PARAMS: RecommendationParams = Object.freeze({
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
});

/** JSON with object keys sorted at every level, so key order never matters. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, sortKeys(source[key])]),
    );
  }
  return value;
}

/** First 8 hex chars of SHA-256 over the canonical JSON of the params (F1 W2). */
export function paramsVersionOf(params: RecommendationParams): string {
  return createHash("sha256")
    .update(canonicalJson(params))
    .digest("hex")
    .slice(0, 8);
}

export const PARAMS_VERSION: string = paramsVersionOf(RECOMMENDATION_PARAMS);
