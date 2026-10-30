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
/** F4's age buckets, spelled as its Fields table (S4.1d3). */
export const CARD_AGES = [
  "recent",
  "modern-era",
  "vintage-era",
  "unknown",
] as const;
/** F4's EDHREC popularity buckets (S4.1d3). */
export const POPULARITY_BUCKETS = [
  "top1000",
  "top5000",
  "longtail",
  "unranked",
] as const;
/** F4's format profiles (S4.1d3). */
export const FORMAT_PROFILES = ["competitive", "edh", "casual"] as const;

export type Finish = (typeof FINISHES)[number];
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type TrendDirection = (typeof TREND_DIRECTIONS)[number];
export type MarketSource = "scryfall";
export type CardAge = (typeof CARD_AGES)[number];
export type Popularity = (typeof POPULARITY_BUCKETS)[number];
export type FormatProfile = (typeof FORMAT_PROFILES)[number];

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

/**
 * F4's card classification (S4.1d3): display only, so no band, kind,
 * confidence or reason reads it. Every field is explicit; there is no
 * "unclassified" sentinel, and the defaults are DEFAULT_CARD_CATEGORY.
 */
export interface CardCategory {
  readonly reservedList: boolean;
  readonly age: CardAge;
  readonly popularity: Popularity;
  readonly formatProfile: FormatProfile;
  readonly digital: boolean;
}

/** F4's Fields-table defaults: what a card with none of the five fields gets. */
export const DEFAULT_CARD_CATEGORY: CardCategory = Object.freeze({
  reservedList: false,
  age: "unknown",
  popularity: "unranked",
  formatProfile: "casual",
  digital: false,
});

/**
 * The Scryfall fields classify reads, each optional and unknown, because
 * Scryfall's JSON is cast, never validated, and the engine may not import
 * @/types/scryfall (S4.1d3). ScryfallCard is assignable to it.
 */
export interface ClassifiableCard {
  readonly reserved?: unknown;
  readonly released_at?: unknown;
  readonly edhrec_rank?: unknown;
  readonly legalities?: unknown;
  readonly digital?: unknown;
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
  /**
   * F4 (S4.1d6): the classification of the printing being priced. The
   * engine has no card, so it is null on every engine result; the server
   * path sets it on both tiers with withCategory before serving.
   */
  category: CardCategory | null;
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
