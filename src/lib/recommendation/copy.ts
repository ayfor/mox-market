// F1's Locked copy table (S1.3, AC-1; S1.2d9): every reason template, clause
// and notice the engine or the result page shows, as frozen literals. The one
// source: reason.ts assembles every reason from these, and copy.test.ts pins
// each string to F1's table. Changing a string needs a plan-doc deviation and
// Josh's ruling (AGENTS.md Thresholds and copy). F2's UI strings live in the
// sibling ui-copy.ts; the legal strings and the source label in
// src/lib/copy/legal.ts. The forbidden-phrase lint (forbidden-phrases.ts)
// runs over all three. This module imports nothing.

export const REASON_COPY = Object.freeze({
  /** The insufficient_data sentence, verbatim (U+2014 em dash, straight apostrophe). */
  insufficientData:
    "We don't have enough pricing data on this printing to give a recommendation — try a different printing.",
  /** Fair when X is 0. */
  atMarket: "At market price",
  /** Fair when |deltaBp| ≤ Math.round(bandPct × 100) (C1.41 = A). */
  within: "Within {X}% of market",
  /** Buy, and fair below the band. X is at most 99 (S1.2 D8). */
  below: "{X}% below market",
  /** Wait, and fair above the band. */
  above: "{X}% above market",
  /** The thin-data caveat, whenever confidence is low; n = snapshotCount30d. */
  thinData: "only {n} price snapshots",
  /** F3 caveat (C1.12 = A): no caller until S3.1 (S1.3d2). */
  stale: "latest price data is {d} days old",
  /** F3 trend clause, direction "rising" or "falling": no caller until S3.1. */
  trend: "30-day trend is {direction} {X}%",
  /** F3 caveat, X = Math.round(volatility30d × 100): no caller until S3.1. */
  volatility: "price has been volatile (±{X}%)",
} as const);

/**
 * Shown when signals.fallbackNotice is true; finish takes the requested
 * finish's FINISH_LABELS entry, so "Foil" (S1.3d5).
 */
export const FALLBACK_NOTICE =
  "This printing has no {finish} price — showing Normal pricing.";

/** F3 shock tooltip, signedX like "+12" or "−12": no caller until S3.1. */
export const SHOCK_TOOLTIP = "Price moved {signedX}% over the last 7 days.";

/** Joins the primary clause and the caveat. */
export const CLAUSE_SEPARATOR = "; ";

/** Ends every reason. */
export const SENTENCE_END = ".";

/** The `{name}` placeholders of a template literal type, as a union. */
export type Placeholders<T extends string> =
  T extends `${string}{${infer Key}}${infer Rest}`
    ? Key | Placeholders<Rest>
    : never;

/**
 * The values a template needs: exactly its placeholders when the template is
 * a literal type (a missing or misspelt key fails the build, S1.3d7), or any
 * record when it is only known as a string.
 */
export type TemplateValues<T extends string> = string extends T
  ? Readonly<Record<string, string | number>>
  : Readonly<Record<Placeholders<T>, string | number>>;

/**
 * Replaces each `{key}` placeholder with its value. A key missing at run time
 * leaves its placeholder in place rather than throwing, so a render never
 * fails on copy (S1.3d7).
 */
export function fillTemplate<T extends string>(
  template: T,
  values: TemplateValues<T>,
): string {
  const lookup = values as Readonly<Record<string, string | number>>;
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(lookup, key)
      ? String(lookup[key])
      : placeholder,
  );
}
