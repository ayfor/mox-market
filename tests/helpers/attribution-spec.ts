// Test-time reader for docs/specs/attribution-footer.md (S2.2d6) and the AC-7
// claim checker (S2.2d11). App code never reads markdown: the strings live as
// literals in src/lib/copy/legal.ts, and the tests compare them with the spec.
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

/** The implementer's copy of the R6 legal text. */
export const SPEC_PATH = path.join(
  ROOT,
  "docs",
  "specs",
  "attribution-footer.md",
);

/** The spec headings the copy module is compared with. */
export const FOOTER_HEADING = "Site footer, every page";
export const DISCLAIMER_HEADING = "Recommendation-adjacent disclaimer";
/** Read only by the reader's own scoping test; the copy tests never read it. */
export const AFFILIATE_HEADING = "At affiliate launch (not Phase 1)";

export class SpecSectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecSectionError";
  }
}

export function readSpec(): string {
  return readFileSync(SPEC_PATH, "utf8");
}

const FENCE = /^ {0,3}(```|~~~)/;
const SECTION_END = /^(#|##) /;
const BLOCKQUOTE = /^ {0,3}>/;
/** An ATX heading ends a blockquote in CommonMark; it is never a lazy continuation. */
const ATX_HEADING = /^ {0,3}#{1,6}(?:\s|$)/;

/**
 * The body lines of `## <heading>`, up to the next `# ` or `## ` heading or
 * EOF. CRLF and LF read alike. Lines inside fenced code blocks are neither
 * headings nor content. Throws SpecSectionError when the heading is missing
 * or appears more than once, so a renamed or duplicated heading fails loudly
 * instead of passing on zero (or the wrong) comparisons.
 */
function sectionLines(markdown: string, heading: string): string[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let fenced = false;
  const inFence = lines.map((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return true;
    }
    return fenced;
  });
  const target = `## ${heading}`;
  const starts = lines.flatMap((line, i) =>
    !inFence[i] && line.trimEnd() === target ? [i] : [],
  );
  if (starts.length === 0) {
    throw new SpecSectionError(`spec heading "## ${heading}" not found`);
  }
  if (starts.length > 1) {
    throw new SpecSectionError(
      `spec heading "## ${heading}" appears ${starts.length} times`,
    );
  }
  const body: string[] = [];
  for (let i = starts[0] + 1; i < lines.length; i++) {
    if (!inFence[i] && SECTION_END.test(lines[i])) break;
    body.push(inFence[i] ? "" : lines[i]);
  }
  return body;
}

/**
 * Every blockquote under `## <heading>`, in order. A blockquote is a maximal
 * run of lines starting `>` (up to three leading spaces); each line loses
 * `>` and one optional space, and the lines join with one space, trimmed.
 * Throws SpecSectionError when the section has no blockquote, and when a
 * non-blank line without `>` other than an ATX heading directly follows a
 * `>` line (ADV.4): CommonMark renders such a lazy continuation line inside
 * the quote, so dropping it would let the legal text diverge from what the
 * spec shows. Failing closed beats guessing which lines CommonMark keeps.
 */
export function readSpecBlockquotes(
  markdown: string,
  heading: string,
): string[] {
  const quotes: string[] = [];
  let run: string[] | null = null;
  const flush = () => {
    if (run) {
      const text = run
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ");
      if (text) quotes.push(text);
    }
    run = null;
  };
  for (const line of sectionLines(markdown, heading)) {
    if (BLOCKQUOTE.test(line)) {
      (run ??= []).push(line.replace(/^ {0,3}>\s?/, ""));
    } else if (run && line.trim() !== "" && !ATX_HEADING.test(line)) {
      throw new SpecSectionError(
        `spec heading "## ${heading}" has a lazy continuation line after a blockquote: "${line.trim()}" (prefix it with ">" or separate it with a blank line)`,
      );
    } else {
      flush();
    }
  }
  flush();
  if (quotes.length === 0) {
    throw new SpecSectionError(
      `spec heading "## ${heading}" has no blockquote`,
    );
  }
  return quotes;
}

/**
 * The URL from the `"<linkText>" links to <url>` sentence under
 * `## <heading>`. Throws SpecSectionError when the sentence is missing.
 */
export function readSpecLinkTarget(
  markdown: string,
  heading: string,
  linkText: string,
): string {
  const escaped = linkText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sentence = new RegExp(
    `^\\s*["“]${escaped}["”] links to (\\S+?)[.)]?\\s*$`,
  );
  for (const line of sectionLines(markdown, heading)) {
    const match = sentence.exec(line);
    if (match) return match[1];
  }
  throw new SpecSectionError(
    `spec heading "## ${heading}" has no "${linkText}" links to <url> sentence`,
  );
}

/**
 * AC-5 (ADV.6): the false claims the old per-page footers made, in any
 * spelling: the vendors Card Kingdom and Cardmarket (with or without a
 * space) and a four-hour refresh in digits or words. Prices come from
 * TCGplayer and refresh daily (spec line 3).
 */
export const FALSE_FOOTER_CLAIMS =
  /card\s*kingdom|card\s*market|every\s+(?:4|four)\s+hours/i;

const CLAIM_PHRASES = [
  "trust our",
  "proven",
  "guarantee that",
  "guaranteed accura",
];

/**
 * AC-7 (S2.2d11): every forbidden marketing claim in `text`, case-insensitive.
 * Flags "trust our", "proven", "guarantee that" and "guaranteed accura"
 * wherever they occur, and every "guaranteed" not immediately preceded by
 * the whole word "not " (so "cannot guaranteed" is flagged). Returns the
 * offending phrases as written, so a failure names them.
 */
export function findForbiddenClaims(text: string): string[] {
  const findings: string[] = [];
  const lower = text.toLowerCase();
  for (const phrase of CLAIM_PHRASES) {
    let at = lower.indexOf(phrase);
    while (at !== -1) {
      findings.push(text.slice(at, at + phrase.length));
      at = lower.indexOf(phrase, at + 1);
    }
  }
  for (const match of text.matchAll(/guaranteed/gi)) {
    const before = text.slice(0, match.index);
    if (/(?:^|[^a-z])not $/i.test(before)) continue;
    // "guaranteed accura" is already reported once above.
    if (/^guaranteed accura/i.test(text.slice(match.index))) continue;
    findings.push(match[0]);
  }
  return findings;
}

/**
 * The Standards page's forbidden reason words (AGENTS.md Conventions): S2.2's
 * names for the one list in src/lib/recommendation/forbidden-phrases.ts
 * (S1.3d4). Substring matching after normalisation, so "unexpectedly" and
 * "predictable" are flagged too.
 */
export {
  findForbiddenPhrases as findForbiddenReasonWords,
  FORBIDDEN_PHRASES as FORBIDDEN_REASON_WORDS,
} from "../../src/lib/recommendation/forbidden-phrases";
