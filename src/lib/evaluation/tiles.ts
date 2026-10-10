// The four signal tiles' values (S2.1d9; F2 §UI): delta vs market, 30-day
// trend, 30-day range position and volatility. Pure formatting over the
// engine's signals; a null signal is "—", with the thin-data note only when
// the window holds fewer snapshots than that signal's minimum.
import { TILE_CAPTIONS, TILE_LABELS } from "@/lib/copy/result-labels";
import { RECOMMENDATION_PARAMS } from "@/lib/recommendation/params";
import type { RecommendationSignals } from "@/lib/recommendation/types";

/** A null signal's value (F2 §UI, F1 UI strings: the tile "renders —"). */
export const EMPTY_TILE_VALUE = "—";

/** The minus sign for negative percentages. */
const MINUS = "−";

export type TileId = keyof typeof TILE_LABELS;

export interface Tile {
  readonly id: TileId;
  readonly label: string;
  /** The formatted value, or EMPTY_TILE_VALUE. */
  readonly value: string;
  /** A caption under the value (market price, low and high), or null. */
  readonly caption: string | null;
  /** Show UI_COPY.thinDataNote: the value is null on a thin window. */
  readonly thinData: boolean;
}

/** Integer cents as dollars, "$1,234.50"; integer math, no Intl. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? MINUS : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${dollars}.${rest}`;
}

/** A percentage with one decimal and a sign: "+5.0%", "−8.7%", "0.0%". */
export function signedPct(value: number): string {
  const tenths = Math.round(value * 10);
  if (tenths === 0) return "0.0%";
  const text = (Math.abs(tenths) / 10).toFixed(1);
  return `${tenths > 0 ? "+" : MINUS}${text}%`;
}

/** The four tiles for a buy, fair or wait result, in F2's order. */
export function signalTiles(signals: RecommendationSignals): Tile[] {
  const params = RECOMMENDATION_PARAMS;
  const count = signals.snapshotCount30d;
  const range = signals.range30dCents;

  const delta: Tile = {
    id: "delta",
    label: TILE_LABELS.delta,
    value:
      signals.deltaPct === null
        ? EMPTY_TILE_VALUE
        : signedPct(signals.deltaPct),
    caption:
      signals.marketPriceCents === null
        ? null
        : `${TILE_CAPTIONS.market} ${formatCents(signals.marketPriceCents)}`,
    thinData: false,
  };

  // F1's monthly trend: the 30-day slope in percent per day, times 30.
  const trend: Tile = {
    id: "trend",
    label: TILE_LABELS.trend,
    value:
      signals.slope30dPct === null
        ? EMPTY_TILE_VALUE
        : signedPct(signals.slope30dPct * params.windowDays),
    caption: null,
    thinData:
      signals.slope30dPct === null && count < params.minSnapshotsForTrend,
  };

  const rangeTile: Tile = {
    id: "range",
    label: TILE_LABELS.range,
    value:
      signals.rangePosition === null
        ? EMPTY_TILE_VALUE
        : `${Math.round(signals.rangePosition * 100)}%`,
    caption:
      range === null
        ? null
        : `${TILE_CAPTIONS.low} ${formatCents(range.low)} · ${TILE_CAPTIONS.high} ${formatCents(range.high)}`,
    // A flat range (high equals low) is null on a full window: not thin.
    thinData:
      signals.rangePosition === null && count < params.minSnapshotsForRange,
  };

  const volatility: Tile = {
    id: "volatility",
    label: TILE_LABELS.volatility,
    value:
      signals.volatility30d === null
        ? EMPTY_TILE_VALUE
        : `±${Math.round(signals.volatility30d * 100)}%`,
    caption: null,
    thinData:
      signals.volatility30d === null &&
      count < params.minSnapshotsForVolatility,
  };

  return [delta, trend, rangeTile, volatility];
}
