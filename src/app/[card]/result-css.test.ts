// T12 (AC-2; C1.14 = A): each badge takes its verdict token and no literal
// colour, result.css never reaches the site footer, and evaluate.css keeps
// no verdict pill. S2.3's T15 (AC-12): the selector row's fixed geometry,
// shared by the controls and the skeleton, and whole-string classes.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
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

// --- S2.3: selector geometry and whole-string classes -----------------------
const SELECTOR_CSS = read("src/components/selection-controls.css");

/** Every rule for `selector`, at any at-rule depth, with its at-rules. */
const rulesFor = (css: string, selector: string) =>
  extractRules(css).filter((r) =>
    r.selector.split(",").some((s) => s.trim() === selector),
  );

const pxOf = (value: string) => {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  return match === null ? null : Number(match[1]);
};

describe("the selector row's geometry (T15, AC-12)", () => {
  const base = (selector: string) =>
    declarationsOf(RESULT_CSS, selector).reduce<Record<string, string>>(
      (all, d) => ({ ...all, [d.property]: d.value }),
      {},
    );

  test(".mm-selector-row is a two-track grid with a fixed px height", () => {
    const row = base(".mm-selector-row");
    expect(row.display).toBe("grid");
    expect(row["grid-template-columns"]?.split(/\s+(?![^(]*\))/)).toHaveLength(
      2,
    );
    expect(pxOf(row.height ?? "")).toBeGreaterThan(0);
  });

  test(".mm-selector and .mm-skeleton-selector each fill their track (height: 100%)", () => {
    expect(base(".mm-selector").height).toBe("100%");
    expect(base(".mm-skeleton-selector").height).toBe("100%");
    expect(base(".mm-skeleton-selector").width).toBe("100%");
  });

  test("no rule anywhere changes those heights: every breakpoint keeps the row's height and two tracks", () => {
    const rowHeight = base(".mm-selector-row").height;
    for (const [css, name] of [
      [RESULT_CSS, "result.css"],
      [SELECTOR_CSS, "selection-controls.css"],
    ] as const) {
      for (const selector of [
        ".mm-selector-row",
        ".mm-selector",
        ".mm-skeleton-selector",
      ]) {
        for (const rule of rulesFor(css, selector)) {
          const where = `${name} ${rule.atRules.join(" ")} ${selector}`;
          for (const { property, value } of rule.declarations) {
            expect(
              ["min-height", "max-height", "block-size"],
              where,
            ).not.toContain(property);
            if (property === "height") {
              expect(value, where).toBe(
                selector === ".mm-selector-row" ? rowHeight : "100%",
              );
            }
            if (property === "grid-template-columns") {
              expect(value.split(/\s+(?![^(]*\))/), where).toHaveLength(2);
            }
          }
        }
      }
    }
    // The narrow breakpoint does restyle the row, so the loop above saw it.
    expect(
      rulesFor(RESULT_CSS, ".mm-selector-row").some(
        (r) => r.atRules.length > 0,
      ),
    ).toBe(true);
  });

  test("a control's label row, gap and 40 px button fill the row's height exactly", () => {
    const control = rulesFor(SELECTOR_CSS, ".mm-selector")
      .filter((r) => r.atRules.length === 0)
      .flatMap((r) => r.declarations);
    const get = (p: string) => control.find((d) => d.property === p)?.value;
    const rows = (get("grid-template-rows") ?? "").split(/\s+/).map(pxOf);
    expect(rows).toEqual([12, 40]);
    const gap = pxOf(get("row-gap") ?? "");
    expect(rows[0]! + gap! + rows[1]!).toBe(
      pxOf(base(".mm-selector-row").height!),
    );
    const button = rulesFor(SELECTOR_CSS, ".mm-selector-button")
      .filter((r) => r.atRules.length === 0)
      .flatMap((r) => r.declarations);
    expect(button.find((d) => d.property === "height")?.value).toBe("40px");
  });

  test("selection-controls.css takes tokens, no literal colour", () => {
    const COLOUR_PROPERTY =
      /color|background|border|outline|shadow|fill|stroke/;
    for (const rule of extractRules(SELECTOR_CSS)) {
      for (const { property, value } of rule.declarations) {
        if (!COLOUR_PROPERTY.test(property)) continue;
        expect(`${rule.selector} { ${property}: ${value} }`).not.toMatch(
          LITERAL_COLOUR,
        );
      }
    }
  });
});

/** The TSX files whose classes S2.3 writes. */
const SELECTOR_TSX = [
  "src/components/printing-select.tsx",
  "src/components/finish-select.tsx",
  "src/components/selection-controls.tsx",
  "src/components/select-chevron.tsx",
  "src/app/[card]/panel-skeleton.tsx",
];

/** Every className attribute that is not a plain string literal. */
function builtClassNames(file: string, source: string): string[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === "className") {
      const init = node.initializer;
      const plain =
        init !== undefined &&
        (ts.isStringLiteral(init) ||
          (ts.isJsxExpression(init) &&
            init.expression !== undefined &&
            ts.isStringLiteral(init.expression)));
      if (!plain) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        found.push(`${file}:${line + 1} ${node.getText(sf)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("whole class strings only (T15; S2.4 ADV.1)", () => {
  test.each(SELECTOR_TSX)(
    "%s: every className is a plain string literal",
    (file) => {
      const source = read(file);
      expect(source).toMatch(/className=/);
      expect(builtClassNames(file, source)).toEqual([]);
    },
  );

  test("self-test: templates, concatenation and calls are flagged; plain strings are not", () => {
    const sample = [
      'export const A = () => <p className="mm-a mm-b" />;',
      'export const B = () => <p className={"mm-a"} />;',
      "export const C = () => <p className={`mm-a ${x}`} />;",
      'export const D = () => <p className={"mm-a " + x} />;',
      "export const E = () => <p className={clsx(a, b)} />;",
      "export const F = () => <p className={`mm-a`} />;",
      'export const G = () => <p className={x ? "a" : "b"} />;',
    ].join("\n");
    expect(
      builtClassNames("x.tsx", sample).map((f) => f.split(" ")[0]),
    ).toEqual(["x.tsx:3", "x.tsx:4", "x.tsx:5", "x.tsx:6", "x.tsx:7"]);
  });
});
