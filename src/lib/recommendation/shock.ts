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
 * A finite number as the exact decimal fraction it was written as, from its
 * shortest round-trip form (35.005 → 35005 / 1000; 1e-7 → 1 / 10000000), so
 * a tuned threshold is compared as configured, never rounded (Codex P2 on
 * PR #21). Throws on NaN or ±Infinity, as BigInt does.
 */
export function decimalRatio(x: number): { num: bigint; den: bigint } {
  const [mantissa, exponent = "0"] = String(x).split(/e/i);
  const [whole, fraction = ""] = mantissa.split(/\./);
  const shift = Number(exponent) - fraction.length;
  const digits = BigInt(whole + fraction);
  const power = (n: number) => BigInt(`1${"0".repeat(n)}`);
  return shift >= 0
    ? { num: digits * power(shift), den: BigInt(1) }
    : { num: digits, den: power(-shift) };
}

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
  // |latest − ref| × 100 ≥ shockMagnitudePct × ref, with shockMagnitudePct
  // as its exact decimal num / den so the comparison stays in integers at
  // any precision: |latest − ref| × 100 × den ≥ num × ref.
  const threshold = decimalRatio(params.shockMagnitudePct);
  if (
    absMove * BigInt(PERCENT) * threshold.den <
    threshold.num * BigInt(ref.priceCents)
  ) {
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
