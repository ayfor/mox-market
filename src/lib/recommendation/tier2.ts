// F3 Tier 2 (S3.1, S3.2). Pure: no React, Next, clock or randomness.
// Staleness first: when the newest history row is more than staleDays before
// asOf, Tier 2's confidence is low (S3.2d4, ADV SPEC-1). Then (F3; C1.34) widen the fair
// band by min(volWiden × confWiden, volatilityWideningCap) (C1.11 = A,
// S3.2d3), apply the Buy-side asymmetry, and shift both thresholds by the
// 30-day trend, clamped to ±the widened band and 0 inside the dead zone
// (C1.10 = A). Each threshold is rounded once to whole bp before the strict
// comparison, equality Fair (C1.41 = A; S3.1d5). The reason fills its one
// caveat slot by stale > thin-data > volatility (S3.2d5).
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
import { hasRealSnapshotOn, type WindowSnapshot } from "./window";

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
   * min(volWiden × confWiden, cap) (F3; C1.11 = A). computeTier2 always
   * passes volWiden and the cap (S3.2d3); without them it is confWiden.
   */
  readonly wideningFactor: number;
  /** fairBandPct × wideningFactor, in percent. */
  readonly bandPct: number;
  /** The clamped trend shift, in percent; 0 when the trend is flat or null. */
  readonly shiftPct: number;
}

/**
 * F3's volWiden (C1.35; S3.2d3): volatility30d ÷ volatileCV, clamped to
 * [1, volatilityWideningCap]; 1 when volatility30d is null (below
 * minSnapshotsForVolatility).
 */
export function volatilityWiden(
  volatility30d: number | null,
  params: RecommendationParams,
): number {
  if (volatility30d === null) return 1;
  return Math.min(
    params.volatilityWideningCap,
    Math.max(1, volatility30d / params.volatileCV),
  );
}

/**
 * The newest real history row's age in UTC days, utcDay(asOf) − latest.date
 * (F1: F3's stale clause uses the newest history date, C1.12; S3.2d4 as
 * revised by ADV SPEC-1). The window ends at asOf − 1, so a real row dated
 * asOf itself gives 0; otherwise the newest window row gives windowDays −
 * its index, since index windowDays − 1 is asOf − 1. Rows after asOf never
 * count. Null when the window is empty: Tier 1 is then insufficient_data
 * and there is no Tier 2. Never reads the clock.
 */
export function latestAgeDays(
  history: unknown,
  asOf: string,
  windowSnapshots: readonly WindowSnapshot[],
  params: RecommendationParams,
): number | null {
  const latest = windowSnapshots.at(-1);
  if (latest === undefined) return null;
  return hasRealSnapshotOn(history, asOf)
    ? 0
    : params.windowDays - latest.index;
}

/** A ratio times this is a percentage (the volatility clause's X). */
const PERCENT = 100;

/** Rising or falling: the dead-zone test S1.2 already applied (C1.10 = A). */
const isTrending = (
  direction: TrendDirection | null,
): direction is Exclude<TrendDirection, "flat"> =>
  direction === "rising" || direction === "falling";

/**
 * Tier 2's band and thresholds (S3.1d5). volatility carries volWiden and
 * volatilityWideningCap, and the factor is capped whenever it is given (F3:
 * wideningFactor = min(volWiden × confWiden, 2.0); S3.1 ADV SPEC-1).
 * computeTier2 always passes it (S3.2d3); without it the factor is
 * confWiden, which S3.1's helper tests still use.
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
 * Tier 2 from Tier 1 (S3.1d8, S3.2d4): Tier 1 with kind, confidence, reason,
 * bandPct, wideningFactor and both thresholds replaced. Confidence is low
 * when the data is stale, else Tier 1's; every descriptive signal and the
 * shock annotation stay Tier 1's. Null when Tier 1 is insufficient_data
 * (C1.05 = B). slope30d is Tier 1's exact 30-day slope (null below the
 * trend minimum); ageDays is the newest history row's age (latestAgeDays).
 */
export function computeTier2(
  tier1: Recommendation,
  slope30d: ExactRatio | null,
  ageDays: number | null,
  params: RecommendationParams,
): Recommendation | null {
  const { signals } = tier1;
  if (tier1.kind === "insufficient_data" || signals.deltaBp === null) {
    return null;
  }
  const stale = ageDays !== null && ageDays > params.staleDays;
  const confidence: Confidence = stale ? "low" : tier1.confidence;
  const volWiden = volatilityWiden(signals.volatility30d, params);
  const thresholds = tier2Thresholds(
    {
      confidence,
      trendDirection: signals.trendDirection,
      slope30dPct: signals.slope30dPct,
    },
    params,
    { widen: volWiden, cap: params.volatilityWideningCap },
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
    confidence,
    reason: buildReason({
      kind,
      deltaBp: signals.deltaBp,
      bandPct: thresholds.bandPct,
      confidence,
      snapshotCount30d: signals.snapshotCount30d,
      trend,
      stale: stale && ageDays !== null ? { d: ageDays } : undefined,
      volatility:
        volWiden > 1 && signals.volatility30d !== null
          ? { X: Math.round(signals.volatility30d * PERCENT) }
          : undefined,
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
