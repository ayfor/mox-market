// S1.3 ADV-3 (AC-4; F1 W2): the params guardrail holds only if production
// code computes with RECOMMENDATION_PARAMS. computeRecommendation's third
// argument exists for tests, so outside test files every call passes at most
// two arguments, and the engine's param-taking helpers stay inside
// src/lib/recommendation. Read from the TypeScript AST, so comments never
// count. Tuning still happens only by editing RECOMMENDATION_PARAMS. S3.1
// T17: computeTieredRecommendation follows the same two-argument rule,
// servedRecommendation takes only the tiers, and Tier 2's param-taking
// helpers stay inside the engine too. S3.2 T16 adds volatilityWiden,
// latestAgeDays and shockAnnotationOf. S4.1 T12: F4's classify takes
// (card, asOf) outside tests, never a params argument.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const toPosix = (p: string) => p.split(path.sep).join("/");

/** Repo-relative paths of every file under `dir`. */
function filesUnder(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = toPosix(path.join(dir, entry.name));
      if (entry.isDirectory()) {
        return entry.name === "node_modules" ? [] : filesUnder(rel);
      }
      return [rel];
    },
  );
}

const isTest = (file: string) => /\.(test|spec)(-d)?\.[cm]?[jt]sx?$/.test(file);
const isCode = (file: string) => /\.[cm]?[jt]sx?$/.test(file);

/**
 * The engine's public entries and the most arguments production code may
 * pass each: the params argument exists for tests only.
 */
const ENGINE_ENTRIES: ReadonlyMap<string, number> = new Map([
  ["computeRecommendation", 2],
  ["computeTieredRecommendation", 2],
  ["servedRecommendation", 1],
  // S4.1 T12: F4's classifier (card, asOf); its params argument is for tests.
  ["classify", 2],
]);
/** The engine's helpers that take params or a band directly. */
const PARAM_HELPERS = new Set([
  "buildReason",
  "computeHistorySignals",
  "thresholdsBp",
  "readWindow",
  // S3.1 T17: Tier 2's helpers.
  "tier2Thresholds",
  "computeTier2",
  "trendClauseX",
  // S3.2 T16: the volatility factor, staleness and the shock annotation.
  "volatilityWiden",
  "latestAgeDays",
  "shockAnnotationOf",
]);
const ENGINE_DIR = "src/lib/recommendation/";

function scriptKind(file: string): ts.ScriptKind {
  if (/\.[jt]sx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** The call whose callee is `node` (directly or as `ns.name`), or null. */
function callOf(node: ts.Identifier): ts.CallExpression | null {
  const callee =
    ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
      ? node.parent
      : node;
  const call = callee.parent;
  return ts.isCallExpression(call) && call.expression === callee ? call : null;
}

/** Each way `file` could run the engine with params other than RECOMMENDATION_PARAMS. */
function overrides(file: string, source: string): string[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const found: string[] = [];
  const at = (node: ts.Node, why: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push(`${file}:${line + 1} ${why}`);
  };
  const outsideEngine = !file.startsWith(ENGINE_DIR);
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) && ENGINE_ENTRIES.has(node.text)) {
      at(node, `"${node.text}" as a string (indirect access)`);
    }
    const maxArgs = ts.isIdentifier(node)
      ? ENGINE_ENTRIES.get(node.text)
      : undefined;
    if (ts.isIdentifier(node) && maxArgs !== undefined) {
      const entry = node.text;
      const parent = node.parent;
      const call = callOf(node);
      if (ts.isFunctionDeclaration(parent) && parent.name === node) {
        // The definition, in engine.ts.
      } else if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
        if (parent.propertyName !== undefined) {
          at(node, `${entry} renamed on import or export`);
        }
      } else if (call === null) {
        at(node, `${entry} used as a value, not called`);
      } else if (call.arguments.some(ts.isSpreadElement)) {
        at(node, `${entry} called with a spread argument`);
      } else if (call.arguments.length > maxArgs) {
        at(node, `${entry} called with a params argument`);
      }
    }
    if (
      outsideEngine &&
      ts.isIdentifier(node) &&
      PARAM_HELPERS.has(node.text) &&
      !ts.isPropertyAssignment(node.parent)
    ) {
      at(node, `${node.text} used outside src/lib/recommendation`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("production code computes only with RECOMMENDATION_PARAMS (S1.3 ADV-3)", () => {
  test("self-test: flags every params route and passes plain two-argument calls", () => {
    const sample = [
      'import { computeRecommendation } from "@/lib/recommendation/engine";',
      'import { RECOMMENDATION_PARAMS } from "@/lib/recommendation/params";',
      "export const ok = computeRecommendation(i, m);",
      "export const a = computeRecommendation(i, m, { ...RECOMMENDATION_PARAMS, fairBandPct: 6 });",
      "export const b = computeRecommendation(...args);",
      "const f = computeRecommendation;",
      "export const c = computeRecommendation.call(null, i, m, p);",
      'import { computeRecommendation as compute } from "./engine";',
      "export const d = engine.computeRecommendation(i, m, p);",
      "export const e = engine.computeRecommendation(i, m);",
      'export const g = engine["computeRecommendation"](i, m, p);',
      'import { buildReason } from "@/lib/recommendation/reason";',
      "export const h = buildReason(input);",
      "// computeRecommendation(i, m, p) in a comment is ignored",
    ].join("\n");
    expect(overrides("src/app/x.tsx", sample)).toEqual([
      "src/app/x.tsx:4 computeRecommendation called with a params argument",
      "src/app/x.tsx:5 computeRecommendation called with a spread argument",
      "src/app/x.tsx:6 computeRecommendation used as a value, not called",
      "src/app/x.tsx:7 computeRecommendation used as a value, not called",
      "src/app/x.tsx:8 computeRecommendation renamed on import or export",
      "src/app/x.tsx:9 computeRecommendation called with a params argument",
      'src/app/x.tsx:11 "computeRecommendation" as a string (indirect access)',
      "src/app/x.tsx:12 buildReason used outside src/lib/recommendation",
      "src/app/x.tsx:13 buildReason used outside src/lib/recommendation",
    ]);
  });

  test("self-test (S3.1 T17): the tiered entry and the served selection follow the rule", () => {
    const sample = [
      'import { computeTieredRecommendation, servedRecommendation } from "@/lib/recommendation/engine";',
      "export const t = computeTieredRecommendation(i, m);",
      "export const s = servedRecommendation(t);",
      "export const a = computeTieredRecommendation(i, m, p);",
      "export const b = computeTieredRecommendation(...args);",
      "const f = computeTieredRecommendation;",
      'import { computeTieredRecommendation as tiered } from "./engine";',
      "export const c = servedRecommendation(t, p);",
      "export const d = servedRecommendation(...args);",
      'export const e = engine["computeTieredRecommendation"](i, m, p);',
      'import { tier2Thresholds, computeTier2, trendClauseX } from "@/lib/recommendation/tier2";',
      "export const g = tier2Thresholds(s, p);",
      'import { volatilityWiden, latestAgeDays } from "@/lib/recommendation/tier2";',
      'import { shockAnnotationOf } from "@/lib/recommendation/shock";',
    ].join("\n");
    expect(overrides("src/lib/evaluation/x.ts", sample)).toEqual([
      "src/lib/evaluation/x.ts:4 computeTieredRecommendation called with a params argument",
      "src/lib/evaluation/x.ts:5 computeTieredRecommendation called with a spread argument",
      "src/lib/evaluation/x.ts:6 computeTieredRecommendation used as a value, not called",
      "src/lib/evaluation/x.ts:7 computeTieredRecommendation renamed on import or export",
      "src/lib/evaluation/x.ts:8 servedRecommendation called with a params argument",
      "src/lib/evaluation/x.ts:9 servedRecommendation called with a spread argument",
      'src/lib/evaluation/x.ts:10 "computeTieredRecommendation" as a string (indirect access)',
      "src/lib/evaluation/x.ts:11 tier2Thresholds used outside src/lib/recommendation",
      "src/lib/evaluation/x.ts:11 computeTier2 used outside src/lib/recommendation",
      "src/lib/evaluation/x.ts:11 trendClauseX used outside src/lib/recommendation",
      "src/lib/evaluation/x.ts:12 tier2Thresholds used outside src/lib/recommendation",
      "src/lib/evaluation/x.ts:13 volatilityWiden used outside src/lib/recommendation",
      "src/lib/evaluation/x.ts:13 latestAgeDays used outside src/lib/recommendation",
      "src/lib/evaluation/x.ts:14 shockAnnotationOf used outside src/lib/recommendation",
    ]);
  });

  test("self-test (S4.1 T12): classify follows the two-argument rule", () => {
    const sample = [
      'import { classify } from "@/lib/recommendation/classify";',
      "export const ok = classify(card, asOf);",
      "export const a = classify(card, asOf, p);",
      "export const b = classify(...args);",
      "const f = classify;",
      'import { classify as c } from "./classify";',
    ].join("\n");
    expect(overrides("src/lib/evaluation/x.ts", sample)).toEqual([
      "src/lib/evaluation/x.ts:3 classify called with a params argument",
      "src/lib/evaluation/x.ts:4 classify called with a spread argument",
      "src/lib/evaluation/x.ts:5 classify used as a value, not called",
      "src/lib/evaluation/x.ts:6 classify renamed on import or export",
    ]);
  });

  test("the engine's own modules may use the helpers", () => {
    const sample = [
      'import { buildReason } from "./reason";',
      "export const r = buildReason(input);",
    ].join("\n");
    expect(overrides("src/lib/recommendation/engine.ts", sample)).toEqual([]);
  });

  test("no non-test source under src/ or scripts/ passes params to the engine", () => {
    const files = [...filesUnder("src"), ...filesUnder("scripts")].filter(
      (f) => isCode(f) && !isTest(f) && !f.startsWith("src/generated/"),
    );
    expect(files).toEqual(
      expect.arrayContaining([
        "src/lib/recommendation/engine.ts",
        "src/lib/recommendation/tier2.ts",
        "src/lib/recommendation/shock.ts",
        "src/lib/evaluation/build-evaluation.ts",
        "src/lib/evaluation/shock-tooltip.ts",
        "src/lib/recommendation/classify.ts",
        "src/app/page.tsx",
        "scripts/test-report.mjs",
      ]),
    );
    const offenders = files.flatMap((file) =>
      overrides(file, readFileSync(path.join(ROOT, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
