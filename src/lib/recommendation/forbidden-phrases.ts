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

/** Format characters (Unicode category Cf): zero-width, bidi, soft hyphen. */
const FORMAT_CHARACTERS = /\p{Cf}/gu;
const WHITESPACE_RUN = /\s+/gu;

/**
 * The text the lint matches: NFKC (fullwidth and compatibility letters become
 * plain ones), format characters removed, every whitespace run one space,
 * lower case.
 */
export function normaliseForLint(text: string): string {
  return text
    .normalize("NFKC")
    .replace(FORMAT_CHARACTERS, "")
    .replace(WHITESPACE_RUN, " ")
    .toLowerCase();
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
