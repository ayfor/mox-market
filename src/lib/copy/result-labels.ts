// Labels on the result surface that F1's locked UI-strings table does not
// word (S2.1d11): badge words, confidence chips, tile titles and captions,
// field and button labels, the skeleton's accessible name and the relative
// time words. Labels, not locked copy, so no F1 row changes; S1.3's
// forbidden-phrase lint and copy hygiene cover this module like every module
// under src/lib/copy. Josh can overturn: lock them in F1's table. String
// literals only, so client components may import it.

/** The badge word for each recommendation kind but insufficient_data. */
export const KIND_LABELS = Object.freeze({
  buy: "Buy",
  fair: "Fair",
  wait: "Wait",
} as const);

/**
 * The glyph beside the confidence chip when the served result carries F3's
 * shock annotation (F3 §UI, S3.2d9). A glyph, not words: its accessible name
 * and tooltip are F1's locked SHOCK_TOOLTIP, filled (S3.2d10).
 */
export const SHOCK_ICON = "⚠️";

/** The confidence chip for each confidence level. */
export const CONFIDENCE_LABELS = Object.freeze({
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
} as const);

/** The four signal tiles' titles. */
export const TILE_LABELS = Object.freeze({
  delta: "Vs market",
  trend: "30-day trend",
  range: "30-day range",
  volatility: "Volatility",
} as const);

/** Captions under tile values. */
export const TILE_CAPTIONS = Object.freeze({
  market: "Market",
  low: "Low",
  high: "High",
} as const);

/**
 * The entry form's field and button labels, and the retry button. The card
 * field reads "Card" on the entry form and the landing form alike (S2.4
 * AC-10): one string has one home (S1.3 T19).
 */
export const FORM_LABELS = Object.freeze({
  card: "Card",
  price: "Your price",
  submit: "Evaluate",
  retry: "Retry",
} as const);

/**
 * The entry forms' optional Set picker (UI patch 2026-10-30): its label, the
 * default option (no printing chosen), and the default option's text while
 * the card's sets load or when they could not be fetched.
 */
export const SET_PICKER_LABELS = Object.freeze({
  label: "Set",
  any: "Any set",
  loading: "Loading sets",
  unavailable: "Sets unavailable",
} as const);

/** The skeleton's accessible name while a recommendation loads. */
export const LOADING_LABEL = "Loading recommendation";

/** Relative time units, singular and plural, and the word after them (S2.1d12). */
export const RELATIVE_TIME_WORDS = Object.freeze({
  minute: "minute",
  minutes: "minutes",
  hour: "hour",
  hours: "hours",
  day: "day",
  days: "days",
  ago: "ago",
} as const);
