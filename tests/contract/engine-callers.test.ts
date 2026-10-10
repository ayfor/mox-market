// S1.3 ADV-3 (AC-4; F1 W2): the params guardrail holds only if production
// code computes with RECOMMENDATION_PARAMS. computeRecommendation's third
// argument exists for tests, so outside test files every call passes at most
// two arguments, and the engine's param-taking helpers stay inside
// src/lib/recommendation. Read from the TypeScript AST, so comments never
// count. Tuning still happens only by editing RECOMMENDATION_PARAMS.
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

const ENGINE_ENTRY = "computeRecommendation";
/** The engine's helpers that take params or a band directly. */
const PARAM_HELPERS = new Set([
  "buildReason",
  "computeHistorySignals",
  "thresholdsBp",
  "readWindow",
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
    if (ts.isStringLiteral(node) && node.text === ENGINE_ENTRY) {
      at(node, `"${ENGINE_ENTRY}" as a string (indirect access)`);
    }
    if (ts.isIdentifier(node) && node.text === ENGINE_ENTRY) {
      const parent = node.parent;
      const call = callOf(node);
      if (ts.isFunctionDeclaration(parent) && parent.name === node) {
        // The definition, in engine.ts.
      } else if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
        if (parent.propertyName !== undefined) {
          at(node, `${ENGINE_ENTRY} renamed on import or export`);
        }
      } else if (call === null) {
        at(node, `${ENGINE_ENTRY} used as a value, not called`);
      } else if (call.arguments.some(ts.isSpreadElement)) {
        at(node, `${ENGINE_ENTRY} called with a spread argument`);
      } else if (call.arguments.length > 2) {
        at(node, `${ENGINE_ENTRY} called with a params argument`);
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
