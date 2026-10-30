// UI patch review T6, UI-1, UI-2: the suggestion and Set lists' CSS
// contract. The base list is absolute under its field and above the form;
// the --above variants flip it upward; the landing form hides the Set
// picker below 480 px and caps the upward list there; the entry form's row
// wraps at 960 px and lets the Set field shrink to 140 px.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { extractRules } from "../../tests/helpers/site-footer-css";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** The declarations of `selector` (exact) under exactly `atRules`, last wins. */
function declared(
  css: string,
  selector: string,
  atRules: string[] = [],
): Record<string, string> {
  return extractRules(css)
    .filter(
      (r) =>
        r.atRules.join("|") === atRules.join("|") &&
        r.selector.split(",").some((s) => s.trim() === selector),
    )
    .flatMap((r) => r.declarations)
    .reduce<Record<string, string>>(
      (all, d) => ({ ...all, [d.property]: d.value }),
      {},
    );
}

describe("card-combobox.css (T6)", () => {
  const CSS = read("src/components/card-combobox.css");

  test("the base list sits absolutely under its field, above the form", () => {
    const base = declared(CSS, ".mm-combobox-options");
    expect(base.position).toBe("absolute");
    expect(base.top).toBe("calc(100% + 6px)");
    expect(base.left).toBe("0");
    expect(base.right).toBe("0");
    expect(Number(base["z-index"])).toBeGreaterThanOrEqual(20);
    expect(base["max-height"]).toBe("280px");
    expect(base["overflow-y"]).toBe("auto");
  });

  test("the --above list flips upward and comes after the base rule", () => {
    const above = declared(CSS, ".mm-combobox-options--above");
    expect(above.top).toBe("auto");
    expect(above.bottom).toBe("calc(100% + 6px)");
    const order = extractRules(CSS).map((r) => r.selector);
    expect(order.indexOf(".mm-combobox-options--above")).toBeGreaterThan(
      order.indexOf(".mm-combobox-options"),
    );
  });

  test("card-combobox.tsx loads it, so the landing page has the list's styles", () => {
    expect(read("src/components/card-combobox.tsx")).toMatch(
      /import "\.\/card-combobox\.css";/,
    );
  });
});

describe("set-select.css (T6)", () => {
  const CSS = read("src/components/set-select.css");

  test("the Set button is a 44 px target, outranking the 40 px selector button", () => {
    expect(declared(CSS, ".mm-selector-button.mm-set-button").height).toBe(
      "44px",
    );
  });

  test("the upward Set list flips with two-class specificity", () => {
    const above = declared(CSS, ".mm-selector-options.mm-set-options--above");
    expect(above.top).toBe("auto");
    expect(above.bottom).toBe("calc(100% + 4px)");
  });
});

describe("the landing form on narrow screens (UI-1)", () => {
  const CSS = read("src/app/landing.css");
  const UP_TO_768 = ["@media (max-width: 768px)"];
  const UP_TO_480 = ["@media (max-width: 480px)"];

  test("up to 768 px the row wraps and the card and Set each take a full line", () => {
    expect(declared(CSS, ".landing-form", UP_TO_768)["flex-wrap"]).toBe("wrap");
    expect(declared(CSS, ".landing-form-card", UP_TO_768).flex).toBe(
      "1 1 100%",
    );
    expect(declared(CSS, ".landing-form-set", UP_TO_768).flex).toBe("1 1 100%");
    // The panel cannot be scrolled by focus, so the list stays put.
    expect(declared(CSS, ".landing-panel", UP_TO_768).overflow).toBe("clip");
  });

  test("below 480 px the Set picker is hidden, the row is one line, and the upward list is capped to the room above the field", () => {
    expect(declared(CSS, ".landing-form-set", UP_TO_480).display).toBe("none");
    expect(declared(CSS, ".landing-form", UP_TO_480)["flex-wrap"]).toBe(
      "nowrap",
    );
    expect(declared(CSS, ".landing-form-card", UP_TO_480)["min-width"]).toBe(
      "72px",
    );
    expect(
      declared(CSS, ".landing-form .mm-combobox-options--above", UP_TO_480)[
        "max-height"
      ],
    ).toBe("min(280px, calc((100vw - 32px) * 804 / 660 - 96px))");
  });

  test("the landing form opens both lists upward", () => {
    const source = read("src/app/landing-form.tsx");
    expect(source).toMatch(
      /optionsClassName="mm-combobox-options mm-combobox-options--above"/,
    );
    expect(source).toMatch(
      /optionsClassName="mm-selector-options mm-set-options mm-set-options--above"/,
    );
  });
});

describe("the entry form row (UI-2)", () => {
  const CSS = read("src/components/entry-form.css");

  test("the Set field shrinks from 200 px to 140 px before the card field gives way", () => {
    const set = declared(CSS, ".mm-field--set");
    expect(set.flex).toBe("0 1 200px");
    expect(set["min-width"]).toBe("140px");
    expect(set.width).toBeUndefined();
  });

  test("the row wraps at 960 px, the card and Set each on a full line", () => {
    const WRAP = ["@media (max-width: 960px)"];
    expect(declared(CSS, ".mm-form-row", WRAP)["flex-wrap"]).toBe("wrap");
    expect(declared(CSS, ".mm-field--grow", WRAP).flex).toBe("1 1 100%");
    expect(declared(CSS, ".mm-field--set", WRAP).flex).toBe("1 1 100%");
  });
});
