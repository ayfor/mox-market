// S4.1 T2 and T3's component halves (AC-2, AC-3), the chip rule (S4.1d8)
// and T13 (F4 UI, "jewel-palette neutral"; S4.1d11): CategoryChips renders
// one chip per non-default field, each with its one-sentence tooltip, and no
// row at all for a fully-default or missing category. Its CSS uses tokens
// only, shows the bubble on hover and keyboard focus, and keeps it inside the
// row on narrow screens (S3.2 ADV UB-1).
import { CATEGORY_CHIPS } from "@/lib/copy/category";
import { categoryChips } from "@/lib/evaluation/category-chips";
import { classify } from "@/lib/recommendation/classify";
import {
  CLASSIFY_FIXTURES,
  classifyFixtureNamed,
} from "@/lib/recommendation/fixtures";
import {
  DEFAULT_CARD_CATEGORY,
  type CardCategory,
} from "@/lib/recommendation/types";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { extractRules } from "../../tests/helpers/site-footer-css";
import { CategoryChips } from "./category-chips";

const AS_OF = "2026-10-10";
const categoryOf = (name: string): CardCategory =>
  classify(classifyFixtureNamed(name).card, AS_OF);

/** The chip labels a rendered row shows, in order. */
function chipLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".mm-category-chip")].map(
    (chip) => chip.textContent ?? "",
  );
}

/** The plan's expected chip rows (S4.1d8 order). */
const EXPECTED_ROWS: Record<string, string[]> = {
  "CL-RESERVED": [
    "Reserved List",
    "Vintage-era print",
    "EDH top-5000",
    "Commander-legal",
  ],
  "CL-RECENT": [
    "Recent print (<6mo)",
    "EDH rank over 5000",
    "Competitive-format legal",
  ],
  "CL-TOP1000": [
    "Modern-era print",
    "EDH top-1000",
    "Competitive-format legal",
  ],
  "CL-STANDARD": ["Modern-era print", "Competitive-format legal"],
  "CL-DIGITAL": ["Modern-era print", "Digital"],
  "CL-PREVIEW": ["Recent print (<6mo)"],
  "CL-DEFAULT": [],
};

describe("the chip rule (S4.1d8)", () => {
  test.each(Object.entries(EXPECTED_ROWS))(
    "%s renders its expected chips, in Fields-table order",
    (name, labels) => {
      const { container } = render(
        <CategoryChips category={categoryOf(name)} />,
      );
      expect(chipLabels(container)).toEqual(labels);
    },
  );

  test.each([
    ["DEFAULT_CARD_CATEGORY", DEFAULT_CARD_CATEGORY],
    ["null", null],
    ["undefined", undefined],
  ])("%s renders no list element and no chip", (_label, category) => {
    const { container } = render(<CategoryChips category={category} />);
    expect(container.querySelector(".mm-category-chips")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  test("categoryChips gives [] for null and for the defaults, and one chip per non-default field", () => {
    expect(categoryChips(null)).toEqual([]);
    expect(categoryChips(DEFAULT_CARD_CATEGORY)).toEqual([]);
    for (const { expected } of CLASSIFY_FIXTURES) {
      const nonDefault = (
        Object.keys(DEFAULT_CARD_CATEGORY) as (keyof CardCategory)[]
      ).filter((key) => expected[key] !== DEFAULT_CARD_CATEGORY[key]);
      expect(categoryChips(expected)).toHaveLength(nonDefault.length);
    }
  });

  test("every chip's label and tooltip come from CATEGORY_CHIPS", () => {
    for (const { expected } of CLASSIFY_FIXTURES) {
      for (const chip of categoryChips(expected)) {
        expect({ label: chip.label, tooltip: chip.tooltip }).toEqual(
          CATEGORY_CHIPS[chip.key],
        );
      }
    }
  });

  test("an unexpected value (a malformed category) gets no chip and no throw", () => {
    const malformed = {
      reservedList: "yes",
      age: "toString",
      popularity: "constructor",
      formatProfile: undefined,
      digital: 1,
    } as unknown as CardCategory;
    expect(categoryChips(malformed)).toEqual([]);
  });
});

describe("missing data never renders an empty chip (T2, AC-2; T3, AC-3)", () => {
  test("CL-STANDARD (no edhrec_rank): exactly Modern-era print and Competitive-format legal, so no EDH chip", () => {
    const { container } = render(
      <CategoryChips category={categoryOf("CL-STANDARD")} />,
    );
    expect(chipLabels(container)).toEqual([
      "Modern-era print",
      "Competitive-format legal",
    ]);
    expect(container.textContent).not.toMatch(/EDH/);
  });

  test("CL-RECENT with released_at 2026-02-30: no age chip", () => {
    const card = {
      ...classifyFixtureNamed("CL-RECENT").card,
      released_at: "2026-02-30",
    };
    const { container } = render(
      <CategoryChips category={classify(card, AS_OF)} />,
    );
    expect(chipLabels(container)).toEqual([
      "EDH rank over 5000",
      "Competitive-format legal",
    ]);
  });

  test("every rendered chip, for every fixture, has non-empty text and a non-empty tooltip", () => {
    for (const { card } of CLASSIFY_FIXTURES) {
      const { container, unmount } = render(
        <CategoryChips category={classify(card, AS_OF)} />,
      );
      for (const chip of container.querySelectorAll(".mm-category-chip")) {
        expect(chip.textContent?.trim()).not.toBe("");
        expect(chip.getAttribute("title")?.trim()).not.toBe("");
      }
      unmount();
    }
  });
});

describe("each chip's tooltip (S4.1d11)", () => {
  test("title, data-tooltip and the accessible description are the tooltip; the chip is focusable", () => {
    render(<CategoryChips category={categoryOf("CL-RESERVED")} />);
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    for (const label of EXPECTED_ROWS["CL-RESERVED"]) {
      const chip = screen.getByText(label);
      const tooltip = Object.values(CATEGORY_CHIPS).find(
        (c) => c.label === label,
      )!.tooltip;
      expect(chip).toHaveAttribute("title", tooltip);
      expect(chip).toHaveAttribute("data-tooltip", tooltip);
      expect(chip).toHaveAccessibleDescription(tooltip);
      expect(chip).toHaveAttribute("tabindex", "0");
    }
  });

  test("the described-by targets are hidden, so the tooltip is not read twice", () => {
    const { container } = render(
      <CategoryChips category={categoryOf("CL-RESERVED")} />,
    );
    const tips = container.querySelectorAll(".mm-category-tip");
    expect(tips).toHaveLength(4);
    for (const tip of tips) expect(tip).not.toBeVisible();
    const ids = [...tips].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// --- T13: CSS ---------------------------------------------------------------
const ROOT = path.resolve(__dirname, "..", "..");
const CSS = readFileSync(
  path.join(ROOT, "src/components/category-chips.css"),
  "utf8",
);
const SOURCE = readFileSync(
  path.join(ROOT, "src/components/category-chips.tsx"),
  "utf8",
);
const LITERAL_COLOUR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|red|green|blue|gray|grey|transparent|currentcolor)\b/i;

describe("category-chips.css (T13; F4 UI)", () => {
  test("the component imports ./category-chips.css", () => {
    expect(SOURCE).toMatch(/^import "\.\/category-chips\.css";$/m);
  });

  test("no rule holds a literal colour; every colour is a token", () => {
    const rules = extractRules(CSS);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const { property, value } of rule.declarations) {
        // The value, not the property: "white-space" is not a colour.
        expect(value, `${rule.selector} { ${property} }`).not.toMatch(
          LITERAL_COLOUR,
        );
        if (
          /^(color|background(-color)?|border(-color)?|outline(-color)?)$/.test(
            property,
          )
        ) {
          expect(value, `${rule.selector} { ${property} }`).toMatch(
            /var\(--[\w-]+\)/,
          );
        }
      }
    }
  });

  test("every rule is scoped to an .mm-category- class", () => {
    for (const rule of extractRules(CSS)) {
      expect(rule.selector).toMatch(/^\.mm-category-/);
    }
  });

  test("chips reuse the confidence chip's neutral treatment", () => {
    const chip = extractRules(CSS).find(
      (r) => r.atRules.length === 0 && r.selector === ".mm-category-chip",
    );
    expect(chip?.declarations).toEqual(
      expect.arrayContaining([
        { property: "height", value: "28px" },
        { property: "border-radius", value: "999px" },
        { property: "border", value: "1px solid var(--glass-stroke-strong)" },
        { property: "font", value: "var(--ts-label)" },
        { property: "color", value: "var(--fg-secondary)" },
      ]),
    );
  });

  test("the bubble shows on hover and on keyboard focus", () => {
    const shown = extractRules(CSS).find(
      (r) =>
        /\.mm-category-chip:hover::after/.test(r.selector) &&
        /\.mm-category-chip:focus-visible::after/.test(r.selector),
    );
    expect(shown?.declarations).toEqual(
      expect.arrayContaining([{ property: "visibility", value: "visible" }]),
    );
    const base = extractRules(CSS).find(
      (r) =>
        r.atRules.length === 0 && r.selector === ".mm-category-chip::after",
    );
    expect(base?.declarations).toEqual(
      expect.arrayContaining([
        { property: "content", value: "attr(data-tooltip)" },
        { property: "visibility", value: "hidden" },
      ]),
    );
  });

  test("under 760 px the bubble anchors to the chip row and never outgrows it (S3.2 UB-1)", () => {
    const NARROW = "@media (max-width: 760px)";
    const narrow = (selector: string) =>
      extractRules(CSS)
        .filter(
          (r) =>
            r.selector === selector &&
            r.atRules.length === 1 &&
            r.atRules[0] === NARROW,
        )
        .flatMap((r) => r.declarations);
    const row = extractRules(CSS).find(
      (r) => r.atRules.length === 0 && r.selector === ".mm-category-chips",
    );
    expect(row?.declarations).toEqual(
      expect.arrayContaining([{ property: "position", value: "relative" }]),
    );
    expect(narrow(".mm-category-chip")).toEqual(
      expect.arrayContaining([{ property: "position", value: "static" }]),
    );
    expect(narrow(".mm-category-chip::after")).toEqual(
      expect.arrayContaining([
        { property: "left", value: "0" },
        { property: "transform", value: "none" },
        { property: "box-sizing", value: "border-box" },
        { property: "max-width", value: "100%" },
      ]),
    );
  });
});
