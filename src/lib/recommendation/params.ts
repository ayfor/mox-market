// F1 tunables (S1.1, AC-2). Every tunable lives here; tuning never needs a
// logic change. Changing a value needs a plan-doc deviation and Josh's ruling.
// F3's params and TIER2_ENABLED join at S3.1/S3.2 (S1.1d8, C3.7 = B).
// Server-side only (node:crypto); client-safe limits live in ./limits.
import { createHash } from "node:crypto";

export interface RecommendationParams {
  readonly fairBandPct: number;
  readonly buyThresholdAsymmetry: number;
  readonly minSnapshotsForVerdict: number;
  readonly minSnapshotsForRange: number;
  readonly lowConfidenceSnapshotCount: number;
  readonly highConfidenceSnapshotCount: number;
  readonly trendThresholdPct: number;
  readonly minSnapshotsForTrend: number;
  readonly minSnapshotsForVolatility: number;
  readonly windowDays: number;
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
