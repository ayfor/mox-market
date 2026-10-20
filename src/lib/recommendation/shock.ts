// F3's shock annotation (S3.2d6; C1.55): sevenDayMovePct over the window's
// real rows. latest = the newest real window row; ref = the newest real
// window row dated at least shockWindowDays before latest; no ref, no
// annotation. Pure: no React, Next, clock or randomness. The trigger
// compares exact integers, so a move of exactly ±shockMagnitudePct fires.
// The annotation never feeds kind, confidence or reason (F3: verdict
// unchanged).
import type { RecommendationParams } from "./params";
import type { ShockAnnotation } from "./types";
import type { WindowSnapshot } from "./window";

/** A ratio times this is a percentage. */
const PERCENT = 100;

/**
 * The shock annotation for the window's real rows (oldest first), or null
 * when there is no ref row or the move is under shockMagnitudePct.
 */
export function shockAnnotationOf(
  windowSnapshots: readonly WindowSnapshot[],
  params: RecommendationParams,
): ShockAnnotation | null {
  const latest = windowSnapshots.at(-1);
  if (latest === undefined) return null;
  const refIndex = latest.index - params.shockWindowDays;
  const ref = windowSnapshots.findLast((s) => s.index <= refIndex);
  if (ref === undefined) return null;
  const move = BigInt(latest.priceCents) - BigInt(ref.priceCents);
  const absMove = move < BigInt(0) ? -move : move;
  // |latest − ref| × 100 ≥ shockMagnitudePct × ref, with the threshold
  // scaled to whole hundredths so the comparison stays in integers.
  const scale = BigInt(PERCENT);
  const threshold = BigInt(Math.round(params.shockMagnitudePct * PERCENT));
  if (absMove * scale * scale < threshold * BigInt(ref.priceCents)) {
    return null;
  }
  // Integer cents: latest − ref is +0 when equal, never −0, and ref > 0,
  // so the magnitude is never −0 (S3.2 ADV TC-1).
  return {
    detected: true,
    magnitude:
      ((latest.priceCents - ref.priceCents) * PERCENT) / ref.priceCents,
    window: params.shockWindowDays,
  };
}
