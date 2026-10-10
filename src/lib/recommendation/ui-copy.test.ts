// T14, T15 (S1.3, AC-5; S1.3d3, S1.3d5): F2's UI strings from F1's UI-strings
// table, the finish names, and the validation error's agreement with the
// input limits. Strict equality with literals written here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { FALLBACK_NOTICE, fillTemplate } from "./copy";
import { MAX_ASKING_PRICE_CENTS, MIN_ASKING_PRICE_CENTS } from "./limits";
import { FINISH_LABELS, UI_COPY } from "./ui-copy";

describe("UI_COPY is F1's UI-strings table (T14)", () => {
  test("every string equals F1's text, 15 keys", () => {
    expect(UI_COPY).toStrictEqual({
      errorPanel: "Couldn't reach price data — try again.",
      submitHelper: "Enter a card and a price.",
      validationError: "Enter a price from $0.01 to $100,000, like 74.99.",
      thinDataNote: "thin data",
      historyLine: "Price history: {N} snapshots, newest {relativeTime}",
      staleFlag: "Over {hours} hours old",
      noHistory: "No price history yet for this printing.",
      staleBanner: "Price data is temporarily out of date.",
      historyUnavailable: "Price history temporarily unavailable",
      ambiguousCard: "Pick from the suggestions",
      cardNotFound: "Couldn't find that card",
      printingLabel: "Printing",
      finishLabel: "Finish",
      printingOption: "{set_name} ({SET}) · #{collector_number}",
      navSoon: "soon",
    });
    expect(Object.keys(UI_COPY)).toHaveLength(15);
  });

  test("FINISH_LABELS is Normal and Foil, with no etched key (C1.08 = A)", () => {
    expect(FINISH_LABELS).toStrictEqual({ normal: "Normal", foil: "Foil" });
    expect(FINISH_LABELS).not.toHaveProperty("etched");
  });

  test("both objects are frozen, so a stray write throws", () => {
    expect(Object.isFrozen(UI_COPY)).toBe(true);
    expect(Object.isFrozen(FINISH_LABELS)).toBe(true);
    expect(() => {
      (UI_COPY as { errorPanel: string }).errorPanel = "Oops.";
    }).toThrow(TypeError);
    expect(() => {
      (FINISH_LABELS as Record<string, string>).etched = "Etched";
    }).toThrow(TypeError);
  });

  test("ui-copy.ts imports types only and loads no markdown", () => {
    const source = readFileSync(path.join(__dirname, "ui-copy.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const imports = source.match(/^\s*import\b.*$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^\s*import\s+type\b/);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/^\s*export\s+(\*|\{[^}]*\})\s+from\b/m);
    expect(source).not.toMatch(/\.md\b/);
    expect(source).not.toMatch(/\bfs\b/);
  });
});

describe("filled UI strings (T14)", () => {
  test("history line", () => {
    expect(
      fillTemplate(UI_COPY.historyLine, { N: 12, relativeTime: "3 hours ago" }),
    ).toBe("Price history: 12 snapshots, newest 3 hours ago");
  });

  test("history line at one snapshot reads as F1 locks it, plural (ADV-9; open for Josh)", () => {
    // F1's UI-strings table has no singular row, and a locked-copy change
    // needs Josh's ruling (AGENTS.md). Pinned so the ruling, either way,
    // changes this line on purpose. No caller renders it before F0 (S2.1
    // pivot: an empty history reader).
    expect(
      fillTemplate(UI_COPY.historyLine, { N: 1, relativeTime: "2 hours ago" }),
    ).toBe("Price history: 1 snapshots, newest 2 hours ago");
  });

  test("stale flag", () => {
    expect(fillTemplate(UI_COPY.staleFlag, { hours: 36 })).toBe(
      "Over 36 hours old",
    );
  });

  test("printing option", () => {
    expect(
      fillTemplate(UI_COPY.printingOption, {
        set_name: "Modern Horizons 2",
        SET: "MH2",
        collector_number: "12",
      }),
    ).toBe("Modern Horizons 2 (MH2) · #12");
  });

  test("the fallback notice takes the requested finish's label, and its Normal is the normal label (S1.3d5)", () => {
    expect(fillTemplate(FALLBACK_NOTICE, { finish: FINISH_LABELS.foil })).toBe(
      "This printing has no Foil price — showing Normal pricing.",
    );
    expect(FALLBACK_NOTICE).toContain(
      `showing ${FINISH_LABELS.normal} pricing`,
    );
  });
});

/** Integer cents as F2 writes dollars: "$0.01", "$100,000". */
function dollars(cents: number): string {
  const whole = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = cents % 100;
  return rest === 0
    ? `$${whole}`
    : `$${whole}.${String(rest).padStart(2, "0")}`;
}

/** F2's Fields table: the normalised asking price must match this. */
const F2_PRICE_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;

describe("the validation error agrees with the input limits (T15)", () => {
  test("the dollar formatter", () => {
    expect(dollars(1)).toBe("$0.01");
    expect(dollars(7499)).toBe("$74.99");
    expect(dollars(10_000_000)).toBe("$100,000");
    expect(dollars(123_456_789)).toBe("$1,234,567.89");
  });

  test("its amounts are MIN_ASKING_PRICE_CENTS and MAX_ASKING_PRICE_CENTS", () => {
    expect(UI_COPY.validationError).toContain(
      `from ${dollars(MIN_ASKING_PRICE_CENTS)} to ${dollars(MAX_ASKING_PRICE_CENTS)},`,
    );
  });

  test("its example passes F2's price pattern within the limits", () => {
    const example = /like (\S+)\.$/.exec(UI_COPY.validationError)?.[1];
    expect(example).toBe("74.99");
    expect(example).toMatch(F2_PRICE_PATTERN);
    const cents = Math.round(Number(example) * 100);
    expect(cents).toBe(7499);
    expect(cents).toBeGreaterThanOrEqual(MIN_ASKING_PRICE_CENTS);
    expect(cents).toBeLessThanOrEqual(MAX_ASKING_PRICE_CENTS);
  });
});
