// Tier-1 reason sentence from F1's locked copy table (S1.2d9; C1.24, C1.41 = A).
// Observed facts only. X = Math.round(Math.abs(deltaBp) / 100); fair with X 0
// reads "At market price", and a below clause or a falling trend clause
// reads at most 99% (D8; S3.1d16). A low confidence adds the thin-data caveat on buy,
// fair and wait alike (Josh's sequence review ruling, 2026-10-08). Tier 2 may
// add one trend clause, after the primary clause and before the caveat
// (F1 composition rule; S3.1d7), and fills the single caveat slot by
// precedence stale > thin-data > volatility (S3.2d5); Tier 1 passes none of
// trend, stale or volatility, so its reasons are S1.2's.
import { BP_PER_PCT } from "./bands";
import {
  CLAUSE_SEPARATOR,
  fillTemplate,
  REASON_COPY,
  SENTENCE_END,
} from "./copy";
import type { Confidence, RecommendationKind, TrendDirection } from "./types";

/** F3's trend clause: a rising or falling 30-day trend of X percent. */
export interface TrendClause {
  readonly direction: Exclude<TrendDirection, "flat">;
  /**
   * Math.round(|slope30dPct × windowDays|), from the raw (unclamped) slope.
   * buildReason states a falling X of at most 99 (S3.1d16).
   */
  readonly X: number;
}

export interface ReasonInput {
  readonly kind: RecommendationKind;
  /** Null only when the kind is insufficient_data. */
  readonly deltaBp: number | null;
  /** The effective fair-band half-width, in percent. */
  readonly bandPct: number;
  readonly confidence: Confidence;
  readonly snapshotCount30d: number;
  /** Tier 2 only (S3.1d7); absent on every Tier-1 reason. */
  readonly trend?: TrendClause;
  /**
   * Tier 2 only (S3.2d5): the newest row is d UTC days old, more than
   * staleDays. Takes the caveat slot first.
   */
  readonly stale?: { readonly d: number };
  /**
   * Tier 2 only (S3.2d5): volWiden > 1, X = Math.round(volatility30d × 100).
   * Takes the caveat slot only when neither stale nor low confidence does.
   */
  readonly volatility?: { readonly X: number };
}

/** 100%: the whole market price. */
const WHOLE_PCT = 100;

/**
 * The largest X a below clause states. A valid asking price is at least one
 * cent, so it is never 100% below market, although deltaBp from −9950 down
 * rounds X to 100 (ADV-4, D8).
 */
const MAX_BELOW_X = WHOLE_PCT - 1;

function primaryClause(
  kind: RecommendationKind,
  deltaBp: number,
  bandPct: number,
) {
  const X = Math.round(Math.abs(deltaBp) / BP_PER_PCT);
  if (kind === "fair") {
    if (X === 0) return REASON_COPY.atMarket;
    if (Math.abs(deltaBp) <= Math.round(bandPct * BP_PER_PCT)) {
      return fillTemplate(REASON_COPY.within, { X });
    }
  }
  const below = kind === "buy" || (kind === "fair" && deltaBp < 0);
  return below
    ? fillTemplate(REASON_COPY.below, { X: Math.min(X, MAX_BELOW_X) })
    : fillTemplate(REASON_COPY.above, { X });
}

/**
 * F3's trend clause. A falling clause states at most 99%, as a below clause
 * does: a price cannot fall 100% or more, although monthlyTrend (the OLS
 * slope over the window mean × windowDays) passes −100 on a crash (S3.1
 * ADV UB-1, S3.1d16). A rising clause is never capped.
 */
function trendClause({ direction, X }: TrendClause) {
  return fillTemplate(REASON_COPY.trend, {
    direction,
    X: direction === "falling" ? Math.min(X, MAX_BELOW_X) : X,
  });
}

/**
 * The one caveat, by F1's precedence stale > thin-data > volatility
 * (S3.2d5), or null.
 */
function caveatClause(input: ReasonInput): string | null {
  if (input.stale !== undefined) {
    return fillTemplate(REASON_COPY.stale, { d: input.stale.d });
  }
  if (input.confidence === "low") {
    return fillTemplate(REASON_COPY.thinData, { n: input.snapshotCount30d });
  }
  if (input.volatility !== undefined) {
    return fillTemplate(REASON_COPY.volatility, { X: input.volatility.X });
  }
  return null;
}

/** One sentence for the recommendation; insufficient_data ignores every other field. */
export function buildReason(input: ReasonInput): string {
  if (input.kind === "insufficient_data" || input.deltaBp === null) {
    return REASON_COPY.insufficientData;
  }
  const clauses = [primaryClause(input.kind, input.deltaBp, input.bandPct)];
  if (input.trend !== undefined) {
    clauses.push(trendClause(input.trend));
  }
  const caveat = caveatClause(input);
  if (caveat !== null) clauses.push(caveat);
  return clauses.join(CLAUSE_SEPARATOR) + SENTENCE_END;
}
