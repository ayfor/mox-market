// T1, T3, T4, T9, T10, T20 (S1.3, AC-1, AC-3, AC-5, AC-6): F1's Locked copy
// table as frozen constants, the Tier-1 reason grammar, no copy in the engine's
// logic modules, and every Tier-1 reason pinned. Strings are compared with
// literals written here, never with a snapshot (as S2.2's legal test).
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import {
  CLAUSE_SEPARATOR,
  FALLBACK_NOTICE,
  REASON_COPY,
  SENTENCE_END,
  SHOCK_TOOLTIP,
} from "./copy";
import { computeRecommendation } from "./engine";
import {
  CANONICAL_FIXTURES,
  canonicalFixture,
  fixtureInput,
  fixtureMarket,
  flat,
  INSUFFICIENT_DATA_SENTENCE,
} from "./fixtures";
import { RECOMMENDATION_PARAMS } from "./params";
import { buildReason } from "./reason";
import type { Confidence, RecommendationKind } from "./types";

const ENGINE_DIR = path.resolve(__dirname);

/** F1's insufficient_data sentence, written out here (U+2014, U+0027). */
const INSUFFICIENT =
  "We don't have enough pricing data on this printing to give a recommendation — try a different printing.";

describe("REASON_COPY is F1's Locked copy table (T1)", () => {
  test("every template equals F1's text", () => {
    expect(REASON_COPY).toStrictEqual({
      insufficientData: INSUFFICIENT,
      atMarket: "At market price",
      within: "Within {X}% of market",
      below: "{X}% below market",
      above: "{X}% above market",
      thinData: "only {n} price snapshots",
      stale: "latest price data is {d} days old",
      trend: "30-day trend is {direction} {X}%",
      volatility: "price has been volatile (±{X}%)",
    });
  });

  test("the notices, the separator and the sentence end equal F1's text", () => {
    expect(FALLBACK_NOTICE).toBe(
      "This printing has no {finish} price — showing Normal pricing.",
    );
    expect(SHOCK_TOOLTIP).toBe("Price moved {signedX}% over the last 7 days.");
    expect(CLAUSE_SEPARATOR).toBe("; ");
    expect(SENTENCE_END).toBe(".");
  });

  test("REASON_COPY is frozen, so a stray write throws", () => {
    expect(Object.isFrozen(REASON_COPY)).toBe(true);
    expect(() => {
      (REASON_COPY as { within: string }).within = "Around {X}% of market";
    }).toThrow(TypeError);
    expect(REASON_COPY.within).toBe("Within {X}% of market");
  });

  test("copy.ts imports nothing and loads no markdown", () => {
    // Code only: comments may name files and quote copy.
    const source = readFileSync(path.join(ENGINE_DIR, "copy.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(source).toContain("export const REASON_COPY");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/^\s*export\s+(\*|\{[^}]*\})\s+from\b/m);
    expect(source).not.toMatch(/\.md\b/);
    expect(source).not.toMatch(/\bfs\b/);
  });
});

// --- T3: the Tier-1 grammar, built from the copy module at test time --------
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole number from 1, with no sign or leading zero. */
const POSITIVE = "[1-9]\\d*";
const clause = (template: string) =>
  escape(template).replace(/\\\{X\\\}|\\\{n\\\}/g, POSITIVE);

/**
 * Exactly the insufficient_data sentence, or one primary clause, an optional
 * thin-data clause and one sentence end. No trend, stale or volatility clause
 * exists at Tier 1 (F3 is Draft).
 */
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

describe("Tier-1 reason grammar (T3)", () => {
  test.each([
    "9% below market.",
    "Within 2% of market.",
    "At market price.",
    "At market price; only 7 price snapshots.",
    "19% above market; only 10 price snapshots.",
    "999999900% above market.",
    INSUFFICIENT,
  ])("accepts %j", (reason) => {
    expect(reason).toMatch(TIER1_REASON);
  });

  test.each([
    "9% below market",
    "9% below market..",
    "9% below market; 30-day trend is falling 18%.",
    "9% below market; only 10 price snapshots; only 10 price snapshots.",
    "Within -5% of market.",
    "At market price; only 0 price snapshots.",
    "Within 05% of market.",
    "Within 0% of market.",
    "9% below market. ",
    `${INSUFFICIENT}.`,
    `${INSUFFICIENT.slice(0, -1)}; only 7 price snapshots.`,
  ])("rejects %j", (reason) => {
    expect(reason).not.toMatch(TIER1_REASON);
  });

  test("every canonical fixture's reason matches", () => {
    for (const f of CANONICAL_FIXTURES) {
      expect(computeRecommendation(f.input, f.market).reason).toMatch(
        TIER1_REASON,
      );
    }
  });
});

// --- T4: no copy-like literal in the engine's logic modules (S1.3d6) --------
/** Modules that assemble or carry reasons; validate.ts and errors.ts hold developer messages. */
const LOGIC_MODULES = [
  "engine.ts",
  "reason.ts",
  "bands.ts",
  "signals.ts",
  "window.ts",
  "types.ts",
];

/** An import or export specifier, `import("…")` or `import type("…")`. */
function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) {
    return parent.moduleSpecifier === node;
  }
  if (ts.isExternalModuleReference(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return ts.isImportTypeNode(parent.parent);
  return (
    ts.isCallExpression(parent) &&
    parent.expression.kind === ts.SyntaxKind.ImportKeyword
  );
}

/** Text that reads like copy: whitespace, a percent sign, an em dash or a final full stop. */
const COPY_LIKE = /\s|%|—|\.$/;

/** Copy-like string or template text in `source`, read from the AST. */
function copyLiterals(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isModuleSpecifier(node)) text = node.text;
    } else if (
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text;
    }
    if (text !== null && COPY_LIKE.test(text)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      found.push(`${path.basename(file)}:${line + 1} ${JSON.stringify(text)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("the engine's logic modules hold no copy (T4)", () => {
  test("the scanner flags copy-like literals and passes enum values, comments and imports", () => {
    const sample = [
      'const a = "At market price";',
      "const b = `${x}% below market`;",
      'const c = "only " + n;',
      'const d = "Within" + " ";',
      'const e = "insufficient_data";',
      'const f = "low";',
      'const g = "-";',
      '// "9% below market." quoted in a comment',
      '/** "Within {X}% of market" in JSDoc */',
      'import { REASON_COPY } from "./copy";',
      'export { buildReason } from "./reason";',
      'const h = "Done.";',
    ].join("\n");
    expect(copyLiterals("sample.ts", sample)).toEqual([
      'sample.ts:1 "At market price"',
      'sample.ts:2 "% below market"',
      'sample.ts:3 "only "',
      'sample.ts:4 " "',
      'sample.ts:12 "Done."',
    ]);
  });

  test.each(LOGIC_MODULES)("%s holds no copy-like literal", (name) => {
    const file = path.join(ENGINE_DIR, name);
    expect(copyLiterals(file, readFileSync(file, "utf8"))).toEqual([]);
  });
});

// --- T9: every Tier-1 reason, written out here ------------------------------
const TIER1_REASONS: Record<string, string> = {
  A: "9% below market.",
  C: "9% below market.",
  B: "Within 2% of market.",
  G: "Within 2% of market.",
  F: "10% above market.",
  D: "19% above market; only 10 price snapshots.",
  "D-buy": "14% below market; only 10 price snapshots.",
  "A-rising": "Within 5% of market.",
  D0: INSUFFICIENT,
  E: INSUFFICIENT,
};

describe("Tier-1 reasons are locked (T9, AC-3)", () => {
  test("the table covers every canonical fixture", () => {
    expect(Object.keys(TIER1_REASONS).sort()).toEqual(
      CANONICAL_FIXTURES.map((f) => f.name).sort(),
    );
  });

  test.each(Object.entries(TIER1_REASONS))(
    "fixture %s gives %j",
    (name, reason) => {
      const f = canonicalFixture(name);
      expect(computeRecommendation(f.input, f.market).reason).toBe(reason);
    },
  );

  test("fixtures.ts's expected reasons equal this table (S1.3d12)", () => {
    for (const f of CANONICAL_FIXTURES) {
      expect(f.expected.reason, f.name).toBe(TIER1_REASONS[f.name]);
    }
    expect(INSUFFICIENT_DATA_SENTENCE).toBe(INSUFFICIENT);
    expect(REASON_COPY.insufficientData).toBe(INSUFFICIENT);
  });

  test("the insufficient_data sentence has a straight apostrophe and an em dash", () => {
    const points = [...REASON_COPY.insufficientData].map((c) =>
      c.codePointAt(0),
    );
    expect(points).toContain(0x27);
    expect(points).toContain(0x2014);
    expect(points).not.toContain(0x2019);
    expect(points).not.toContain(0x2013);
    expect(REASON_COPY.insufficientData).toContain("don't");
  });

  test("no Tier-1 reason carries a Tier-2 clause", () => {
    for (const f of CANONICAL_FIXTURES) {
      const { reason } = computeRecommendation(f.input, f.market);
      for (const word of ["trend", "volatile", "days old"]) {
        expect(reason, f.name).not.toContain(word);
      }
    }
  });
});

// --- T10 and T20: the X rule and both fair frames ---------------------------
const reasonFor = (
  kind: RecommendationKind,
  deltaBp: number,
  bandPct = 5,
  confidence: Confidence = "high",
  snapshotCount30d = 30,
) => buildReason({ kind, deltaBp, bandPct, confidence, snapshotCount30d });

const engineReason = (asking: number, market: number, fairBandPct?: number) =>
  computeRecommendation(
    fixtureInput(asking),
    fixtureMarket(market, flat(30, market)),
    fairBandPct === undefined
      ? RECOMMENDATION_PARAMS
      : { ...RECOMMENDATION_PARAMS, fairBandPct },
  );

describe("X rounding rule (T10, AC-3; S1.2 D8)", () => {
  test("8130 against 8150 reads At market price", () => {
    expect(engineReason(8130, 8150).reason).toBe("At market price.");
  });

  test.each([
    [-9849, "98% below market."],
    [-9850, "99% below market."],
    [-9950, "99% below market."],
    [-10000, "99% below market."],
  ])("buy at deltaBp %i → %j (a below clause states at most 99%)", (bp, r) => {
    expect(reasonFor("buy", bp)).toBe(r);
  });

  test("wait at +10000 states 100%: an above clause is not capped", () => {
    expect(reasonFor("wait", 10000)).toBe("100% above market.");
  });

  test("through the engine, asking 1 against 30,000 reads 99% below market", () => {
    const r = engineReason(1, 30000);
    expect(r.kind).toBe("buy");
    expect(r.reason).toBe("99% below market.");
  });
});

describe("the fair row carries both frames (T20, AC-6)", () => {
  test.each([
    [5, -500, "Within 5% of market."],
    [5, 500, "Within 5% of market."],
    [5, -501, "5% below market."],
    [5, 501, "5% above market."],
    [5, -49, "At market price."],
    [10, -1000, "Within 10% of market."],
    [10, -1001, "10% below market."],
    [2.5, -250, "Within 3% of market."],
    [2.5, -251, "3% below market."],
  ])("bandPct %d, fair at deltaBp %i → %j", (bandPct, bp, reason) => {
    expect(reasonFor("fair", bp, bandPct)).toBe(reason);
  });

  test("low confidence appends the thin-data caveat on both frames", () => {
    expect(reasonFor("fair", -500, 5, "low", 7)).toBe(
      "Within 5% of market; only 7 price snapshots.",
    );
    expect(reasonFor("fair", -501, 5, "low", 7)).toBe(
      "5% below market; only 7 price snapshots.",
    );
    expect(reasonFor("fair", 501, 5, "low", 7)).toBe(
      "5% above market; only 7 price snapshots.",
    );
  });

  test("through the engine: 9499 against 10000 is fair, high, 5% below market", () => {
    const r = engineReason(9499, 10000);
    expect(r.signals.deltaBp).toBe(-501);
    expect(r.kind).toBe("fair");
    expect(r.confidence).toBe("high");
    expect(r.reason).toBe("5% below market.");
  });

  test("through the engine with fairBandPct 10: the within frame up to the band, the below frame past it", () => {
    const within = engineReason(9000, 10000, 10);
    expect(within.kind).toBe("fair");
    expect(within.reason).toBe("Within 10% of market.");
    const below = engineReason(8999, 10000, 10);
    expect(below.kind).toBe("fair");
    expect(below.reason).toBe("10% below market.");
  });
});
