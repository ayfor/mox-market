// F3 Tier 2, part 1 (S3.1): the trend band shift. Pure: no React, Next,
// clock or randomness. Order (F3; C1.34): widen the fair band, apply the
// Buy-side asymmetry, then shift both thresholds by the 30-day trend,
// clamped to ±the widened band and 0 inside the dead zone (C1.10 = A,
// C1.11 = A). Each threshold is rounded once to whole bp before the strict
// comparison, equality Fair (C1.41 = A; S3.1d5). The volatility factor and
// its cap value, staleness and the shock annotation are S3.2's; the cap rule
// itself is here (S3.1 ADV SPEC-1).
import {
  BP_PER_PCT,
  bandKind,
  withoutNegativeZero,
  type ThresholdsBp,
} from "./bands";
import type { RecommendationParams } from "./params";
import { buildReason, type TrendClause } from "./reason";
import type { ExactRatio } from "./signals";
import type { Confidence, Recommendation, TrendDirection } from "./types";

/** What tier2Thresholds reads from Tier 1's result. */
export interface Tier2ThresholdInput {
  readonly confidence: Confidence;
  readonly trendDirection: TrendDirection | null;
  readonly slope30dPct: number | null;
}

/**
 * The volatility widening S3.2 supplies: its factor (volWiden) and the cap
 * on the whole widening factor (volatilityWideningCap). One object, so a
 * caller cannot pass a volatility factor without the cap (S3.1 ADV SPEC-1).
 */
export interface VolatilityWidening {
  readonly widen: number;
  readonly cap: number;
}

export interface Tier2Thresholds extends ThresholdsBp {
  /**
   * min(volWiden × confWiden, cap) (F3; C1.11 = A). At S3.1 no volatility is
   * passed, so it is 1 or lowConfidenceWidening.
   */
  readonly wideningFactor: number;
  /** fairBandPct × wideningFactor, in percent. */
  readonly bandPct: number;
  /** The clamped trend shift, in percent; 0 when the trend is flat or null. */
  readonly shiftPct: number;
}

/** Rising or falling: the dead-zone test S1.2 already applied (C1.10 = A). */
const isTrending = (
  direction: TrendDirection | null,
): direction is Exclude<TrendDirection, "flat"> =>
  direction === "rising" || direction === "falling";

/**
 * Tier 2's band and thresholds (S3.1d5). volatility is the seam S3.2 fills
 * with volWiden and volatilityWideningCap; the factor is capped whenever it
 * is given (F3: wideningFactor = min(volWiden × confWiden, 2.0)). At S3.1
 * nothing passes it, volWiden is 1 and the factor is confWiden (S3.1 ADV
 * SPEC-1).
 */
export function tier2Thresholds(
  signals: Tier2ThresholdInput,
  params: RecommendationParams,
  volatility?: VolatilityWidening,
): Tier2Thresholds {
  const confWiden =
    signals.confidence === "low" ? params.lowConfidenceWidening : 1;
  const wideningFactor =
    volatility === undefined
      ? confWiden
      : Math.min(volatility.widen * confWiden, volatility.cap);
  const bandPct = params.fairBandPct * wideningFactor;
  const rawShift =
    isTrending(signals.trendDirection) && signals.slope30dPct !== null
      ? signals.slope30dPct * params.windowDays * params.trendShiftFactor
      : 0;
  const shiftPct = withoutNegativeZero(
    Math.min(bandPct, Math.max(-bandPct, rawShift)),
  );
  return {
    wideningFactor,
    bandPct,
    shiftPct,
    buyBp: withoutNegativeZero(
      Math.round(
        (-bandPct / params.buyThresholdAsymmetry + shiftPct) * BP_PER_PCT,
      ),
    ),
    waitBp: withoutNegativeZero(Math.round((bandPct + shiftPct) * BP_PER_PCT)),
  };
}

/**
 * X for the trend clause: Math.round(|slope × windowDays|) on the exact
 * slope ratio, half up, so a float never moves X (S3.1d7). It cites the raw
 * slope, never the clamped shift (AC-6).
 */
export function trendClauseX(
  slope30d: ExactRatio,
  params: RecommendationParams,
): number {
  const absNum = slope30d.num < BigInt(0) ? -slope30d.num : slope30d.num;
  const twice = BigInt(2);
  const monthly = absNum * BigInt(params.windowDays);
  return Number((twice * monthly + slope30d.den) / (twice * slope30d.den));
}

/**
 * Tier 2 from Tier 1 (S3.1d8): Tier 1 with kind, reason, bandPct,
 * wideningFactor and both thresholds replaced. Confidence and every
 * descriptive signal stay Tier 1's. Null when Tier 1 is insufficient_data
 * (C1.05 = B). slope30d is Tier 1's exact 30-day slope (null below the
 * trend minimum).
 */
export function computeTier2(
  tier1: Recommendation,
  slope30d: ExactRatio | null,
  params: RecommendationParams,
): Recommendation | null {
  const { signals, confidence } = tier1;
  if (tier1.kind === "insufficient_data" || signals.deltaBp === null) {
    return null;
  }
  const thresholds = tier2Thresholds(
    {
      confidence,
      trendDirection: signals.trendDirection,
      slope30dPct: signals.slope30dPct,
    },
    params,
  );
  const kind = bandKind(signals.deltaBp, thresholds);
  const trend: TrendClause | undefined =
    isTrending(signals.trendDirection) && slope30d !== null
      ? {
          direction: signals.trendDirection,
          X: trendClauseX(slope30d, params),
        }
      : undefined;
  return {
    ...tier1,
    kind,
    reason: buildReason({
      kind,
      deltaBp: signals.deltaBp,
      bandPct: thresholds.bandPct,
      confidence,
      snapshotCount30d: signals.snapshotCount30d,
      trend,
    }),
    signals: {
      ...signals,
      bandPct: thresholds.bandPct,
      wideningFactor: thresholds.wideningFactor,
      buyThresholdPct: withoutNegativeZero(thresholds.buyBp / BP_PER_PCT),
      waitThresholdPct: withoutNegativeZero(thresholds.waitBp / BP_PER_PCT),
    },
  };
}
