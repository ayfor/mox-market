// F1 locked copy table, Tier-1 rows (S1.2d9). Design copy as frozen literals;
// S1.3 locks it, adds the UI strings and the forbidden-phrase lint, and may
// rename these exports (C1.48 = B). No trend, stale or volatility clause
// exists before F3.

export const REASON_COPY = Object.freeze({
  /** The insufficient_data sentence, verbatim (U+2014 em dash, straight apostrophe). */
  insufficientData:
    "We don't have enough pricing data on this printing to give a recommendation — try a different printing.",
  /** Fair when X is 0. */
  atMarket: "At market price",
  /** Fair when |deltaBp| is within the band. */
  within: "Within {X}% of market",
  below: "{X}% below market",
  above: "{X}% above market",
  /** The thin-data caveat, whenever confidence is low; n = snapshotCount30d. */
  thinData: "only {n} price snapshots",
});

/** Joins the primary clause and the caveat. */
export const CLAUSE_SEPARATOR = "; ";

/** Ends every reason. */
export const SENTENCE_END = ".";

/** Replaces each `{key}` placeholder with its value. */
export function fillTemplate(
  template: string,
  values: Readonly<Record<string, number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : placeholder,
  );
}
