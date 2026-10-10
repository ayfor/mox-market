/// <reference types="vite/types/import-meta.d.ts" />
// T5, T6, T7 (S1.3, AC-2, AC-5; S1.3d4): the one forbidden-phrase list, its
// matcher, and the lint over every copy module and every reason the engine
// assembles.
import { describe, expect, test } from "vitest";
import * as copyModule from "./copy";
import { CLAUSE_SEPARATOR, REASON_COPY, SENTENCE_END } from "./copy";
import { computeRecommendation } from "./engine";
import { CANONICAL_FIXTURES } from "./fixtures";
import { FORBIDDEN_PHRASES, findForbiddenPhrases } from "./forbidden-phrases";
import { RECOMMENDATION_PARAMS } from "./params";
import { buildReason } from "./reason";
import type { Confidence, RecommendationKind } from "./types";
import * as uiCopyModule from "./ui-copy";
import { FINISH_LABELS, UI_COPY } from "./ui-copy";

describe("FORBIDDEN_PHRASES (T5)", () => {
  test("equals F1's list, in F1's order", () => {
    expect(FORBIDDEN_PHRASES).toEqual([
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
    ]);
  });

  test("is frozen", () => {
    expect(Object.isFrozen(FORBIDDEN_PHRASES)).toBe(true);
    expect(() => {
      (FORBIDDEN_PHRASES as unknown as string[]).push("soon");
    }).toThrow(TypeError);
  });
});

const upper = (s: string) => s.toUpperCase();
const mixed = (s: string) =>
  [...s].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join("");
/** Fullwidth Latin letters, which NFKC folds back to ASCII. */
const fullwidth = (s: string) =>
  [...s]
    .map((c) =>
      /[a-z]/i.test(c)
        ? String.fromCodePoint(c.codePointAt(0)! - 0x21 + 0xff01)
        : c,
    )
    .join("");

describe("findForbiddenPhrases (T5)", () => {
  test.each(FORBIDDEN_PHRASES.map((p) => [p]))(
    "flags %j in lower, UPPER, Mixed and fullwidth letters",
    (phrase) => {
      for (const variant of [phrase, upper(phrase), mixed(phrase)]) {
        expect(findForbiddenPhrases(`Prices ${variant} here`)).toContain(
          phrase,
        );
      }
      expect(fullwidth(phrase)).not.toBe(phrase);
      expect(findForbiddenPhrases(fullwidth(phrase))).toContain(phrase);
    },
  );

  test.each([
    ["unlikely", ["likely"]],
    ["Predicted", ["predict"]],
    ["forecasting", ["forecast"]],
    ["shouldn't", ["should"]],
    ["improbably", ["probably"]],
    ["unexpectedly", ["expect", "expected"]],
    ["predictable", ["predict"]],
  ])("flags %j inside a word", (text, expected) => {
    expect(findForbiddenPhrases(text)).toEqual(expected);
  });

  test.each([
    ["two spaces", "will  rise"],
    ["a newline", "will\nfall"],
    ["a tab", "will\tdrop"],
    ["U+00A0", "will\u00a0climb"],
    ["CRLF and spaces", "will \r\n rise"],
  ])("flags a multi-word phrase across %s", (_name, text) => {
    expect(findForbiddenPhrases(text)).toHaveLength(1);
    expect(findForbiddenPhrases(text)[0]).toMatch(/^will /);
  });

  test.each([
    ["U+200B", "lik\u200bely", "likely"],
    ["U+00AD", "pre\u00addict", "predict"],
    ["U+2060", "fore\u2060cast", "forecast"],
    ["U+200B between words", "will\u200b rise", "will rise"],
    ["U+FEFF", "sh\ufeffould", "should"],
  ])("flags a phrase with %s inside it", (_name, text, phrase) => {
    expect(findForbiddenPhrases(text)).toEqual([phrase]);
  });

  test("returns each phrase once, in list order", () => {
    expect(
      findForbiddenPhrases("You should, should, SHOULD buy; likely, likely."),
    ).toEqual(["likely", "should"]);
    expect(findForbiddenPhrases("predict forecast probably")).toEqual([
      "probably",
      "forecast",
      "predict",
    ]);
  });

  test.each([
    "9% below market.",
    "like 74.99",
    "Rises 5%",
    "will",
    "falling 18%",
    "",
    "Within 2% of market; only 10 price snapshots.",
  ])("passes %j", (text) => {
    expect(findForbiddenPhrases(text)).toEqual([]);
  });
});

// --- T6: every string of every copy module -----------------------------------
interface Found {
  readonly path: string;
  readonly text: string;
}

/**
 * Every string reachable from `value`, with its key path (`A.b[1]`).
 * Functions are skipped; objects, arrays and tuples are walked; a cycle stops.
 */
function stringsIn(
  value: unknown,
  at: string,
  seen: Set<object> = new Set(),
): Found[] {
  if (typeof value === "string") return [{ path: at, text: value }];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const found = Array.isArray(value)
    ? value.flatMap((item, i) => stringsIn(item, `${at}[${i}]`, seen))
    : Object.entries(value).flatMap(([key, item]) =>
        stringsIn(item, at ? `${at}.${key}` : key, seen),
      );
  seen.delete(value);
  return found;
}

/** Every non-test module under src/lib/copy (S2.4's entry-points.ts joins on arrival). */
const LIB_COPY_MODULES = import.meta.glob(
  ["../copy/*.ts", "!../copy/*.test.ts", "!../copy/*.test-d.ts"],
  { eager: true },
);

const COPY_MODULES: Record<string, unknown> = {
  "recommendation/copy.ts": copyModule,
  "recommendation/ui-copy.ts": uiCopyModule,
  ...Object.fromEntries(
    Object.entries(LIB_COPY_MODULES).map(([file, mod]) => [
      file.replace(/^\.\.\//, ""),
      mod,
    ]),
  ),
};

const findingsIn = (strings: Found[]) =>
  strings.flatMap(({ path, text }) =>
    findForbiddenPhrases(text).map((phrase) => `${path}: "${phrase}"`),
  );

describe("no copy module holds a forbidden phrase (T6)", () => {
  test("the walker skips functions, reaches nested objects and tuples, and names the key path", () => {
    const SAMPLE = Object.freeze({
      fine: "9% below market.",
      fn: () => "will rise",
      nested: Object.freeze(["ok", "Prices will  rise", { deep: "Likely." }]),
    });
    const strings = stringsIn({ SAMPLE }, "");
    expect(strings.map((s) => s.path)).toEqual([
      "SAMPLE.fine",
      "SAMPLE.nested[0]",
      "SAMPLE.nested[1]",
      "SAMPLE.nested[2].deep",
    ]);
    expect(findingsIn(strings)).toEqual([
      'SAMPLE.nested[1]: "will rise"',
      'SAMPLE.nested[2].deep: "likely"',
    ]);
  });

  test("the module list holds copy.ts, ui-copy.ts and src/lib/copy/legal.ts, and no test file", () => {
    const names = Object.keys(COPY_MODULES);
    expect(names).toEqual(
      expect.arrayContaining([
        "recommendation/copy.ts",
        "recommendation/ui-copy.ts",
        "copy/legal.ts",
      ]),
    );
    expect(names.some((n) => /\.test(-d)?\.ts$/.test(n))).toBe(false);
  });

  test.each(Object.keys(COPY_MODULES))(
    "%s has strings, and none holds a forbidden phrase",
    (name) => {
      const strings = stringsIn(COPY_MODULES[name], "");
      expect(strings.length).toBeGreaterThan(0);
      expect(findingsIn(strings)).toEqual([]);
    },
  );

  test("the walk reaches every key of REASON_COPY, UI_COPY and FINISH_LABELS", () => {
    const copyPaths = stringsIn(copyModule, "").map((s) => s.path);
    for (const key of Object.keys(REASON_COPY)) {
      expect(copyPaths).toContain(`REASON_COPY.${key}`);
    }
    for (const name of [
      "FALLBACK_NOTICE",
      "SHOCK_TOOLTIP",
      "CLAUSE_SEPARATOR",
      "SENTENCE_END",
    ]) {
      expect(copyPaths).toContain(name);
    }
    const uiPaths = stringsIn(uiCopyModule, "").map((s) => s.path);
    for (const key of Object.keys(UI_COPY)) {
      expect(uiPaths).toContain(`UI_COPY.${key}`);
    }
    for (const key of Object.keys(FINISH_LABELS)) {
      expect(uiPaths).toContain(`FINISH_LABELS.${key}`);
    }
  });
});

// --- T7: every reason the engine can assemble at Tier 1 ---------------------
/** T3's grammar, rebuilt here from the copy module (see copy.test.ts). */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clause = (template: string) =>
  escape(template).replace(/\\\{X\\\}|\\\{n\\\}/g, "[1-9]\\d*");
const TIER1_REASON = new RegExp(
  `^(?:${escape(REASON_COPY.insufficientData)}|(?:${[
    REASON_COPY.atMarket,
    REASON_COPY.within,
    REASON_COPY.below,
    REASON_COPY.above,
  ]
    .map(clause)
    .join("|")})(?:${escape(CLAUSE_SEPARATOR)}${clause(
    REASON_COPY.thinData,
  )})?${escape(SENTENCE_END)})$`,
);

/** Every deltaBp from `from` to `to`, inclusive. */
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("no assembled reason holds a forbidden phrase (T7)", () => {
  test("the matrix's ranges are F1's Tier-1 bands", () => {
    const bandPct = RECOMMENDATION_PARAMS.fairBandPct;
    expect(Math.round(bandPct * 100)).toBe(500);
    expect(
      Math.round(
        (-bandPct * 100) / RECOMMENDATION_PARAMS.buyThresholdAsymmetry,
      ),
    ).toBe(-833);
  });

  test("every canonical fixture's reason is clean and grammatical", () => {
    for (const f of CANONICAL_FIXTURES) {
      const { reason } = computeRecommendation(f.input, f.market);
      expect(findForbiddenPhrases(reason), f.name).toEqual([]);
      expect(reason, f.name).toMatch(TIER1_REASON);
    }
  });

  test("buildReason over every deltaBp each kind can carry, at high and low, plus insufficient_data", () => {
    const matrix: [RecommendationKind, number[]][] = [
      ["buy", range(-10000, -834)],
      ["fair", range(-833, 500)],
      ["wait", [...range(501, 10000), 99_999_990_000]],
    ];
    const bad: string[] = [];
    let calls = 0;
    let n = 7;
    for (const [kind, deltas] of matrix) {
      for (const deltaBp of deltas) {
        for (const confidence of ["high", "low"] as Confidence[]) {
          const reason = buildReason({
            kind,
            deltaBp,
            bandPct: RECOMMENDATION_PARAMS.fairBandPct,
            confidence,
            snapshotCount30d: confidence === "low" ? n : 30,
          });
          n = n === 13 ? 7 : n + 1;
          calls += 1;
          if (
            findForbiddenPhrases(reason).length > 0 ||
            !TIER1_REASON.test(reason)
          ) {
            bad.push(`${kind} ${deltaBp} ${confidence}: ${reason}`);
          }
        }
      }
    }
    const insufficient = buildReason({
      kind: "insufficient_data",
      deltaBp: null,
      bandPct: RECOMMENDATION_PARAMS.fairBandPct,
      confidence: "low",
      snapshotCount30d: 6,
    });
    expect(findForbiddenPhrases(insufficient)).toEqual([]);
    expect(insufficient).toMatch(TIER1_REASON);
    expect(calls).toBe(2 * (9167 + 1334 + 9501));
    expect(bad).toEqual([]);
  });
});
