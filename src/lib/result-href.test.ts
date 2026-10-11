// T1 (AC-1, AC-11), T2 (AC-4, unit half) and T7's scan half (AC-3): the one
// link builder, its round trip through S2.1's parser, and that no other
// source builds a result link.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import {
  ENTRY_SUBMISSIONS,
  HOSTILE_NAMES,
} from "./__fixtures__/entry-submissions";
import { parseResultParams } from "./evaluation/result-params";
import { DEMO_RESULT_HREF, resultHref } from "./result-href";

/** The path segment and the price of an href, as Next hands them over. */
function split(href: string): { segment: string; price: string } {
  const match = /^\/([^?]*)\?price=(.*)$/.exec(href);
  if (match === null) throw new Error(`not a result href: ${href}`);
  return { segment: match[1], price: decodeURIComponent(match[2]) };
}

describe("resultHref (T1, AC-1)", () => {
  test.each(ENTRY_SUBMISSIONS.map((row) => [row.card, row.price, row.href]))(
    "(%j, %j) → %s",
    (card, price, href) => {
      expect(resultHref(card, price)).toBe(href);
    },
  );

  test("no finish param, and the card is trimmed", () => {
    for (const row of ENTRY_SUBMISSIONS) {
      const href = resultHref(row.card, row.price);
      expect(href).not.toMatch(/finish/);
      expect(new URL(href, "https://x.test").searchParams.has("finish")).toBe(
        false,
      );
    }
    expect(resultHref("  Esper Sentinel\t", "1")).toBe(
      "/Esper%20Sentinel?price=1",
    );
  });

  test.each(HOSTILE_NAMES.map((name) => [name]))(
    "%j stays one path segment with no raw space, ?, # or bare %",
    (name) => {
      const href = resultHref(name, "5");
      const { segment } = split(href);
      expect(href.indexOf("?")).toBe(href.indexOf("?price="));
      expect(href.match(/\//g)).toHaveLength(1);
      expect(segment).not.toMatch(/[ ?#/]/);
      expect(segment).not.toMatch(/%(?![0-9A-F]{2})/);
      // The URL parser agrees: one segment, the whole name.
      const url = new URL(href, "https://x.test");
      expect(url.pathname.split("/")).toHaveLength(2);
      expect(decodeURIComponent(url.pathname.slice(1))).toBe(name.trim());
      expect(url.hash).toBe("");
      expect(url.searchParams.get("price")).toBe("5");
    },
  );

  test('DEMO_RESULT_HREF equals resultHref("Esper Sentinel", "74.99") (AC-11)', () => {
    expect(DEMO_RESULT_HREF).toBe("/Esper%20Sentinel?price=74.99");
    expect(DEMO_RESULT_HREF).toBe(resultHref("Esper Sentinel", "74.99"));
  });
});

describe("the round trip through parseResultParams (T2, AC-4)", () => {
  test.each(ENTRY_SUBMISSIONS.map((row) => [row.card, row]))(
    "%j decodes once to its trimmed name and its cents",
    (_card, row) => {
      const { segment, price } = split(resultHref(row.card, row.price));
      const parsed = parseResultParams(segment, { price });
      expect(parsed).toMatchObject({
        kind: "ok",
        card: row.decoded,
        askingPriceCents: row.cents,
        finish: "normal",
      });
    },
  );

  test.each(HOSTILE_NAMES.map((name) => [name]))(
    "hostile name %j round-trips",
    (name) => {
      const { segment, price } = split(resultHref(name, "5"));
      expect(parseResultParams(segment, { price })).toMatchObject({
        kind: "ok",
        card: name.trim(),
        askingPriceCents: 500,
      });
    },
  );

  test('a card typed as the literal text "Esper%20Sentinel" is decoded exactly once', () => {
    const href = resultHref("Esper%20Sentinel", "1");
    expect(href).toBe("/Esper%2520Sentinel?price=1");
    const { segment, price } = split(href);
    const parsed = parseResultParams(segment, { price });
    expect(parsed).toMatchObject({ kind: "ok", card: "Esper%20Sentinel" });
    expect(parsed).not.toMatchObject({ card: "Esper Sentinel" });
  });
});

// --- T7's scan half (AC-3): one builder ------------------------------------
const ROOT = path.resolve(__dirname, "..", "..");
const toPosix = (p: string) => p.split(path.sep).join("/");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function filesUnder(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = toPosix(path.join(dir, entry.name));
      return entry.isDirectory() ? filesUnder(rel) : [rel];
    },
  );
}

const isTest = (f: string) => /\.(test|spec)(-d)?\.[cm]?[jt]sx?$/.test(f);
const parse = (file: string, source: string) =>
  ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/** String and template literal text in a source; comments never count. */
function literalTexts(file: string, source: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file, source));
  return found;
}

/**
 * Every navigation call (`router.push(x)`, `navigate(x)`) in a source whose
 * argument is not an identifier bound to resultHref(...) or to
 * checkEntry(...).href, read from the AST.
 */
function unbuiltNavigations(file: string, source: string): string[] {
  const sf = parse(file, source);
  const inits = new Map<string, ts.Expression>();
  const collect = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      inits.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const callTo = (expr: ts.Expression | undefined, name: string) =>
    expr !== undefined &&
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === name;
  const built = (arg: ts.Expression): boolean => {
    if (callTo(arg, "resultHref")) return true;
    if (!ts.isIdentifier(arg)) return false;
    const init = inits.get(arg.text);
    if (init === undefined) return false;
    if (callTo(init, "resultHref")) return true;
    return (
      ts.isPropertyAccessExpression(init) &&
      init.name.text === "href" &&
      ts.isIdentifier(init.expression) &&
      callTo(inits.get(init.expression.text), "checkEntry")
    );
  };
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : null;
      if (name === "push" || name === "navigate") {
        const arg = node.arguments[0];
        if (arg === undefined || !built(arg)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          found.push(`${file}:${line + 1} ${node.getText(sf)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("one builder (T7, AC-3)", () => {
  const SOURCES = filesUnder("src").filter(
    (f) =>
      /\.[cm]?[jt]sx?$/.test(f) &&
      !isTest(f) &&
      !f.startsWith("src/generated/") &&
      !f.includes("/__fixtures__/"),
  );

  test("no non-test source but result-href.ts holds ?price= in a literal", () => {
    expect(SOURCES).toEqual(
      expect.arrayContaining([
        "src/lib/result-href.ts",
        "src/components/entry-form.tsx",
        "src/app/landing-form.tsx",
      ]),
    );
    const holders = SOURCES.filter((f) =>
      literalTexts(f, read(f)).some((t) => t.includes("?price=")),
    );
    expect(holders).toEqual(["src/lib/result-href.ts"]);
  });

  const FORMS = [
    ...filesUnder("src/app/evaluate"),
    "src/app/landing-form.tsx",
    "src/components/entry-form.tsx",
  ].filter((f) => /\.tsx?$/.test(f) && !isTest(f));

  test("every push or navigate in the entry forms takes a built href", () => {
    expect(FORMS).toEqual(
      expect.arrayContaining([
        "src/app/evaluate/evaluate-client.tsx",
        "src/app/landing-form.tsx",
        "src/components/entry-form.tsx",
      ]),
    );
    expect(FORMS.flatMap((f) => unbuiltNavigations(f, read(f)))).toEqual([]);
    // The forms do navigate, so the scan has calls to read.
    for (const form of [
      "src/app/landing-form.tsx",
      "src/components/entry-form.tsx",
    ]) {
      expect(read(form)).toMatch(/navigation\.navigate\(href\)/);
    }
  });

  test("self-test: raw strings, templates and unbound identifiers are flagged", () => {
    const sample = [
      'router.push("/x?price=1");',
      "router.push(`/${card}?price=${price}`);",
      "const a = makeHref(card);",
      "navigation.navigate(a);",
      "const b = resultHref(card, price);",
      "router.push(b);",
      "const entry = checkEntry(card, price);",
      "const href = entry.href;",
      "navigation.navigate(href);",
      "router.push(resultHref(card, price));",
      "navigate(other.href);",
    ].join("\n");
    expect(unbuiltNavigations("x.tsx", sample)).toEqual([
      'x.tsx:1 router.push("/x?price=1")',
      "x.tsx:2 router.push(`/${card}?price=${price}`)",
      "x.tsx:4 navigation.navigate(a)",
      "x.tsx:11 navigate(other.href)",
    ]);
  });
});
