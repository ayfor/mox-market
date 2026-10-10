// Tier-1 reason sentence from F1's locked copy table (S1.2d9; C1.24, C1.41 = A).
// Observed facts only. X = Math.round(Math.abs(deltaBp) / 100); fair with X 0
// reads "At market price", and a below clause reads at most 99% (D8). A low confidence adds the thin-data caveat on buy,
// fair and wait alike (Josh's sequence review ruling, 2026-10-08).
import { BP_PER_PCT } from "./bands";
import {
  CLAUSE_SEPARATOR,
  fillTemplate,
  REASON_COPY,
  SENTENCE_END,
} from "./copy";
import type { Confidence, RecommendationKind } from "./types";

export interface ReasonInput {
  readonly kind: RecommendationKind;
  /** Null only when the kind is insufficient_data. */
  readonly deltaBp: number | null;
  /** The effective fair-band half-width, in percent. */
  readonly bandPct: number;
  readonly confidence: Confidence;
  readonly snapshotCount30d: number;
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

/** One sentence for the recommendation; insufficient_data ignores every other field. */
export function buildReason(input: ReasonInput): string {
  if (input.kind === "insufficient_data" || input.deltaBp === null) {
    return REASON_COPY.insufficientData;
  }
  const clauses = [primaryClause(input.kind, input.deltaBp, input.bandPct)];
  if (input.confidence === "low") {
    clauses.push(
      fillTemplate(REASON_COPY.thinData, { n: input.snapshotCount30d }),
    );
  }
  return clauses.join(CLAUSE_SEPARATOR) + SENTENCE_END;
}
