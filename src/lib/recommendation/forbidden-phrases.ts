// F1's forbidden phrases (S1.3, AC-2; S1.3d4): the one list in code. Reason
// strings state observed facts only, so no copy string and no assembled reason
// may contain one. AGENTS.md and the Cursor engine rule restate the list as
// documentation, and tests/contract/copy-lock.test.ts fails if either drifts.
// A module of its own, so the lint over the copy modules never scans the list.
// This module imports nothing.

/** F1's list, in F1's order. */
export const FORBIDDEN_PHRASES = Object.freeze([
  "likely",
  "expect",
  "expected",
  "will rise",
  "will fall",
  "will drop",
  "will climb",
  "should",
  "probably",
  "forecast",
  "predict",
] as const);

export type ForbiddenPhrase = (typeof FORBIDDEN_PHRASES)[number];

/**
 * Invisible code points: format characters (category Cf: zero-width, bidi,
 * soft hyphen) and the other default-ignorable ones (variation selectors, the
 * combining grapheme joiner, Hangul fillers) (ADV-7).
 */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
/** Combining marks, removed after NFKD so "prédict" reads "predict". */
const COMBINING_MARKS = /\p{M}/gu;
/** A dash run between two letters, with any spaces round it: "will-rise". */
const DASH_BETWEEN_LETTERS = /(\p{L})\s*\p{Pd}+\s*(?=\p{L})/gu;
const WHITESPACE_RUN = /\s+/gu;

/**
 * Cyrillic and Greek letters drawn like Latin ones, as "<lookalike><Latin>"
 * pairs, upper and lower case (a subset of Unicode's confusables; ADV-7).
 */
const CONFUSABLE_PAIRS =
  "\u0410A \u0412B \u0415E \u0405S \u0406I \u0408J \u041aK \u041cM \u041dH \u041eO \u0420P \u0421C \u0422T \u0425X \u0423Y \u04aeY " +
  "\u0430a \u0432b \u0435e \u0455s \u0456i \u0458j \u043ak \u043cm \u043dh \u043eo \u0440p \u0441c \u0442t \u0445x \u0443y \u04afy \u0501d \u051bq \u051dw \u04bbh \u04cfl " +
  "\u0391A \u0392B \u0395E \u0396Z \u0397H \u0399I \u039aK \u039cM \u039dN \u039fO \u03a1P \u03a4T \u03a5Y \u03a7X " +
  "\u03b1a \u03b3y \u03b5e \u03b7n \u03b9i \u03bak \u03bdv \u03bfo \u03c1p \u03c4t \u03c5u \u03c7x \u03c9w " +
  "\u0131i \u0261g \u0269i";
const CONFUSABLES: ReadonlyMap<string, string> = new Map(
  CONFUSABLE_PAIRS.split(" ").map((pair) => {
    const [lookalike, latin] = [...pair];
    return [lookalike, latin];
  }),
);
const CONFUSABLE = new RegExp(`[${[...CONFUSABLES.keys()].join("")}]`, "gu");

/**
 * The text the lint matches (S1.3d4, ADV-7): NFKD (fullwidth and
 * compatibility letters become plain ones, accents split off), invisible code
 * points and combining marks removed, Cyrillic and Greek lookalikes read as
 * Latin, lower case, a dash between letters read as a space, and every
 * whitespace run one space.
 */
export function normaliseForLint(text: string): string {
  const stripped = (s: string) =>
    s.normalize("NFKD").replace(INVISIBLE, "").replace(COMBINING_MARKS, "");
  // Lower case can add marks ("\u0130" becomes "i" + U+0307), so strip twice.
  return stripped(
    stripped(text)
      .replace(CONFUSABLE, (c) => CONFUSABLES.get(c) ?? c)
      .toLowerCase(),
  )
    .replace(DASH_BETWEEN_LETTERS, "$1 ")
    .replace(WHITESPACE_RUN, " ");
}

/**
 * Every forbidden phrase in `text`, once each, in list order. Substring
 * matching after normalisation fails closed: "unlikely", "predicted" and
 * "unexpectedly" are flagged too (S1.3d4).
 */
export function findForbiddenPhrases(text: string): ForbiddenPhrase[] {
  const normalised = normaliseForLint(text);
  return FORBIDDEN_PHRASES.filter((phrase) => normalised.includes(phrase));
}
