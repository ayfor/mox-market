// F1 Price Recommendation Engine: the typed contract (S1.1, AC-1).
// Pure module: no React, Next or app imports (engine purity, AGENTS.md).
// Money is integer cents end to end.

export const FINISHES = ["normal", "foil", "etched"] as const;
export const RECOMMENDATION_KINDS = [
  "buy",
  "fair",
  "wait",
  "insufficient_data",
] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const TREND_DIRECTIONS = ["rising", "falling", "flat"] as const;

export type Finish = (typeof FINISHES)[number];
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type TrendDirection = (typeof TREND_DIRECTIONS)[number];
export type MarketSource = "scryfall";

/** One daily price point for a single (scryfall_id, finish). */
export interface PriceSnapshot {
  /** UTC calendar date, 'YYYY-MM-DD'. */
  date: string;
  /** Integer cents. */
  priceCents: number;
}

/** What the user asks about: validated by validateRecommendationInput. */
export interface RecommendationInput {
  /** Integer cents, 1 to MAX_ASKING_PRICE_CENTS inclusive. */
  askingPriceCents: number;
  /** Scryfall card ID of the printing. */
  cardId: string;
  finish: Finish;
}

/** The market data the engine reads; never validated as user input. */
export interface MarketSnapshot {
  appliedFinish: Finish;
  /** Integer cents; null when the market has no current price. */
  currentPriceCents: number | null;
  /** Oldest to newest; may be sparse. */
  history: PriceSnapshot[];
  /** UTC 'YYYY-MM-DD'; the engine never reads the clock. */
  asOf: string;
  source: MarketSource;
  /** Passed through for F2; no F1 rule reads it. */
  latestSnapshotAt: Date | null;
}

/** Integer cents. */
export interface PriceRange {
  low: number;
  high: number;
  avg: number;
}

/**
 * F3's shock annotation (S3.2d6): the newest window row moved at least
 * shockMagnitudePct against the newest row at least shockWindowDays before
 * it. Present only when detected; the verdict never changes.
 */
export interface ShockAnnotation {
  readonly detected: true;
  /** sevenDayMovePct: (latest − ref) × 100 / ref, signed, never −0. */
  readonly magnitude: number;
  /** shockWindowDays, in UTC days. */
  readonly window: number;
}

export interface RecommendationSignals {
  deltaPct: number | null;
  deltaBp: number | null;
  marketPriceCents: number | null;
  median30dCents: number | null;
  range30dCents: PriceRange | null;
  rangePosition: number | null;
  slope7dPct: number | null;
  slope30dPct: number | null;
  volatility30d: number | null;
  snapshotCount30d: number;
  trendDirection: TrendDirection | null;
  fallbackNotice: boolean;
  bandPct: number;
  wideningFactor: number;
  buyThresholdPct: number;
  waitThresholdPct: number;
  /**
   * F3 (S3.2d7): the same on both tiers and served whatever TIER2_ENABLED
   * says (C1.47 = A); null when no shock, or when the kind is
   * insufficient_data.
   */
  shockAnnotation: ShockAnnotation | null;
}

export interface Recommendation {
  kind: RecommendationKind;
  confidence: Confidence;
  /**
   * One sentence of observed facts, built only from copy.ts templates; the
   * forbidden-phrase lint covers every reason (S1.3, AC-1, AC-2).
   */
  reason: string;
  signals: RecommendationSignals;
}

/**
 * F3 Engine API (S3.1d3): both tiers from one call. tier1 is F1's price-only
 * result; tier2 applies F3's adjusted thresholds and is null only when tier1
 * is insufficient_data. Which one is served follows TIER2_ENABLED.
 */
export interface TieredRecommendation {
  tier1: Recommendation;
  tier2: Recommendation | null;
}
