// ADV.15 (S0.2d16, AC-9): ALLOW_PROD_INGEST counts only when it was set
// inline. The script captures it in its first import, a module with no
// imports, before .env loads; this pins that order statically, and that no
// module the script reaches can load an env file on its own (an
// `import "dotenv/config"` anywhere in the graph would run before the
// capture's consumers and let a stored copy count). The runtime half is
// src/lib/mtgjson/cli.test.ts (a loadEnv that sets the flag never arms
// path C).
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "ingest-mtgjson-history.ts");
const CAPTURE = path.join(ROOT, "scripts", "capture-inline-flags.ts");
const CLI = path.join(ROOT, "src", "lib", "mtgjson", "cli.ts");

/** Packages and calls that load an env file into process.env. */
const ENV_LOADERS = ["dotenv", "dotenv/config", "@next/env"];

const sourceOf = (file: string) =>
  ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

/** The file's code with every comment removed. */
const codeOf = (file: string) =>
  ts.createPrinter({ removeComments: true }).printFile(sourceOf(file));

/** Every module specifier the file imports, re-exports or requires. */
const specifiersOf = (file: string): string[] =>
  ts
    .preProcessFile(readFileSync(file, "utf8"), true, true)
    .importedFiles.map((f) => f.fileName);

function resolveLocal(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(ROOT, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(from), specifier);
  } else {
    return null; // a package
  }
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ]) {
    try {
      if (readFileSync(candidate) && /\.tsx?$/.test(candidate))
        return candidate;
    } catch {
      // try the next
    }
  }
  throw new Error(`cannot resolve ${specifier} from ${from}`);
}

/** Every local module reachable from the script, with its package imports. */
function importGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = [SCRIPT];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (graph.has(file)) continue;
    const packages: string[] = [];
    for (const specifier of specifiersOf(file)) {
      const local = resolveLocal(file, specifier);
      if (local === null) packages.push(specifier);
      else queue.push(local);
    }
    graph.set(file, packages);
  }
  return graph;
}

describe("ALLOW_PROD_INGEST is captured before anything can load .env (ADV.15)", () => {
  const graph = importGraph();

  test("walks the script's whole local import graph", () => {
    const files = [...graph.keys()].map((f) => path.relative(ROOT, f));
    for (const expected of [
      "scripts/capture-inline-flags.ts",
      "src/lib/mtgjson/cli.ts",
      "src/lib/mtgjson/target.ts",
      "src/lib/mtgjson/ingest.ts",
      "src/lib/prisma-pool.ts",
      "prisma/migrate-guard.ts",
      "src/lib/scryfall.ts",
    ]) {
      expect(files).toContain(expected);
    }
  });

  test("the script's first import is the capture module", () => {
    const first = sourceOf(SCRIPT).statements.find(ts.isImportDeclaration);
    expect(first).toBeDefined();
    expect((first!.moduleSpecifier as ts.StringLiteral).text).toBe(
      "./capture-inline-flags",
    );
    // Prettier's import sorting is off for the file, so it cannot move.
    expect(readFileSync(SCRIPT, "utf8")).toContain("organize-imports-ignore");
  });

  test("the capture module imports nothing and reads the flag at load time", () => {
    expect(specifiersOf(CAPTURE)).toEqual([]);
    expect(codeOf(CAPTURE)).toMatch(
      /export const INLINE_ALLOW_PROD_INGEST: string \| undefined = process\.env\.ALLOW_PROD_INGEST;/,
    );
  });

  test("no module but the script imports an env loader, and none calls loadEnvConfig", () => {
    for (const [file, packages] of graph) {
      const name = path.relative(ROOT, file);
      const loaders = packages.filter((p) => ENV_LOADERS.includes(p));
      if (file === SCRIPT) {
        expect(loaders, name).toEqual(["dotenv"]);
      } else {
        expect(loaders, name).toEqual([]);
      }
      expect(codeOf(file), name).not.toMatch(/loadEnvConfig\s*\(/);
    }
  });

  test("only the capture module reads ALLOW_PROD_INGEST from the environment", () => {
    for (const file of graph.keys()) {
      if (file === CAPTURE) continue;
      expect(codeOf(file), path.relative(ROOT, file)).not.toMatch(
        /process\.env\.ALLOW_PROD_INGEST|process\.env\[\s*["']ALLOW_PROD_INGEST["']\s*\]|env\.ALLOW_PROD_INGEST/,
      );
    }
  });

  test("the script loads .env only inside the loadEnv it hands runCli, from the repo root", () => {
    const code = codeOf(SCRIPT);
    expect(code.match(/loadDotenv\(/g)).toHaveLength(1);
    expect(code).toMatch(
      /loadEnv: \(\) => \{\s*loadDotenv\(\{ path: REPO_DOTENV, quiet: true \}\);\s*\}/,
    );
    expect(code).toMatch(/inlineAllowProdIngest: INLINE_ALLOW_PROD_INGEST/);
  });

  test("runCli loads .env before the guard and hands the guard the captured value", () => {
    const code = codeOf(CLI);
    const load = code.indexOf("deps.loadEnv();");
    const guard = code.indexOf("resolveTarget(");
    expect(load).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(load);
    expect(code.slice(guard, guard + 120)).toMatch(
      /resolveTarget\(options, deps\.env, deps\.inlineAllowProdIngest\)/,
    );
  });
});
