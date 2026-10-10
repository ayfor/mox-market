// T21 (AC-13), T23 (AC-15, AC-16; C1.33, C1.44 = A; S2.1d19) and T24
// (AC-1, AC-16): the server/client boundary, read from the TypeScript AST.
// No client module reaches the engine or a server-only module, no S2.1 file
// touches Prisma or V1's price_snapshots, and no source uses Math.random.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const toPosix = (p: string) => p.split(path.sep).join("/");

/** Repo-relative paths of every file under `dir`. */
function filesUnder(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = toPosix(path.join(dir, entry.name));
      return entry.isDirectory() ? filesUnder(rel) : [rel];
    },
  );
}

const isTest = (file: string) => /\.(test|spec)(-d)?\.[cm]?[jt]sx?$/.test(file);
const isCode = (file: string) => /\.[cm]?[jt]sx?$/.test(file);
/** Every non-test code file under src/, the generated client excepted. */
const SRC_CODE = filesUnder("src").filter(
  (f) => isCode(f) && !isTest(f) && !f.startsWith("src/generated/"),
);

interface SourceFs {
  read(file: string): string | undefined;
}
const diskFs: SourceFs = {
  read: (file) =>
    existsSync(path.join(ROOT, file))
      ? readFileSync(path.join(ROOT, file), "utf8")
      : undefined,
};

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** True when the file's directive prologue holds "use client". */
function isClientModule(sf: ts.SourceFile): boolean {
  for (const statement of sf.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

/** Runtime module specifiers: imports and re-exports that are not type-only. */
function runtimeSpecifiers(sf: ts.SourceFile): string[] {
  const specs: string[] = [];
  for (const statement of sf.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !statement.importClause?.isTypeOnly
    ) {
      specs.push(statement.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !statement.isTypeOnly
    ) {
      specs.push(statement.moduleSpecifier.text);
    }
  }
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

const EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
];

/** A relative or `@/` specifier as a repo-relative file, or null for a package. */
function resolve(from: string, spec: string, fs: SourceFs): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith("."))
    base = toPosix(path.join(path.dirname(from), spec));
  else return null;
  for (const ext of EXTENSIONS) {
    if (fs.read(base + ext) !== undefined) return base + ext;
  }
  return base;
}

/** The engine's logic modules, which no client module may reach. */
const ENGINE_LOGIC = [
  "engine",
  "bands",
  "reason",
  "signals",
  "window",
  "validate",
  "params",
  "copy",
].map((m) => `src/lib/recommendation/${m}.ts`);

/** Every way a client module's static import closure crosses the boundary. */
function boundaryViolations(files: string[], fs: SourceFs): string[] {
  const violations: string[] = [];
  for (const entry of files) {
    const source = fs.read(entry);
    if (source === undefined || !isClientModule(parse(entry, source))) continue;
    const seen = new Set<string>();
    const queue: { file: string; via: string[] }[] = [{ file: entry, via: [] }];
    while (queue.length > 0) {
      const { file, via } = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const chain = [...via, file].join(" → ");
      if (ENGINE_LOGIC.includes(file)) {
        violations.push(`${chain}: engine logic in a client bundle`);
      }
      const text = fs.read(file);
      if (text === undefined || !isCode(file)) continue;
      if (/mm-rec-badge|mm-pill/.test(text)) {
        violations.push(`${chain}: names a verdict badge class in client code`);
      }
      for (const spec of runtimeSpecifiers(parse(file, text))) {
        if (spec === "server-only") {
          violations.push(`${chain}: imports server-only`);
          continue;
        }
        const target = resolve(file, spec, fs);
        if (target !== null) queue.push({ file: target, via: [...via, file] });
      }
    }
  }
  return violations;
}

const memoryFs = (files: Record<string, string>): SourceFs => ({
  read: (file) => (file in files ? files[file] : diskFs.read(file)),
});

describe("client modules never reach the engine or a server-only module (T24)", () => {
  test("self-test: a planted client module importing the engine through one hop is flagged", () => {
    const planted = {
      "src/components/planted.tsx":
        '"use client";\nimport { hop } from "./hop";\nexport const P = () => hop;',
      "src/components/hop.ts":
        'import * as e from "@/lib/recommendation/engine";\nexport const hop = e;',
    };
    const found = boundaryViolations(Object.keys(planted), memoryFs(planted));
    expect(found).toContain(
      "src/components/planted.tsx → src/components/hop.ts → src/lib/recommendation/engine.ts: engine logic in a client bundle",
    );
    expect(found.some((v) => v.endsWith("imports server-only"))).toBe(true);
  });

  test("self-test: type-only imports and server modules are not followed", () => {
    const planted = {
      "src/components/typed.tsx":
        '"use client";\nimport type { Recommendation } from "@/lib/recommendation/types";\nimport type { x } from "@/lib/recommendation/engine";\nexport const T = 1;',
      "src/components/server.tsx":
        'import { computeRecommendation } from "@/lib/recommendation/engine";\nexport const S = computeRecommendation;',
      "src/components/badge.tsx":
        '"use client";\nexport const B = () => <span className="mm-rec-badge--buy" />;',
    };
    expect(boundaryViolations(Object.keys(planted), memoryFs(planted))).toEqual(
      ["src/components/badge.tsx: names a verdict badge class in client code"],
    );
  });

  test("the scan sees this story's client modules", () => {
    const clients = SRC_CODE.filter((f) =>
      isClientModule(parse(f, diskFs.read(f)!)),
    );
    expect(clients).toEqual(
      expect.arrayContaining([
        "src/app/[card]/result-slot.tsx",
        "src/app/[card]/retry-button.tsx",
        "src/app/[card]/error.tsx",
        "src/components/entry-form.tsx",
        "src/components/card-combobox.tsx",
        "src/components/result-navigation.tsx",
        "src/app/evaluate/evaluate-client.tsx",
      ]),
    );
  });

  test("no client module under src/ crosses the boundary", () => {
    expect(boundaryViolations(SRC_CODE, diskFs)).toEqual([]);
  });

  test.each([
    "src/lib/recommendation/engine.ts",
    "src/lib/evaluation/build-evaluation.ts",
  ])("%s imports server-only first", (file) => {
    const first = parse(file, diskFs.read(file)!).statements[0];
    expect(ts.isImportDeclaration(first)).toBe(true);
    const spec = (first as ts.ImportDeclaration)
      .moduleSpecifier as ts.StringLiteral;
    expect(spec.text).toBe("server-only");
  });
});

/** The directories and files this story adds under the result surface. */
const RESULT_SURFACE = SRC_CODE.filter(
  (f) =>
    f.startsWith("src/app/[card]/") ||
    f.startsWith("src/app/api/cards/") ||
    f.startsWith("src/lib/evaluation/") ||
    f.startsWith("src/components/") ||
    f === "src/lib/printings.ts",
);

/** Prisma imports and V1 price_snapshots names, read from the AST. */
function historyBypasses(file: string, source: string): string[] {
  const sf = parse(file, source);
  const found: string[] = [];
  for (const spec of runtimeSpecifiers(sf)) {
    const target = resolve(file, spec, diskFs) ?? spec;
    if (
      /^src\/lib\/prisma(\.tsx?)?$/.test(target) ||
      /^src\/generated\/prisma/.test(target) ||
      /^@prisma\//.test(spec)
    ) {
      found.push(`${file}: imports ${spec}`);
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === "priceSnapshot") {
      found.push(`${file}: names priceSnapshot`);
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /price_snapshots|priceSnapshot\b/.test(node.text)
    ) {
      found.push(`${file}: names price_snapshots`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("history only through the reader (T21, AC-13)", () => {
  test("self-test: Prisma imports and price_snapshots names are flagged", () => {
    const sample = [
      'import { prisma } from "@/lib/prisma";',
      'import { PrismaClient } from "@/generated/prisma/client";',
      "const rows = await prisma.priceSnapshot.findMany();",
      'const sql = "select * from price_snapshots";',
      "// price_snapshots in a comment is ignored",
      'import type { PriceSnapshot } from "@/lib/recommendation/types";',
    ].join("\n");
    expect(historyBypasses("src/lib/evaluation/x.ts", sample)).toEqual([
      "src/lib/evaluation/x.ts: imports @/lib/prisma",
      "src/lib/evaluation/x.ts: imports @/generated/prisma/client",
      "src/lib/evaluation/x.ts: names priceSnapshot",
      "src/lib/evaluation/x.ts: names price_snapshots",
    ]);
  });

  test("the scan covers the result surface", () => {
    expect(RESULT_SURFACE).toEqual(
      expect.arrayContaining([
        "src/app/[card]/page.tsx",
        "src/app/api/cards/autocomplete/route.ts",
        "src/lib/evaluation/load-market-snapshot.ts",
        "src/lib/evaluation/history-reader.ts",
        "src/components/entry-form.tsx",
        "src/lib/printings.ts",
      ]),
    );
  });

  test("no result-surface file imports Prisma or names price_snapshots", () => {
    const found = RESULT_SURFACE.flatMap((f) =>
      historyBypasses(f, diskFs.read(f)!),
    );
    expect(found).toEqual([]);
  });
});

describe("no client-side verdicts (T23, AC-15, AC-16)", () => {
  test("no non-test file under src/ contains Math.random (S2.1d19)", () => {
    expect(SRC_CODE.length).toBeGreaterThan(20);
    const offenders = SRC_CODE.filter((f) =>
      /Math\s*\.\s*random/.test(diskFs.read(f)!),
    );
    expect(offenders).toEqual([]);
  });

  test("evaluate-client.tsx has no mock market, VerdictPill, RecentSection or localStorage", () => {
    const source = diskFs.read("src/app/evaluate/evaluate-client.tsx")!;
    for (const gone of [
      /Math\.random/,
      /\bVerdictPill\b/,
      /\bRecentSection\b/,
      /\bRecentRow\b/,
      /\blocalStorage\b/,
      /\bmarketPrice\b/,
      /mm-pill/,
      /removed by S2\.1/,
    ]) {
      expect(source).not.toMatch(gone);
    }
  });
});
