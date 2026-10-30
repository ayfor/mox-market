// F4 Card Classification (S4.1): a CardCategory from the Scryfall card object
// of the printing being priced. Pure: no fetch, no clock (asOf comes from the
// caller, F1's UTC date), and inputs are never mutated. Display only, so no
// kind, confidence, reason or band reads it (F4 Decisions baked in). Scryfall's
// JSON is cast, never validated, and the result page is live, so classify
// never throws: a missing or malformed field is that field's default (S4.1d4).
import { RECOMMENDATION_PARAMS, type RecommendationParams } from "./params";
import {
  DEFAULT_CARD_CATEGORY,
  type CardAge,
  type CardCategory,
  type ClassifiableCard,
  type FormatProfile,
  type Popularity,
  type Recommendation,
  type TieredRecommendation,
} from "./types";
import { windowDates } from "./window";

/** F4's competitive formats: legal in any one makes a card competitive. */
const COMPETITIVE_FORMATS = ["standard", "pioneer", "modern"] as const;
/** F4's EDH format, read when no competitive format is legal. */
const EDH_FORMAT = "commander";
/** The one legality status that counts; restricted and banned do not. */
const LEGAL = "legal";

/** A real UTC calendar date 'YYYY-MM-DD', by windowDates's rule (S4.1d5). */
const isCalendarDate = (value: unknown): value is string =>
  windowDates(value, 0) !== null;

/**
 * recent iff max(0, ageDays) < recentPrintingDays, written as "released
 * after the date recentPrintingDays UTC days before asOf" so no
 * milliseconds-per-day literal is needed (S4.1d5). Otherwise modern-era on or
 * after modernEraStart, else vintage-era. Either date invalid: unknown.
 */
function ageOf(
  releasedAt: unknown,
  asOf: unknown,
  params: RecommendationParams,
): CardAge {
  if (!isCalendarDate(releasedAt) || !isCalendarDate(asOf)) {
    return DEFAULT_CARD_CATEGORY.age;
  }
  if (params.recentPrintingDays > 0) {
    // windowDates(asOf, n)[0] is asOf − n.
    const [cutoff] = windowDates(asOf, params.recentPrintingDays) ?? [];
    if (cutoff !== undefined && releasedAt > cutoff) return "recent";
  }
  // Both are validated 'YYYY-MM-DD' with four-digit years, so string order
  // is date order.
  return releasedAt >= params.modernEraStart ? "modern-era" : "vintage-era";
}

/** Only a positive safe integer is an EDHREC rank (S4.1d4). */
function popularityOf(rank: unknown, params: RecommendationParams): Popularity {
  if (!Number.isSafeInteger(rank) || (rank as number) <= 0) {
    return DEFAULT_CARD_CATEGORY.popularity;
  }
  const r = rank as number;
  if (r <= params.edhrecTop1Rank) return "top1000";
  if (r <= params.edhrecTop2Rank) return "top5000";
  return "longtail";
}

/** True when legalities is an object whose own `format` is exactly "legal". */
function isLegalIn(legalities: unknown, format: string): boolean {
  if (
    legalities === null ||
    typeof legalities !== "object" ||
    Array.isArray(legalities) ||
    !Object.prototype.hasOwnProperty.call(legalities, format)
  ) {
    return false;
  }
  return (legalities as Record<string, unknown>)[format] === LEGAL;
}

/** F4's decision rule: competitive, else edh, else casual. */
function formatProfileOf(legalities: unknown): FormatProfile {
  if (COMPETITIVE_FORMATS.some((format) => isLegalIn(legalities, format))) {
    return "competitive";
  }
  if (isLegalIn(legalities, EDH_FORMAT)) return "edh";
  return DEFAULT_CARD_CATEGORY.formatProfile;
}

/**
 * F4 W1: the CardCategory of one card object, every field explicit. Reads
 * reserved, released_at, edhrec_rank, legalities and digital only. Never
 * throws and never reads the clock: age is measured at the caller's asOf.
 */
export function classify(
  card: ClassifiableCard | null | undefined,
  asOf: string,
  params: RecommendationParams = RECOMMENDATION_PARAMS,
): CardCategory {
  const fields: ClassifiableCard =
    card !== null && typeof card === "object" ? card : {};
  return {
    reservedList: fields.reserved === true,
    age: ageOf(fields.released_at, asOf, params),
    popularity: popularityOf(fields.edhrec_rank, params),
    formatProfile: formatProfileOf(fields.legalities),
    digital: fields.digital === true,
  };
}

/** One recommendation with its signals' category set; nothing else changes. */
const categorized = (
  recommendation: Recommendation,
  category: CardCategory,
): Recommendation => ({
  ...recommendation,
  signals: { ...recommendation.signals, category },
});

/**
 * Both tiers with signals.category set (S4.1d6): tier1, and tier2 when it
 * exists. Pure: the inputs are not mutated, and kind, confidence, reason and
 * every other signal are carried over unchanged. servedRecommendation runs
 * after it, so the served result, the tiers and the panel agree.
 */
export function withCategory(
  tiers: TieredRecommendation,
  category: CardCategory,
): TieredRecommendation {
  return {
    tier1: categorized(tiers.tier1, category),
    tier2: tiers.tier2 === null ? null : categorized(tiers.tier2, category),
  };
}
