// T7 (AC-5; S0.2d4): a static scan of the MTGJson modules and the ingest
// script. No whole-file reads or parses (JSON.parse, readFile, readFileSync,
// Response .json/.text/.arrayBuffer, the sync zlib calls), and the only file
// writer is source.ts's download(), fed the raw response body, so no
// decompressed copy can be written. Comments are stripped with TypeScript's
// scanner first, so prose that names a banned call does not count.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const MTGJSON = path.join(ROOT, "src", "lib", "mtgjson");

/** The production files: src/lib/mtgjson/*.ts (no tests, no fixtures) and the script. */
function scannedFiles(): string[] {
  const modules = readdirSync(MTGJSON)
    .filter((f) => f.endsWith(".ts") && !/\.test(-d)?\.ts$/.test(f))
    .map((f) => path.join(MTGJSON, f));
  return [...modules, path.join(ROOT, "scripts", "ingest-mtgjson-history.ts")];
}

/** Source text with comments removed (strings and code kept). */
function codeOf(text: string): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  let out = "";
  for (
    let kind = scanner.scan();
    kind !== ts.SyntaxKind.EndOfFileToken;
    kind = scanner.scan()
  ) {
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue;
    }
    out += scanner.getTokenText();
  }
  return out;
}

const BANNED: readonly [string, RegExp][] = [
  ["JSON.parse", /\bJSON\s*\.\s*parse\b/],
  ["readFile(", /\breadFile\s*\(/],
  ["readFileSync", /\breadFileSync\b/],
  [".json()", /\.json\s*\(\s*\)/],
  [".text()", /\.text\s*\(\s*\)/],
  [".arrayBuffer()", /\.arrayBuffer\s*\(\s*\)/],
  ["gunzipSync", /\bgunzipSync\b/],
  ["unzipSync", /\bunzipSync\b/],
  ["inflateSync", /\binflateSync\b/],
];

/** The banned calls a source text makes, by label. */
function bannedIn(text: string): string[] {
  const code = codeOf(text);
  return BANNED.filter(([, pattern]) => pattern.test(code)).map(
    ([label]) => label,
  );
}

/** Every createWriteStream reference outside an import, with its enclosing function's name. */
function writeStreamUses(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const uses: string[] = [];
  const visit = (node: ts.Node, fn: string | null) => {
    if (ts.isImportDeclaration(node)) return;
    const name =
      ts.isFunctionDeclaration(node) && node.name ? node.name.text : fn;
    if (ts.isIdentifier(node) && node.text === "createWriteStream") {
      uses.push(name ?? "(top level)");
    }
    ts.forEachChild(node, (child) => visit(child, name));
  };
  visit(source, null);
  return uses;
}

describe("MTGJson streaming contract (T7, AC-5)", () => {
  test("scans the modules and the script", () => {
    const names = scannedFiles().map((f) => path.relative(ROOT, f));
    for (const expected of [
      "src/lib/mtgjson/parse.ts",
      "src/lib/mtgjson/source.ts",
      "src/lib/mtgjson/ingest.ts",
      "src/lib/mtgjson/transform.ts",
      "src/lib/mtgjson/store.ts",
      "scripts/ingest-mtgjson-history.ts",
    ]) {
      expect(names).toContain(expected);
    }
  });

  test.each(scannedFiles().map((f) => [path.relative(ROOT, f), f]))(
    "%s makes no whole-file read or parse",
    (_name, file) => {
      expect(bannedIn(readFileSync(file, "utf8"))).toEqual([]);
    },
  );

  test("createWriteStream appears only in source.ts's download(), fed the raw response body", () => {
    for (const file of scannedFiles()) {
      const text = readFileSync(file, "utf8");
      const uses = writeStreamUses(file, text);
      if (path.basename(file) === "source.ts") {
        expect(uses).toEqual(["download"]);
        const code = codeOf(text);
        expect(code).toContain("const body = Readable.fromWeb(response.body");
        expect(code).toContain(
          "pipeline(body, counter, createWriteStream(part))",
        );
        const download = code.slice(
          code.indexOf("async function download"),
          code.indexOf("function createHttpSource"),
        );
        expect(download).not.toMatch(
          /createGunzip|createInflate|createUnzip|createBrotliDecompress/,
        );
      } else {
        expect(uses, path.relative(ROOT, file)).toEqual([]);
      }
    }
  });

  test("the scanner flags each banned call planted in a synthetic file, and ignores comments", () => {
    for (const [label] of BANNED) {
      const call = {
        "JSON.parse": "JSON.parse(text)",
        "readFile(": "await readFile(p)",
        readFileSync: "readFileSync(p)",
        ".json()": "await res.json()",
        ".text()": "await res.text()",
        ".arrayBuffer()": "await res.arrayBuffer()",
        gunzipSync: "zlib.gunzipSync(b)",
        unzipSync: "zlib.unzipSync(b)",
        inflateSync: "zlib.inflateSync(b)",
      }[label]!;
      expect(bannedIn(`const x = 1;\nconst y = ${call};\n`)).toEqual([label]);
      expect(bannedIn(`// ${call}\n/* ${call} */\nconst y = 1;\n`)).toEqual([]);
    }
    expect(
      writeStreamUses("x.ts", "function other() { createWriteStream('a'); }"),
    ).toEqual(["other"]);
  });
});
