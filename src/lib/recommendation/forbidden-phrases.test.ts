/// <reference types="vite/types/import-meta.d.ts" />
// T5, T6, T7 (S1.3, AC-2, AC-5; S1.3d4): the one forbidden-phrase list, its
// matcher, and the lint over every copy module and every reason the engine
// assembles.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import * as copyModule from "./copy";
import { CLAUSE_SEPARATOR, REASON_COPY, SENTENCE_END } from "./copy";
import { computeRecommendation } from "./engine";
import { CANONICAL_FIXTURES } from "./fixtures";
import { findForbiddenPhrases, FORBIDDEN_PHRASES } from "./forbidden-phrases";
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

  test.each([
    ["a combining acute (U+0301)", "pre\u0301dict", ["predict"]],
    ["a precomposed accent (U+00E9)", "pr\u00e9dict", ["predict"]],
    ["the grapheme joiner (U+034F)", "lik\u034fely", ["likely"]],
    ["a variation selector (U+FE0F)", "sho\ufe0fuld", ["should"]],
    ["a Hangul filler (U+3164)", "pre\u3164dict", ["predict"]],
    ["a halfwidth Hangul filler (U+FFA0)", "fore\uffa0cast", ["forecast"]],
    ["Cyrillic o (U+043E)", "sh\u043euld", ["should"]],
    ["Cyrillic e (U+0435)", "\u0435xpected", ["expect", "expected"]],
    ["Cyrillic capitals", "\u0405H\u041eULD", ["should"]],
    ["Greek capitals", "PR\u0395DICT", ["predict"]],
    ["dotted capital I (U+0130)", "L\u0130KELY", ["likely"]],
    ["a hyphen", "will-rise", ["will rise"]],
    ["a spaced em dash", "will \u2014 fall", ["will fall"]],
  ])("flags a phrase disguised with %s (ADV-7)", (_name, text, phrases) => {
    expect(findForbiddenPhrases(text)).toEqual(phrases);
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
    "30-day trend is falling 18%",
    "third-party data",
    "Price history: 12 snapshots, newest 3 hours ago",
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
 * Functions are skipped; objects, arrays, tuples, Map keys and values and Set
 * values are walked (ADV-5); a cycle stops. The source pass below reads what
 * a walk cannot reach: strings inside functions, unexported consts, getters.
 */
function stringsIn(
  value: unknown,
  at: string,
  seen: Set<object> = new Set(),
): Found[] {
  if (typeof value === "string") return [{ path: at, text: value }];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  let found: Found[];
  if (value instanceof Map) {
    found = [...value.entries()].flatMap(([key, item], i) => [
      ...stringsIn(key, `${at}.keys[${i}]`, seen),
      ...stringsIn(item, `${at}.values[${i}]`, seen),
    ]);
  } else if (value instanceof Set) {
    found = [...value].flatMap((item, i) =>
      stringsIn(item, `${at}.values[${i}]`, seen),
    );
  } else if (Array.isArray(value)) {
    found = value.flatMap((item, i) => stringsIn(item, `${at}[${i}]`, seen));
  } else {
    found = Object.entries(value).flatMap(([key, item]) =>
      stringsIn(item, at ? `${at}.${key}` : key, seen),
    );
  }
  seen.delete(value);
  return found;
}

/** Every non-test module under src/lib/copy, at any depth (ADV-5; S2.4's entry-points.ts joins on arrival). */
const LIB_COPY_MODULES = import.meta.glob(
  [
    "../copy/**/*.{ts,tsx}",
    "!../copy/**/*.test.{ts,tsx}",
    "!../copy/**/*.test-d.ts",
    "!../copy/**/*.d.ts",
  ],
  { eager: true },
);

const LIB_DIR = path.resolve(__dirname, "..");

/** Every non-test .ts or .tsx file under src/lib/copy, as "copy/<path>". */
function copyDirModules(dir: string = path.join(LIB_DIR, "copy")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return copyDirModules(full);
    return /\.tsx?$/.test(entry.name) &&
      !/\.test(-d)?\.tsx?$/.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name)
      ? [path.relative(LIB_DIR, full).split(path.sep).join("/")]
      : [];
  });
}

/** "<folder>/<file>" under src/lib → module namespace. */
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

/**
 * Text in a module's source, read from the AST (ADV-5): string literals,
 * template parts and whole templates (placeholders read as a space), JSX
 * text, and `+` chains of literals. Comments never count.
 */
function sourceStrings(file: string, source: string): Found[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Found[] = [];
  const add = (node: ts.Node, text: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push({ path: `${file}:${line + 1}`, text });
  };
  /** The joined text of a `+` chain of literals, or null. */
  const literalChain = (node: ts.Node): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return node.text;
    if (ts.isParenthesizedExpression(node))
      return literalChain(node.expression);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = literalChain(node.left);
      const right = literalChain(node.right);
      return left === null || right === null ? null : left + right;
    }
    return null;
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      add(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      add(
        node,
        [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(
          " ",
        ),
      );
    } else if (
      ts.isBinaryExpression(node) &&
      !(
        ts.isBinaryExpression(node.parent) &&
        node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken
      )
    ) {
      const chain = literalChain(node);
      if (chain !== null) add(node, chain);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * Marketing copy allowed to hold a forbidden phrase (ADV-4; S1.3d14): each
 * entry names the module, the export key path, the exact string and exactly
 * the phrases it holds, so any other string, a changed string or a new phrase
 * still fails. The source pass, which has no key paths, matches the module
 * and the exact string. Empty at S1.3. S2.4 (S2.4d5, S2.4d12) adds the
 * question the landing page's ruby band asks, "Should you buy it?": a
 * question to the user, not a prediction. One string, not its three display
 * lines, because a literal that is exactly a phrase ("Should") fails
 * copy-lock's T8 (S2.4 Deviation 1). Josh can overturn (reword the tagline).
 */
interface LintAllowance {
  readonly module: string;
  readonly path: string;
  readonly text: string;
  readonly phrases: readonly string[];
}
const LINT_ALLOWLIST: readonly LintAllowance[] = [
  {
    module: "copy/entry-points.ts",
    path: "LANDING_COPY.question",
    text: "Should you buy it?",
    phrases: ["should"],
  },
];

const allowedBy =
  (list: readonly LintAllowance[], module: string, source: boolean) =>
  ({ path: at, text }: Found, phrases: readonly string[]) =>
    list.some(
      (a) =>
        a.module === module &&
        (source || a.path === at) &&
        a.text === text &&
        a.phrases.join() === phrases.join(),
    );

function findingsIn(
  strings: Found[],
  allowed: (found: Found, phrases: readonly string[]) => boolean = () => false,
): string[] {
  return strings.flatMap((found) => {
    const phrases = findForbiddenPhrases(found.text);
    if (phrases.length === 0 || allowed(found, phrases)) return [];
    return phrases.map((phrase) => `${found.path}: "${phrase}"`);
  });
}

describe("no copy module holds a forbidden phrase (T6)", () => {
  test("the walker skips functions, reaches nested objects, tuples, Maps and Sets, and names the key path", () => {
    const SAMPLE = Object.freeze({
      fine: "9% below market.",
      fn: () => "will rise",
      nested: Object.freeze(["ok", "Prices will  rise", { deep: "Likely." }]),
      map: new Map([["k", "likely"]]),
      set: new Set(["Probably"]),
    });
    const strings = stringsIn({ SAMPLE }, "");
    expect(strings.map((s) => s.path)).toEqual([
      "SAMPLE.fine",
      "SAMPLE.nested[0]",
      "SAMPLE.nested[1]",
      "SAMPLE.nested[2].deep",
      "SAMPLE.map.keys[0]",
      "SAMPLE.map.values[0]",
      "SAMPLE.set.values[0]",
    ]);
    expect(findingsIn(strings)).toEqual([
      'SAMPLE.nested[1]: "will rise"',
      'SAMPLE.nested[2].deep: "likely"',
      'SAMPLE.map.values[0]: "likely"',
      'SAMPLE.set.values[0]: "probably"',
    ]);
  });

  test("self-test: the source pass reads strings a walk cannot reach (ADV-5)", () => {
    const sample = [
      'export function relativeLabel() { return "Prices will rise soon"; }',
      'const hidden = "Likely a typo";',
      "export const t = (x: number) => `${x} will ${x}climb`;",
      'export const c = "will " + ("dr" + "op");',
      "export const P = () => <p>Probably fine</p>;",
      "// a comment that says should is ignored",
      'export const ok = "9% below market.";',
    ].join("\n");
    expect(findingsIn(sourceStrings("x.tsx", sample))).toEqual([
      'x.tsx:1: "will rise"',
      'x.tsx:2: "likely"',
      'x.tsx:3: "will climb"',
      'x.tsx:4: "will drop"',
      'x.tsx:5: "probably"',
    ]);
  });

  test("the module list is every non-test module under src/lib/copy, at any depth, plus copy.ts and ui-copy.ts (ADV-5)", () => {
    const globbed = Object.keys(LIB_COPY_MODULES).map((f) =>
      f.replace(/^\.\.\//, ""),
    );
    expect(globbed.sort()).toEqual(copyDirModules().sort());
    expect(globbed).toContain("copy/legal.ts");
    expect(Object.keys(COPY_MODULES).sort()).toEqual(
      [
        "recommendation/copy.ts",
        "recommendation/ui-copy.ts",
        ...copyDirModules(),
      ].sort(),
    );
  });

  test.each(Object.keys(COPY_MODULES))(
    "%s has strings, and none holds a forbidden phrase",
    (name) => {
      const strings = stringsIn(COPY_MODULES[name], "");
      expect(strings.length).toBeGreaterThan(0);
      expect(
        findingsIn(strings, allowedBy(LINT_ALLOWLIST, name, false)),
      ).toEqual([]);
    },
  );

  test.each(Object.keys(COPY_MODULES))(
    "%s source holds no forbidden phrase in any literal (ADV-5)",
    (name) => {
      const file = path.join(LIB_DIR, name);
      const strings = sourceStrings(name, readFileSync(file, "utf8"));
      expect(strings.length).toBeGreaterThan(0);
      expect(
        findingsIn(strings, allowedBy(LINT_ALLOWLIST, name, true)),
      ).toEqual([]);
    },
  );

  test("self-test: an allowance passes exactly its string and nothing else (ADV-4)", () => {
    const list: LintAllowance[] = [
      {
        module: "copy/entry-points.ts",
        path: "LANDING_TITLE",
        text: "Mox Market — Should you buy it?",
        phrases: ["should"],
      },
    ];
    const allow = allowedBy(list, "copy/entry-points.ts", false);
    const at = (path: string, text: string) => [{ path, text }];
    expect(
      findingsIn(at("LANDING_TITLE", "Mox Market — Should you buy it?"), allow),
    ).toEqual([]);
    expect(
      findingsIn(at("LANDING_TITLE", "Mox Market — You should buy it"), allow),
    ).toEqual(['LANDING_TITLE: "should"']);
    expect(
      findingsIn(at("OTHER", "Mox Market — Should you buy it?"), allow),
    ).toEqual(['OTHER: "should"']);
    expect(
      findingsIn(
        at("LANDING_TITLE", "Mox Market — Should you buy it? Likely."),
        allow,
      ),
    ).toEqual(['LANDING_TITLE: "likely"', 'LANDING_TITLE: "should"']);
    expect(
      findingsIn(
        at("LANDING_TITLE", "Mox Market — Should you buy it?"),
        allowedBy(list, "copy/other.ts", false),
      ),
    ).toEqual(['LANDING_TITLE: "should"']);
    // The same entry covers the source pass, by module and exact string.
    const source = sourceStrings(
      "copy/entry-points.ts",
      'export const LANDING_TITLE = "Mox Market — Should you buy it?";\nconst x = "You should buy it";',
    );
    expect(
      findingsIn(source, allowedBy(list, "copy/entry-points.ts", true)),
    ).toEqual(['copy/entry-points.ts:2: "should"']);
  });

  test("the allowlist holds exactly the landing question (S2.4d5, T15)", () => {
    expect(LINT_ALLOWLIST).toEqual([
      {
        module: "copy/entry-points.ts",
        path: "LANDING_COPY.question",
        text: "Should you buy it?",
        phrases: ["should"],
      },
    ]);
    expect(Object.keys(COPY_MODULES)).toContain("copy/entry-points.ts");
  });

  test("every allowance matches a live export exactly, with exactly its phrases (ADV-4)", () => {
    for (const a of LINT_ALLOWLIST) {
      const hit = stringsIn(COPY_MODULES[a.module], "").find(
        (s) => s.path === a.path && s.text === a.text,
      );
      expect(hit, `${a.module} → ${a.path}`).toBeDefined();
      expect(findForbiddenPhrases(a.text)).toEqual([...a.phrases]);
    }
  });

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
