// F1's descriptive signals (S1.2d8; F1 "Signal definitions"). F1/S1.2
// computes every signal; F3 only changes whether they influence the verdict.
// Median, range, range position and volatility use real rows only. Slopes use
// the gap-interpolated series, for slope computation only, with nothing
// extrapolated past the first or last real row.
import { withoutNegativeZero } from "./bands";
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

interface SeriesPoint {
  readonly x: number;
  readonly y: number;
}

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

const mean = (values: readonly number[]) => sum(values) / values.length;

/** Lower median for even counts, so the result is one of the inputs (an integer). */
function lowerMedian(prices: readonly number[]): number {
  const sorted = [...prices].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

/** Population standard deviation over the mean. */
function coefficientOfVariation(prices: readonly number[]): number {
  const mu = mean(prices);
  const variance = mean(prices.map((price) => (price - mu) ** 2));
  return Math.sqrt(variance) / mu;
}

/**
 * The series from the first to the last real index, one point per window
 * index, with each gap filled by linear interpolation between its real
 * neighbours (floats, unrounded). Never extrapolates.
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
        // Integer products, then one division: a single rounding per point.
        points.push({
          x,
          y: (previous.priceCents * (span - k) + current.priceCents * k) / span,
        });
      }
    }
    points.push({ x: current.index, y: current.priceCents });
  });
  return points;
}

/**
 * OLS slope of y on x, divided by the mean of the same y values, in percent
 * per day. Null with fewer than two points.
 */
export function slopePct(points: readonly SeriesPoint[]): number | null {
  if (points.length < 2) return null;
  const xBar = mean(points.map((p) => p.x));
  const yBar = mean(points.map((p) => p.y));
  const sxy = sum(points.map((p) => (p.x - xBar) * (p.y - yBar)));
  const sxx = sum(points.map((p) => (p.x - xBar) ** 2));
  const slope = sxy / sxx;
  return withoutNegativeZero((slope * PERCENT) / yBar);
}

function trendOf(
  slope30dPct: number | null,
  params: RecommendationParams,
): TrendDirection | null {
  if (slope30dPct === null) return null;
  if (slope30dPct > params.trendThresholdPct) return "rising";
  if (slope30dPct < -params.trendThresholdPct) return "falling";
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
    ? { low, high, avg: Math.round(mean(prices)) }
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
  const slope30dPct = hasTrend ? slopePct(series) : null;
  const slope7dPct = hasTrend
    ? slopePct(series.filter((p) => p.x >= shortFrom))
    : null;

  return {
    median30dCents: hasRange ? lowerMedian(prices) : null,
    range30dCents,
    rangePosition,
    slope7dPct,
    slope30dPct,
    volatility30d:
      count >= params.minSnapshotsForVolatility
        ? withoutNegativeZero(coefficientOfVariation(prices))
        : null,
    snapshotCount30d: count,
    trendDirection: trendOf(slope30dPct, params),
  };
}
