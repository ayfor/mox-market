// S3.2 T5 (AC-4; S3.2d9, S3.2d11): the shock tooltip's signedX and the
// locked string's "7" tied to shockWindowDays. T16: every filled tooltip in
// the fixture matrix passes the forbidden-phrase lint.
import { SHOCK_TOOLTIP } from "@/lib/recommendation/copy";
import { computeTieredRecommendation } from "@/lib/recommendation/engine";
import {
  CANONICAL_FIXTURES,
  S3_2_FIXTURES,
  TIER2_DATA_EDGE_FIXTURES,
  TIER2_FIXTURES,
} from "@/lib/recommendation/fixtures";
import { findForbiddenPhrases } from "@/lib/recommendation/forbidden-phrases";
import { RECOMMENDATION_PARAMS } from "@/lib/recommendation/params";
import { describe, expect, test } from "vitest";
import { shockSignedX, shockTooltip } from "./shock-tooltip";

const MINUS = "−";

const annotation = (magnitude: number) =>
  ({ detected: true, magnitude, window: 7 }) as const;

describe("shockSignedX (S3.2d9)", () => {
  test.each([
    [45, "+45"],
    [-46.15384615384615, `${MINUS}46`],
    [155.52907530981886, "+156"],
    [35, "+35"],
    [-35, `${MINUS}35`],
    [35.5, "+36"],
    [-35.5, `${MINUS}36`],
    [85.71428571428571, "+86"],
    [-68.23899371069183, `${MINUS}68`],
  ])("magnitude %d gives %s (half away from zero)", (magnitude, signed) => {
    expect(shockSignedX(magnitude)).toBe(signed);
  });

  test("the minus is U+2212, never a hyphen", () => {
    expect(shockSignedX(-40)).not.toContain("-");
    expect(shockSignedX(-40).codePointAt(0)).toBe(0x2212);
  });
});

describe("shockTooltip (T5)", () => {
  test("fills SHOCK_TOOLTIP verbatim", () => {
    expect(shockTooltip(annotation(45))).toBe(
      "Price moved +45% over the last 7 days.",
    );
    expect(shockTooltip(annotation(-46.15384615384615))).toBe(
      `Price moved ${MINUS}46% over the last 7 days.`,
    );
    expect(shockTooltip(annotation(155.52907530981886))).toBe(
      "Price moved +156% over the last 7 days.",
    );
  });

  test("the locked string's window is shockWindowDays (R3: a param change needs a copy ruling)", () => {
    expect(SHOCK_TOOLTIP).toContain(
      `last ${RECOMMENDATION_PARAMS.shockWindowDays} days`,
    );
  });

  test.each(
    [
      ...CANONICAL_FIXTURES,
      ...TIER2_FIXTURES,
      ...TIER2_DATA_EDGE_FIXTURES,
      ...S3_2_FIXTURES,
    ].map((f, i) => [`${i}:${f.name}`, f] as const),
  )("%s: the filled tooltip holds no forbidden phrase", (_name, f) => {
    const { tier1 } = computeTieredRecommendation(f.input, f.market);
    const shock = tier1.signals.shockAnnotation;
    if (shock === null) return;
    const text = shockTooltip(shock);
    expect(findForbiddenPhrases(text)).toEqual([]);
    expect(text).toMatch(
      new RegExp(`^Price moved [+${MINUS}][1-9]\\d*% over the last 7 days\\.$`),
    );
  });
});
