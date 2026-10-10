// T2 (AC-3), T3 (AC-4), T4 (AC-7): the legal copy module equals the spec.
// S1.3 T16 (AC-5): the source label, and the shared forbidden-phrase lint.
// Strict equality, never a snapshot (C2-B.1). The spec is read at test time,
// scoped to the footer and disclaimer headings; the affiliate blockquote is
// never read here (AC-3).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  DISCLAIMER_HEADING,
  findForbiddenClaims,
  findForbiddenReasonWords,
  FOOTER_HEADING,
  readSpec,
  readSpecBlockquotes,
  readSpecLinkTarget,
} from "../../../tests/helpers/attribution-spec";
import * as legal from "./legal";
import {
  FAN_CONTENT_LINE,
  FAN_CONTENT_POLICY_LINK,
  RECOMMENDATION_DISCLAIMER,
  SITE_FOOTER_LINES,
  SOURCE_LABEL,
} from "./legal";

const spec = readSpec();
const footerQuotes = readSpecBlockquotes(spec, FOOTER_HEADING);
const [disclaimerQuote] = readSpecBlockquotes(spec, DISCLAIMER_HEADING);
const specHref = readSpecLinkTarget(spec, FOOTER_HEADING, "Fan Content Policy");

/** Every string reachable from the module's exports. */
function exportedStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(exportedStrings);
  }
  return [];
}
const allStrings = exportedStrings(legal);
const fullStrings = [
  ...SITE_FOOTER_LINES,
  RECOMMENDATION_DISCLAIMER,
  SOURCE_LABEL,
];

describe("legal copy equals the spec (T2)", () => {
  test("SITE_FOOTER_LINES has three lines", () => {
    expect(SITE_FOOTER_LINES).toHaveLength(3);
    expect(footerQuotes).toHaveLength(3);
  });

  test.each([0, 1, 2])(
    "footer line %i is the spec blockquote at the same index",
    (i) => {
      expect(SITE_FOOTER_LINES[i]).toBe(footerQuotes[i]);
    },
  );

  test("RECOMMENDATION_DISCLAIMER is the disclaimer blockquote", () => {
    expect(RECOMMENDATION_DISCLAIMER).toBe(disclaimerQuote);
  });

  test("no exported string carries the affiliate line or a paid-link marker", () => {
    // Absence of "commission" alone proves no string equals or contains the
    // affiliate blockquote, which says it, so that blockquote is never read.
    for (const s of allStrings) {
      expect(s).not.toMatch(/commission/i);
      expect(s).not.toMatch(/paid link/i);
      expect(s).not.toMatch(/affiliate/i);
      expect(s).not.toMatch(/when you buy through links/i);
    }
  });

  test('line 3 says "Recommendations are automated", never "Verdicts" (the spec\'s one substitution)', () => {
    expect(SITE_FOOTER_LINES[2]).toContain("Recommendations are automated");
    for (const s of allStrings) expect(s).not.toMatch(/verdict/i);
  });

  test("the tuple and the link objects are frozen", () => {
    expect(Object.isFrozen(SITE_FOOTER_LINES)).toBe(true);
    expect(Object.isFrozen(FAN_CONTENT_POLICY_LINK)).toBe(true);
    expect(Object.isFrozen(FAN_CONTENT_LINE)).toBe(true);
    expect(() => {
      (SITE_FOOTER_LINES as unknown as string[])[0] = "changed";
    }).toThrow(TypeError);
  });

  test.each(fullStrings.map((s, i): [number, string] => [i, s]))(
    "string %i has no leading or trailing whitespace, newline, tab or double space",
    (_i, s) => {
      expect(s).toBe(s.trim());
      expect(s).not.toMatch(/[\n\r\t]/);
      expect(s).not.toMatch(/ {2}/);
    },
  );

  test("legal.ts imports nothing and loads no markdown", () => {
    // Code only: the header comment may name the spec file.
    const source = readFileSync(path.join(__dirname, "legal.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(source).toContain("export const SITE_FOOTER_LINES");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/^\s*export\s+(\*|\{[^}]*\})\s+from\b/m);
    expect(source).not.toMatch(/\.md\b/);
    expect(source).not.toMatch(/\bfs\b/);
  });
});

describe("Fan Content Policy link (T3)", () => {
  test('the link text is "Fan Content Policy" and occurs exactly once in line 1', () => {
    expect(FAN_CONTENT_POLICY_LINK.text).toBe("Fan Content Policy");
    expect(SITE_FOOTER_LINES[0].split("Fan Content Policy")).toHaveLength(2);
  });

  test("before + link text + after is line 1", () => {
    expect(FAN_CONTENT_LINE.link).toBe(FAN_CONTENT_POLICY_LINK);
    expect(
      FAN_CONTENT_LINE.before +
        FAN_CONTENT_LINE.link.text +
        FAN_CONTENT_LINE.after,
    ).toBe(SITE_FOOTER_LINES[0]);
  });

  test("href is the URL the spec names", () => {
    expect(FAN_CONTENT_POLICY_LINK.href).toBe(specHref);
    expect(FAN_CONTENT_POLICY_LINK.href).toBe(
      "https://company.wizards.com/en/legal/fancontentpolicy",
    );
  });

  test("href is https on company.wizards.com", () => {
    const url = new URL(FAN_CONTENT_POLICY_LINK.href);
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("company.wizards.com");
  });
});

describe("forbidden claims (T4)", () => {
  test.each([
    ["We guarantee that prices are right", ["guarantee that"]],
    ["trust our data", ["trust our"]],
    ["A proven method", ["proven"]],
    ["guaranteed accuracy", ["guaranteed accura"]],
    ["Guaranteed.", ["Guaranteed"]],
    ["Accuracy is guaranteed", ["guaranteed"]],
    ["GUARANTEED ACCURACY", ["GUARANTEED ACCURA"]],
    ["This cannot guaranteed", ["guaranteed"]],
    ["notguaranteed", ["guaranteed"]],
    ["Prices are not guaranteed accurate", ["guaranteed accura"]],
    ["not guaranteed accuracy", ["guaranteed accura"]],
  ])("flags %j", (text, expected) => {
    expect(findForbiddenClaims(text)).toEqual(expected);
  });

  test.each([
    "not guaranteed",
    "Not guaranteed",
    "prices are not guaranteed.",
    "NOT GUARANTEED",
  ])("passes %j", (text) => {
    expect(findForbiddenClaims(text)).toEqual([]);
  });

  test("every exported legal string and the joined footer pass", () => {
    for (const s of allStrings) expect(findForbiddenClaims(s)).toEqual([]);
    expect(findForbiddenClaims(SITE_FOOTER_LINES.join(" "))).toEqual([]);
    expect(findForbiddenClaims(RECOMMENDATION_DISCLAIMER)).toEqual([]);
  });

  test("the legal strings contain none of the Standards forbidden reason words", () => {
    for (const s of allStrings) expect(findForbiddenReasonWords(s)).toEqual([]);
  });

  test("the shared lint flags 'unexpectedly' and 'predictable' (S1.3d4: substring after normalisation)", () => {
    expect(findForbiddenReasonWords("Prices will rise")).toEqual(["will rise"]);
    expect(findForbiddenReasonWords("You SHOULD buy")).toEqual(["should"]);
    expect(findForbiddenReasonWords("unexpectedly")).toEqual([
      "expect",
      "expected",
    ]);
    expect(findForbiddenReasonWords("predictable")).toEqual(["predict"]);
  });
});

describe("source label (S1.3 T16, AC-5; S1.3d5)", () => {
  test("SOURCE_LABEL is F1's source label, one string everywhere (C1.02)", () => {
    expect(SOURCE_LABEL).toBe(
      "Market price via Scryfall (TCGplayer), updated daily",
    );
  });

  test("it makes no forbidden claim and holds no forbidden phrase", () => {
    expect(findForbiddenClaims(SOURCE_LABEL)).toEqual([]);
    expect(findForbiddenReasonWords(SOURCE_LABEL)).toEqual([]);
  });
});
