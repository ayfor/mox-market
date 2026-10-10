// F1 Tier-1 price-only engine (S1.2). Pure: no React, Next, clock or
// randomness, and inputs are never mutated. Money is integer cents.
// Check order (F1 W1 step 2b, S1.2d2): validate the input (throws), then the
// market snapshot's shape and applied finish, the window, the market price,
// the window count, then bands.
import {
  BP_PER_PCT,
  bandKind,
  deltaBpOf,
  thresholdsBp,
  withoutNegativeZero,
} from "./bands";
import { RECOMMENDATION_PARAMS, type RecommendationParams } from "./params";
import { buildReason } from "./reason";
import { computeHistorySignals } from "./signals";
import type {
  Confidence,
  Finish,
  MarketSnapshot,
  Recommendation,
  RecommendationInput,
  RecommendationKind,
} from "./types";
import { validateRecommendationInput } from "./validate";
import { readWindow } from "./window";

/** Tier 1 never widens the band (F3 sets this from S3.1). */
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

/**
 * Buy / Fair / Wait for an asking price against the market (F1 W1).
 * Throws InvalidRecommendationInputError only for invalid user input (the
 * asking price, or a finish outside FINISHES); a market-data problem is
 * insufficient_data, never a throw.
 */
export function computeRecommendation(
  input: RecommendationInput,
  market: MarketSnapshot,
  params: RecommendationParams = RECOMMENDATION_PARAMS,
): Recommendation {
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

  return {
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
    },
  };
}
