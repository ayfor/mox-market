import "server-only";

// F1 Tier-1 price-only engine (S1.2) and F3's tiered entry (S3.1). Pure: no
// React, Next, clock or randomness, and inputs are never mutated. Money is
// integer cents. Check order (F1 W1 step 2b, S1.2d2): validate the input
// (throws), then the market snapshot's shape and applied finish, the window,
// the market price, the window count, then bands. One tiered call computes
// Tier 1 by that path and Tier 2 from it (tier2.ts); TIER2_ENABLED picks the
// served one (S3.1d3). Tier 1's signals carry F3's shock annotation
// (shock.ts), so the served result has it whatever the flag says (S3.2d7).
import {
  BP_PER_PCT,
  bandKind,
  deltaBpOf,
  thresholdsBp,
  withoutNegativeZero,
} from "./bands";
import { RECOMMENDATION_PARAMS, type RecommendationParams } from "./params";
import { buildReason } from "./reason";
import { shockAnnotationOf } from "./shock";
import {
  computeHistorySignals,
  exactSlopePct,
  interpolatedSeries,
} from "./signals";
import { computeTier2, latestAgeDays } from "./tier2";
import type {
  Confidence,
  Finish,
  MarketSnapshot,
  Recommendation,
  RecommendationInput,
  RecommendationKind,
  TieredRecommendation,
} from "./types";
import { validateRecommendationInput } from "./validate";
import { readWindow, type WindowSnapshot } from "./window";

/** Tier 1 never widens the band; Tier 2 sets its own (tier2.ts). */
const TIER1_WIDENING_FACTOR = 1;

/** The caller's only fallback finish; normal never falls back (C1.21). */
const FALLBACK_FINISH: Finish = "normal";

/**
 * The market snapshot when it is usable, else an empty one, so the result is
 * insufficient_data and never a throw (D1, D5). Usable means an object whose
 * appliedFinish is the requested finish or the normal fallback (C1.21): a
 * missing, misspelt or other applied finish leaves the price and history of
 * an unknown finish, which is a market-data problem.
 */
function usableMarket(
  market: unknown,
  requested: Finish,
): Partial<MarketSnapshot> {
  if (market === null || typeof market !== "object") return {};
  const snapshot = market as Partial<MarketSnapshot>;
  return snapshot.appliedFinish === requested ||
    snapshot.appliedFinish === FALLBACK_FINISH
    ? snapshot
    : {};
}

/** A market price is usable only as a positive safe integer (S1.2d5). */
const usableMarketPrice = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : null;

/** Under 14 window snapshots low, under 28 medium, else high (S1.2d7). */
function confidenceFor(
  count: number,
  params: RecommendationParams,
): Confidence {
  if (count < params.lowConfidenceSnapshotCount) return "low";
  if (count < params.highConfidenceSnapshotCount) return "medium";
  return "high";
}

/** Tier 1, the window it was computed from and the usable snapshot. */
interface Tier1Result {
  readonly tier1: Recommendation;
  readonly windowSnapshots: readonly WindowSnapshot[];
  readonly snapshot: Partial<MarketSnapshot>;
}

/** F1 W1: the Tier-1 recommendation, by S1.2's path unchanged. */
function computeTier1(
  input: RecommendationInput,
  market: MarketSnapshot,
  params: RecommendationParams,
): Tier1Result {
  validateRecommendationInput(input);

  const snapshot = usableMarket(market, input.finish);
  const windowSnapshots = readWindow(
    snapshot.history,
    snapshot.asOf,
    params.windowDays,
  );
  const count = windowSnapshots.length;
  const marketPriceCents = usableMarketPrice(snapshot.currentPriceCents);
  const thresholds = thresholdsBp(params);
  const deltaBp =
    marketPriceCents === null
      ? null
      : deltaBpOf(input.askingPriceCents, marketPriceCents);

  const kind: RecommendationKind =
    deltaBp === null || count < params.minSnapshotsForVerdict
      ? "insufficient_data"
      : bandKind(deltaBp, thresholds);
  const confidence: Confidence =
    kind === "insufficient_data" ? "low" : confidenceFor(count, params);

  const tier1: Recommendation = {
    kind,
    confidence,
    reason: buildReason({
      kind,
      deltaBp,
      bandPct: params.fairBandPct,
      confidence,
      snapshotCount30d: count,
    }),
    signals: {
      deltaPct:
        deltaBp === null ? null : withoutNegativeZero(deltaBp / BP_PER_PCT),
      deltaBp,
      marketPriceCents,
      ...computeHistorySignals(windowSnapshots, input.askingPriceCents, params),
      fallbackNotice:
        snapshot.appliedFinish !== input.finish && kind !== "insufficient_data",
      bandPct: params.fairBandPct,
      wideningFactor: TIER1_WIDENING_FACTOR,
      buyThresholdPct: withoutNegativeZero(thresholds.buyBp / BP_PER_PCT),
      waitThresholdPct: withoutNegativeZero(thresholds.waitBp / BP_PER_PCT),
      // F3: on the badge, so none on the insufficient_data panel (S3.2d7).
      shockAnnotation:
        kind === "insufficient_data"
          ? null
          : shockAnnotationOf(windowSnapshots, params),
      // F4: the engine has no card; buildEvaluation classifies (S4.1d6).
      category: null,
    },
  };
  return { tier1, windowSnapshots, snapshot };
}

/**
 * Both tiers for one input (validated once). Tier 2 reads Tier 1's exact
 * 30-day slope, recomputed from the same window, only when Tier 1 has a
 * verdict and a trend, and the newest history row's age (S3.2d4, ADV
 * SPEC-1).
 */
function tiersFor(
  input: RecommendationInput,
  market: MarketSnapshot,
  params: RecommendationParams,
): TieredRecommendation {
  const { tier1, windowSnapshots, snapshot } = computeTier1(
    input,
    market,
    params,
  );
  const slope30d =
    tier1.kind === "insufficient_data" || tier1.signals.slope30dPct === null
      ? null
      : exactSlopePct(interpolatedSeries(windowSnapshots));
  return {
    tier1,
    tier2: computeTier2(
      tier1,
      slope30d,
      latestAgeDays(
        snapshot.history,
        snapshot.asOf ?? "",
        windowSnapshots,
        params,
      ),
      params,
    ),
  };
}

/** The served tier: Tier 2 when enabled and present, else Tier 1. */
function served(
  tiers: TieredRecommendation,
  params: RecommendationParams,
): Recommendation {
  return params.TIER2_ENABLED ? (tiers.tier2 ?? tiers.tier1) : tiers.tier1;
}

/**
 * F3 Engine API (S3.1d3): Tier 1 (F1's price-only result) and Tier 2 (F3's
 * adjusted thresholds, null only when Tier 1 is insufficient_data). Throws
 * InvalidRecommendationInputError exactly as computeRecommendation does.
 */
export function computeTieredRecommendation(
  input: RecommendationInput,
  market: MarketSnapshot,
  params: RecommendationParams = RECOMMENDATION_PARAMS,
): TieredRecommendation {
  return tiersFor(input, market, params);
}

/**
 * The served recommendation of a tiered result under the shipped params:
 * Tier 1 while TIER2_ENABLED is false. Takes no params, so production code
 * computes only with RECOMMENDATION_PARAMS (S1.3 ADV-3).
 */
export function servedRecommendation(
  tiers: TieredRecommendation,
): Recommendation {
  return served(tiers, RECOMMENDATION_PARAMS);
}

/**
 * Buy / Fair / Wait for an asking price against the market (F1 W1): the
 * served tier (Tier 1 while TIER2_ENABLED is false).
 * Throws InvalidRecommendationInputError only for invalid user input (the
 * asking price, or a finish outside FINISHES); a market-data problem is
 * insufficient_data, never a throw.
 */
export function computeRecommendation(
  input: RecommendationInput,
  market: MarketSnapshot,
  params: RecommendationParams = RECOMMENDATION_PARAMS,
): Recommendation {
  return served(tiersFor(input, market, params), params);
}
