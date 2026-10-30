// F1 tunables (S1.1, AC-2). Every tunable lives here; tuning never needs a
// logic change. Changing a value needs a plan-doc deviation and Josh's ruling.
// TIER2_ENABLED and the two F3 params S3.1 reads joined at S3.1; S3.2 added
// the five it reads (S1.1d8, C3.7 = B; S3.1d4, S3.2d2). S4.1 added F4's
// four classification thresholds (S4.1d2).
// Server-side only (node:crypto); client-safe limits live in ./limits.
import { createHash } from "node:crypto";

/**
 * F1's eleven tunables, then F3's (S3.1: TIER2_ENABLED, trendShiftFactor,
 * lowConfidenceWidening; S3.2: staleDays, volatileCV, volatilityWideningCap,
 * shockWindowDays, shockMagnitudePct), then F4's (S4.1: recentPrintingDays,
 * edhrecTop1Rank, edhrecTop2Rank, modernEraStart). Each field's JSDoc gives its meaning, unit and
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
  /**
   * Serve Tier 2 (F3's adjusted thresholds and trend clause) instead of Tier 1. Off: Tier 2 is computed alongside and never served.
   * Unit: boolean (false = Tier 1 served).
   * Why: F3 dark launch (C1.37, C1.61; C3.7 = B), flipping it is a code change that changes PARAMS_VERSION.
   */
  readonly TIER2_ENABLED: boolean;
  /**
   * Tier 2 shifts both thresholds by slope30dPct × windowDays × trendShiftFactor, clamped to ±the fair band, and 0 when trendDirection is flat.
   * Unit: ratio (dimensionless; 0.5 → half the 30-day trend).
   * Why: F3, a half-strength lean on the observed trend; 0.3 vs 0.5 is F3's open calibration item.
   */
  readonly trendShiftFactor: number;
  /**
   * Tier 2 widens the fair band by this factor when confidence is low (before the asymmetry and the shift).
   * Unit: ratio (dimensionless; 1.5 → a ±7.5% band at fairBandPct 5).
   * Why: F3, thin data earns a wider band rather than a confident verdict (C1.34).
   */
  readonly lowConfidenceWidening: number;
  /**
   * Tier 2 caps confidence at low when the newest history row is more than this many UTC days before asOf (liquidity is staleness).
   * Unit: UTC days (7 → a newest row dated asOf − 8 or older is stale).
   * Why: F3 and C1.12 = A, stale data earns a wider band and the stale caveat; density was dropped.
   */
  readonly staleDays: number;
  /**
   * The coefficient of variation at which Tier 2 starts widening: volWiden = clamp(volatility30d ÷ volatileCV, 1, volatilityWideningCap).
   * Unit: ratio (dimensionless; 0.15 → a 30-day standard deviation of 15% of the mean).
   * Why: F3 (C1.35), a card that swings more than ±15% earns a proportionally wider fair band.
   */
  readonly volatileCV: number;
  /**
   * The cap on volWiden and on the whole widening factor, min(volWiden × confWiden, cap).
   * Unit: ratio (dimensionless; 2 → at most a ±10% band at fairBandPct 5).
   * Why: F3 and C1.11 = A, widening never makes a verdict unreachable.
   */
  readonly volatilityWideningCap: number;
  /**
   * The shock annotation compares the newest window row with the newest row at least this many UTC days before it.
   * Unit: UTC days.
   * Why: F3 (C1.55), sevenDayMovePct, the move the locked shock tooltip describes.
   */
  readonly shockWindowDays: number;
  /**
   * A shock annotation is attached when |sevenDayMovePct| is at least this; the verdict never changes.
   * Unit: percent (35 → a 35% move either way).
   * Why: F3, a move that large is worth flagging beside the badge (C1.47 = A).
   */
  readonly shockMagnitudePct: number;
  /**
   * F4's age: a printing is recent when max(0, its age in UTC days at asOf) is less than this.
   * Unit: UTC days (183 → a printing released 182 days before asOf is recent, 183 days is not).
   * Why: F4, a printing under about six months old is recent; display only (S4.1d2).
   */
  readonly recentPrintingDays: number;
  /**
   * F4's popularity: an EDHREC rank from 1 to this is top1000.
   * Unit: EDHREC rank, inclusive upper bound.
   * Why: F4's popularity buckets; display only (S4.1d2).
   */
  readonly edhrecTop1Rank: number;
  /**
   * F4's popularity: an EDHREC rank above edhrecTop1Rank and up to this is top5000; above it, longtail.
   * Unit: EDHREC rank, inclusive upper bound.
   * Why: F4's popularity buckets; display only (S4.1d2).
   */
  readonly edhrecTop2Rank: number;
  /**
   * F4's age: a printing that is not recent is modern-era when released on or after this date, else vintage-era.
   * Unit: UTC calendar date 'YYYY-MM-DD', inclusive.
   * Why: F4, the 8th Edition release date and the modern card frame; display only (S4.1d2).
   */
  readonly modernEraStart: string;
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
  TIER2_ENABLED: false,
  trendShiftFactor: 0.5,
  lowConfidenceWidening: 1.5,
  staleDays: 7,
  volatileCV: 0.15,
  volatilityWideningCap: 2,
  shockWindowDays: 7,
  shockMagnitudePct: 35,
  recentPrintingDays: 183,
  edhrecTop1Rank: 1000,
  edhrecTop2Rank: 5000,
  modernEraStart: "2003-07-28",
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
