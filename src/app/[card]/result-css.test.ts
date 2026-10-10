// T12 (AC-2; C1.14 = A): each badge takes its verdict token and no literal
// colour, result.css never reaches the site footer, and evaluate.css keeps
// no verdict pill.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  extractRules,
  FOOTER_SELECTOR,
  selectorsOf,
} from "../../../tests/helpers/site-footer-css";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const RESULT_CSS = read("src/app/[card]/result.css");

/** A colour written as a literal: hex, rgb()/hsl() and friends, or a named colour. */
const LITERAL_COLOUR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|red|green|blue|gray|grey|transparent|currentcolor)\b/i;

function declarationsOf(css: string, selector: string) {
  const rules = extractRules(css).filter(
    (r) => r.atRules.length === 0 && r.selector === selector,
  );
  return rules.flatMap((r) => r.declarations);
}

describe("badge tokens (T12, C1.14 = A)", () => {
  test.each([
    ["buy", "--verdict-buy"],
    ["fair", "--verdict-fair"],
    ["wait", "--verdict-wait"],
  ])(".mm-rec-badge--%s takes var(%s) and no literal colour", (kind, token) => {
    const declarations = declarationsOf(RESULT_CSS, `.mm-rec-badge--${kind}`);
    expect(declarations.length).toBeGreaterThan(0);
    const background = declarations.find((d) => d.property === "background");
    expect(background?.value).toBe(`var(${token})`);
    for (const { property, value } of declarations) {
      expect(`${property}: ${value}`).not.toMatch(LITERAL_COLOUR);
    }
  });

  test("the literal-colour pattern catches literals and passes tokens", () => {
    for (const hit of [
      "#10b981",
      "rgb(16, 185, 129)",
      "rgba(0,0,0,.5)",
      "white",
      "hsl(1 2% 3%)",
    ]) {
      expect(hit).toMatch(LITERAL_COLOUR);
    }
    for (const miss of [
      "var(--verdict-buy)",
      "var(--mox-onyx)",
      "var(--fg-primary)",
    ]) {
      expect(miss).not.toMatch(LITERAL_COLOUR);
    }
  });

  test("no other rule colours a badge kind", () => {
    const kindRules = extractRules(RESULT_CSS).filter((r) =>
      /mm-rec-badge--/.test(r.selector),
    );
    expect(kindRules.map((r) => r.selector).sort()).toEqual([
      ".mm-rec-badge--buy",
      ".mm-rec-badge--fair",
      ".mm-rec-badge--wait",
    ]);
  });
});

describe("result.css never reaches the site footer (T12)", () => {
  test("no selector names footer or the site footer's class", () => {
    const selectors = selectorsOf(RESULT_CSS);
    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.filter((s) => FOOTER_SELECTOR.test(s))).toEqual([]);
    expect(RESULT_CSS).not.toMatch(/mm-site-footer/);
    expect(selectors.filter((s) => /(^|[\s>+~])footer\b/i.test(s))).toEqual([]);
  });
});

describe("evaluate.css (T12)", () => {
  const EVALUATE_CSS = read("src/app/evaluate/evaluate.css");

  test("keeps no .mm-pill, .mm-recent, .mm-stale or .mm-empty rule", () => {
    const selectors = selectorsOf(EVALUATE_CSS);
    expect(
      selectors.filter((s) => /\.mm-(pill|recent|stale|empty)/.test(s)),
    ).toEqual([]);
  });
});
