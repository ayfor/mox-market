// F1's descriptive signals (S1.2d8; F1 "Signal definitions"). F1/S1.2
// computes every signal; F3 only changes whether they influence the verdict.
// Median, range, range position and volatility use real rows only. Slopes use
// the gap-interpolated series, for slope computation only, with nothing
// extrapolated past the first or last real row.
import { BP_PER_PCT, trendThresholdBp, withoutNegativeZero } from "./bands";
import type { RecommendationParams } from "./params";
import type { PriceRange, TrendDirection } from "./types";
import type { WindowSnapshot } from "./window";

export interface HistorySignals {
  median30dCents: number | null;
  range30dCents: PriceRange | null;
  rangePosition: number | null;
  slope7dPct: number | null;
  slope30dPct: number | null;
  volatility30d: number | null;
  snapshotCount30d: number;
  trendDirection: TrendDirection | null;
}

/** A ratio times this is a percentage. */
const PERCENT = 100;

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

/**
 * One point of the slope series. Its price is exactly num / den cents: den
 * is the gap's span for an interpolated point and 1 for a real row, so the
 * slope is computed from integers and never from rounded floats (ADV-1).
 */
export interface SeriesPoint {
  readonly x: number;
  readonly num: bigint;
  readonly den: bigint;
}

/** An exact fraction num / den in lowest terms, with den > 0. */
export interface ExactRatio {
  readonly num: bigint;
  readonly den: bigint;
}

const absBig = (value: bigint) => (value < ZERO ? -value : value);

function gcd(a: bigint, b: bigint): bigint {
  let x = absBig(a);
  let y = absBig(b);
  while (y !== ZERO) [x, y] = [y, x % y];
  return x;
}

const lcm = (a: bigint, b: bigint) => (a / gcd(a, b)) * b;

/** The double nearest an exact ratio; an exact zero is +0, never −0. */
export const ratioToNumber = (ratio: ExactRatio): number =>
  ratio.num === ZERO
    ? 0
    : withoutNegativeZero(Number(ratio.num) / Number(ratio.den));

/** Lower median for even counts, so the result is one of the inputs (an integer). */
function lowerMedian(prices: readonly number[]): number {
  const sorted = [...prices].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

/**
 * Σp and Σp² as exact integers. A history price is any positive safe
 * integer, so a 30-day sum can pass 2^53 and a double would drop cents
 * (CODEX.1); every price statistic is taken from these sums.
 */
function exactSums(prices: readonly number[]): { s: bigint; ss: bigint } {
  let s = ZERO;
  let ss = ZERO;
  for (const price of prices) {
    const p = BigInt(price);
    s += p;
    ss += p * p;
  }
  return { s, ss };
}

/**
 * Math.round(Σp / n) without a rounded sum (CODEX.1): for a positive mean,
 * floor(Σp / n + 1/2) = floor((2Σp + n) / 2n). The result lies between the
 * lowest and highest price, so it is a safe integer.
 */
function roundedMeanCents(prices: readonly number[]): number {
  const n = BigInt(prices.length);
  return Number((TWO * exactSums(prices).s + n) / (TWO * n));
}

/**
 * Population standard deviation over the mean, as
 * sqrt(nΣp² − (Σp)²) / Σp: the radicand is an exact integer, so equal prices
 * give exactly 0 at any safe price and the result is within a few ulps of the
 * true ratio (CODEX.1).
 */
function coefficientOfVariation(prices: readonly number[]): number {
  const n = BigInt(prices.length);
  const { s, ss } = exactSums(prices);
  return Math.sqrt(Number(n * ss - s * s)) / Number(s);
}

/**
 * The series from the first to the last real index, one point per window
 * index, with each gap filled by linear interpolation between its real
 * neighbours, kept as exact fractions. Never extrapolates.
 */
export function interpolatedSeries(
  snapshots: readonly WindowSnapshot[],
): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  snapshots.forEach((current, i) => {
    const previous = i === 0 ? null : snapshots[i - 1];
    if (previous !== null) {
      const span = current.index - previous.index;
      for (let x = previous.index + 1; x < current.index; x += 1) {
        const k = x - previous.index;
        // (y0 × (span − k) + y1 × k) / span, held as an integer over span.
        points.push({
          x,
          num:
            BigInt(previous.priceCents) * BigInt(span - k) +
            BigInt(current.priceCents) * BigInt(k),
          den: BigInt(span),
        });
      }
    }
    points.push({
      x: current.index,
      num: BigInt(current.priceCents),
      den: ONE,
    });
  });
  return points;
}

/**
 * OLS slope of y on x, divided by the mean of the same y values, in percent
 * per day, as an exact fraction from integer sums (ADV-1):
 * 100 · n · (nΣxy − ΣxΣy) / ((nΣx² − (Σx)²) · Σy), with every y scaled by
 * the lcm of the gap spans so each sum is an integer. Null with fewer than
 * two points. Prices are positive and x values distinct, so den > 0.
 */
export function exactSlopePct(
  points: readonly SeriesPoint[],
): ExactRatio | null {
  if (points.length < 2) return null;
  const scale = points.reduce((common, p) => lcm(common, p.den), ONE);
  const n = BigInt(points.length);
  let sx = ZERO;
  let sxx = ZERO;
  let sy = ZERO;
  let sxy = ZERO;
  for (const p of points) {
    const x = BigInt(p.x);
    const y = p.num * (scale / p.den);
    sx += x;
    sxx += x * x;
    sy += y;
    sxy += x * y;
  }
  const num = BigInt(PERCENT) * n * (n * sxy - sx * sy);
  const den = (n * sxx - sx * sx) * sy;
  const divisor = gcd(num, den);
  return { num: num / divisor, den: den / divisor };
}

/** exactSlopePct as the nearest double; null with fewer than two points. */
export function slopePct(points: readonly SeriesPoint[]): number | null {
  const exact = exactSlopePct(points);
  return exact === null ? null : ratioToNumber(exact);
}

/**
 * Rising iff slope30dPct > trendThresholdPct, falling iff below its
 * negative, else flat (C1.10 = A: strict). Decided on the exact slope
 * against the threshold in whole bp, as C1.41 = A compares the bands, so a
 * float error never flips the label at the boundary (ADV-1).
 */
function trendOf(
  slope30d: ExactRatio | null,
  params: RecommendationParams,
): TrendDirection | null {
  if (slope30d === null) return null;
  const slopeBpTimesDen = slope30d.num * BigInt(BP_PER_PCT);
  const limit = BigInt(trendThresholdBp(params)) * slope30d.den;
  if (slopeBpTimesDen > limit) return "rising";
  if (slopeBpTimesDen < -limit) return "falling";
  return "flat";
}

/**
 * Every history-derived signal for the window's real snapshots (oldest
 * first) and the asking price. Each is null below its minimum.
 */
export function computeHistorySignals(
  snapshots: readonly WindowSnapshot[],
  askingPriceCents: number,
  params: RecommendationParams,
): HistorySignals {
  const count = snapshots.length;
  const prices = snapshots.map((s) => s.priceCents);

  const hasRange = count >= params.minSnapshotsForRange;
  const low = hasRange ? Math.min(...prices) : 0;
  const high = hasRange ? Math.max(...prices) : 0;
  const range30dCents: PriceRange | null = hasRange
    ? { low, high, avg: roundedMeanCents(prices) }
    : null;
  const rangePosition =
    hasRange && high !== low
      ? withoutNegativeZero(
          Math.min(1, Math.max(0, (askingPriceCents - low) / (high - low))),
        )
      : null;

  const hasTrend = count >= params.minSnapshotsForTrend;
  const series = hasTrend ? interpolatedSeries(snapshots) : [];
  const shortFrom = params.windowDays - params.shortSlopeDays;
  const exact30d = hasTrend ? exactSlopePct(series) : null;
  const slope7dPct = hasTrend
    ? slopePct(series.filter((p) => p.x >= shortFrom))
    : null;

  return {
    median30dCents: hasRange ? lowerMedian(prices) : null,
    range30dCents,
    rangePosition,
    slope7dPct,
    slope30dPct: exact30d === null ? null : ratioToNumber(exact30d),
    volatility30d:
      count >= params.minSnapshotsForVolatility
        ? withoutNegativeZero(coefficientOfVariation(prices))
        : null,
    snapshotCount30d: count,
    trendDirection: trendOf(exact30d, params),
  };
}
