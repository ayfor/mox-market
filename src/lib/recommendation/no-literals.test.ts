// T8 (AC-6; S1.2d13): every threshold is a RECOMMENDATION_PARAMS field, so
// engine logic holds no numeric literal beyond a few unit constants. Read
// from the TypeScript AST, so comments and strings never count.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { RECOMMENDATION_PARAMS } from "./params";

/** Index steps, halving and squaring, the ISO date length, percent and basis points. */
const ALLOWED = new Set([0, 1, 2, 10, 100, 10000]);

/** Where literals belong: the params, the input limits and the fixture data. */
const EXEMPT = new Set(["params.ts", "limits.ts", "fixtures.ts"]);

const ENGINE_DIR = path.resolve(__dirname);

function literalOffences(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const offences: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) {
      const value = Number(node.text.replace(/_/g, "").replace(/n$/, ""));
      if (!ALLOWED.has(value)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        offences.push(`${path.basename(file)}:${line + 1} ${node.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return offences;
}

const engineSources = () =>
  readdirSync(ENGINE_DIR)
    .filter((name) => /\.ts$/.test(name))
    .filter((name) => !/\.test(-d)?\.ts$/.test(name))
    .filter((name) => !EXEMPT.has(name));

describe("no thresholds as literals in engine logic (T8)", () => {
  test("the scanner flags thresholds and passes unit constants", () => {
    const sample = [
      "if (count < 7) return null;",
      "const asym = 0.6;",
      "const buy = -833;",
      "const pct = x * 100;",
      "const bp = 10_000;",
      "// a comment saying 14 or 0.5 is ignored",
      'const s = "only 7 price snapshots";',
      "const big = 30n;",
    ].join("\n");
    expect(literalOffences("sample.ts", sample)).toEqual([
      "sample.ts:1 7",
      "sample.ts:2 0.6",
      "sample.ts:3 833",
      "sample.ts:8 30n",
    ]);
  });

  test("scans every non-test engine source except params, limits and fixtures", () => {
    const files = engineSources();
    for (const name of [
      "engine.ts",
      "window.ts",
      "signals.ts",
      "bands.ts",
      "reason.ts",
      "copy.ts",
      "types.ts",
      "validate.ts",
      "errors.ts",
      // S1.3 T21: the UI copy and the forbidden-phrase list.
      "ui-copy.ts",
      "forbidden-phrases.ts",
    ]) {
      expect(files).toContain(name);
    }
    for (const name of EXEMPT) expect(files).not.toContain(name);
  });

  test("no engine source holds a numeric literal outside the allowlist", () => {
    const offences = engineSources().flatMap((name) => {
      const file = path.join(ENGINE_DIR, name);
      return literalOffences(file, readFileSync(file, "utf8"));
    });
    expect(offences).toEqual([]);
  });

  test("no RECOMMENDATION_PARAMS value is in the allowlist, so a param literal is always caught", () => {
    for (const [key, value] of Object.entries(RECOMMENDATION_PARAMS)) {
      expect(ALLOWED.has(value), key).toBe(false);
    }
  });
});
