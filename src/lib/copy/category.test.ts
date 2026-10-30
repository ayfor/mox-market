// S4.1 T10 (AC-4; F4 UI; S4.1d9, S4.1d10): the chip copy. F4's four quoted
// strings are verbatim; the new strings are S4.1d9's table, open for Josh's
// ruling. The numbers in the copy are literal, so each is tied here to its
// RECOMMENDATION_PARAMS field: a param change fails until the copy is
// re-ruled (as S3.2 tied "last 7 days" to shockWindowDays). copy-lock and the
// forbidden-phrase lint cover this module through their src/lib/copy globs.
import { classify } from "@/lib/recommendation/classify";
import { classifyFixtureNamed } from "@/lib/recommendation/fixtures";
import { RECOMMENDATION_PARAMS } from "@/lib/recommendation/params";
import { describe, expect, test } from "vitest";
import { CATEGORY_CHIPS } from "./category";

describe("CATEGORY_CHIPS (T10)", () => {
  test("holds exactly S4.1d9's ten label and tooltip pairs, in Fields-table order", () => {
    expect(CATEGORY_CHIPS).toStrictEqual({
      reservedList: {
        label: "Reserved List",
        tooltip: "On the Reserved List as of the last Scryfall fetch",
      },
      recent: {
        label: "Recent print (<6mo)",
        tooltip:
          "This printing was released in the last 183 days or is not yet released",
      },
      modernEra: {
        label: "Modern-era print",
        tooltip:
          "This printing was released on or after 2003-07-28, the 8th Edition release date",
      },
      vintageEra: {
        label: "Vintage-era print",
        tooltip:
          "This printing was released before 2003-07-28, the 8th Edition release date",
      },
      top1000: {
        label: "EDH top-1000",
        tooltip: "EDHREC rank 1 to 1000 as of the last Scryfall fetch",
      },
      top5000: {
        label: "EDH top-5000",
        tooltip: "EDHREC rank 1001 to 5000 as of the last Scryfall fetch",
      },
      longtail: {
        label: "EDH rank over 5000",
        tooltip: "EDHREC rank above 5000 as of the last Scryfall fetch",
      },
      competitive: {
        label: "Competitive-format legal",
        tooltip:
          "Legal in Standard, Pioneer or Modern as of the last Scryfall fetch",
      },
      edh: {
        label: "Commander-legal",
        tooltip:
          "Legal in Commander but not in Standard, Pioneer or Modern as of the last Scryfall fetch",
      },
      digital: {
        label: "Digital",
        tooltip: "This printing exists only in digital form",
      },
    });
    expect(Object.keys(CATEGORY_CHIPS)).toEqual([
      "reservedList",
      "recent",
      "modernEra",
      "vintageEra",
      "top1000",
      "top5000",
      "longtail",
      "competitive",
      "edh",
      "digital",
    ]);
  });

  test("F4's quoted strings are verbatim", () => {
    expect(CATEGORY_CHIPS.reservedList.label).toBe("Reserved List");
    expect(CATEGORY_CHIPS.recent.label).toBe("Recent print (<6mo)");
    expect(CATEGORY_CHIPS.top1000.label).toBe("EDH top-1000");
    expect(CATEGORY_CHIPS.competitive.label).toBe("Competitive-format legal");
    expect(CATEGORY_CHIPS.competitive.tooltip).toBe(
      "Legal in Standard, Pioneer or Modern as of the last Scryfall fetch",
    );
    expect(CATEGORY_CHIPS.edh.label).toBe("Commander-legal");
    expect(CATEGORY_CHIPS.digital.label).toBe("Digital");
  });

  test("every tooltip is one sentence with no final period (as F4's quoted tooltip)", () => {
    for (const [key, { label, tooltip }] of Object.entries(CATEGORY_CHIPS)) {
      expect(label.length, key).toBeGreaterThan(0);
      expect(tooltip, key).toMatch(/^[A-Z]/);
      expect(tooltip, key).not.toMatch(/[.!?]$/);
      expect(tooltip, key).not.toMatch(/[.!?] /);
    }
  });

  test("is frozen at every level", () => {
    expect(Object.isFrozen(CATEGORY_CHIPS)).toBe(true);
    for (const chip of Object.values(CATEGORY_CHIPS)) {
      expect(Object.isFrozen(chip)).toBe(true);
    }
  });
});

describe("the numbers in the copy follow the params (T10; S4.1d10)", () => {
  const { recentPrintingDays, modernEraStart, edhrecTop1Rank, edhrecTop2Rank } =
    RECOMMENDATION_PARAMS;

  test("the recent tooltip says recentPrintingDays days, and the label's 6mo is that many days in months", () => {
    expect(CATEGORY_CHIPS.recent.tooltip).toContain(
      `${recentPrintingDays} days`,
    );
    expect(Math.round(recentPrintingDays / (365.25 / 12))).toBe(6);
    expect(CATEGORY_CHIPS.recent.label).toContain("6mo");
  });

  test("the era tooltips name modernEraStart", () => {
    expect(CATEGORY_CHIPS.modernEra.tooltip).toContain(modernEraStart);
    expect(CATEGORY_CHIPS.vintageEra.tooltip).toContain(modernEraStart);
  });

  test("the EDHREC tooltips and the longtail label name the rank bounds", () => {
    expect(CATEGORY_CHIPS.top1000.tooltip).toContain(`1 to ${edhrecTop1Rank}`);
    expect(CATEGORY_CHIPS.top1000.label).toContain(`${edhrecTop1Rank}`);
    expect(CATEGORY_CHIPS.top5000.tooltip).toContain(
      `${edhrecTop1Rank + 1} to ${edhrecTop2Rank}`,
    );
    expect(CATEGORY_CHIPS.top5000.label).toContain(`${edhrecTop2Rank}`);
    expect(CATEGORY_CHIPS.longtail.tooltip).toContain(
      `above ${edhrecTop2Rank}`,
    );
    expect(CATEGORY_CHIPS.longtail.label).toContain(`${edhrecTop2Rank}`);
  });
});

describe("the recent tooltip is true for every printing the classifier calls recent (ADV UB-2, SPEC-1)", () => {
  test("F4 sends a future-dated (preview) printing to recent, so the tooltip covers one not yet released", () => {
    // F4 Functionality: "A future-dated released_at (preview) → recent, with
    // age clamped at 0". CL-PREVIEW is released 35 days after asOf.
    const asOf = "2026-10-10";
    const preview = classifyFixtureNamed("CL-PREVIEW").card;
    expect(String(preview.released_at) > asOf).toBe(true);
    expect(classify(preview, asOf).age).toBe("recent");
    expect(CATEGORY_CHIPS.recent.tooltip).toContain("not yet released");
    expect(CATEGORY_CHIPS.recent.tooltip).toContain(
      `the last ${RECOMMENDATION_PARAMS.recentPrintingDays} days`,
    );
  });
});
