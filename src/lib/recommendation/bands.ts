// Tier-1 bands in integer basis points (S1.2d6, C1.41 = A). Strict
// inequalities: buy iff deltaBp < buyBp, wait iff deltaBp > waitBp, and
// equality with either threshold is Fair. The trend threshold is rounded to
// whole bp the same way (ADV-1).
import type { RecommendationParams } from "./params";

/** Basis points in one unit (deltaBp = ratio × BP_PER_UNIT). */
const BP_PER_UNIT = 10000;

/** Basis points in one percent. */
export const BP_PER_PCT = 100;

export interface ThresholdsBp {
  /** Buy below this, rounded to a whole bp (−833 at F1's params). */
  readonly buyBp: number;
  /** Wait above this, rounded to a whole bp (+500 at F1's params). */
  readonly waitBp: number;
}

export type BandKind = "buy" | "fair" | "wait";

/** Turns −0 into +0, so a signal never reports −0. */
export const withoutNegativeZero = (value: number): number =>
  value === 0 ? 0 : value;

/** The Tier-1 thresholds: wait at +fairBandPct, buy at −fairBandPct ÷ asymmetry. */
export function thresholdsBp(params: RecommendationParams): ThresholdsBp {
  return {
    buyBp: withoutNegativeZero(
      Math.round(
        (-params.fairBandPct * BP_PER_PCT) / params.buyThresholdAsymmetry,
      ),
    ),
    waitBp: withoutNegativeZero(Math.round(params.fairBandPct * BP_PER_PCT)),
  };
}

/** Math.round((asking − market) × 10000 / market), never −0. Market is a positive integer. */
export function deltaBpOf(askingCents: number, marketCents: number): number {
  return withoutNegativeZero(
    Math.round(((askingCents - marketCents) * BP_PER_UNIT) / marketCents),
  );
}

/** The Tier-1 kind for a delta: strict comparisons, equality is Fair. */
export function bandKind(deltaBp: number, thresholds: ThresholdsBp): BandKind {
  if (deltaBp < thresholds.buyBp) return "buy";
  if (deltaBp > thresholds.waitBp) return "wait";
  return "fair";
}

/**
 * trendThresholdPct in whole bp per day (50 at F1's params), rounded as the
 * band thresholds are (C1.41 = A); signals.ts compares the exact slope with
 * it, so the trend label has one exact test (C1.10 = A, ADV-1).
 */
export function trendThresholdBp(params: RecommendationParams): number {
  return withoutNegativeZero(Math.round(params.trendThresholdPct * BP_PER_PCT));
}
