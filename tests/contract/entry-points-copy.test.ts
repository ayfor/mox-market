// T15 (AC-10; C1.54; S2.4d5): the TSX files this story writes hold no
// user-facing literal. Every visible string, accessible name, placeholder,
// alt text and title comes from a copy module, and the landing page's
// metadata holds no string literal. Read from the TypeScript AST, so
// comments, class names and decorative glyphs never count.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** The TSX files S2.4 writes (S2.4d1). */
const STORY_TSX = [
  "src/app/page.tsx",
  "src/app/landing-form.tsx",
  "src/components/nav-bar.tsx",
  "src/components/entry-form.tsx",
  "src/app/[card]/lookup-miss.tsx",
  "src/app/[card]/result-view.tsx",
  "src/app/[card]/page.tsx",
];

/** Attributes a user reads or hears. */
const TEXT_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "placeholder",
  "alt",
  "title",
  "label",
]);

const LETTER = /\p{L}/u;

/** Every user-facing literal in a TSX source, as "<file>:<line> <kind> <text>". */
function userFacingLiterals(file: string, source: string): string[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const add = (node: ts.Node, kind: string, text: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push(`${file}:${line + 1} ${kind} ${JSON.stringify(text.trim())}`);
  };
  /** A literal's text when an expression is a string or template literal. */
  const literalText = (expr: ts.Expression | undefined): string | null => {
    if (expr === undefined) return null;
    if (ts.isParenthesizedExpression(expr)) return literalText(expr.expression);
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return expr.text;
    }
    if (ts.isTemplateExpression(expr)) {
      return [
        expr.head.text,
        ...expr.templateSpans.map((s) => s.literal.text),
      ].join(" ");
    }
    if (ts.isConditionalExpression(expr)) {
      return (
        [literalText(expr.whenTrue), literalText(expr.whenFalse)]
          .filter((t) => t !== null)
          .join(" ") || null
      );
    }
    if (
      ts.isBinaryExpression(expr) &&
      (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        expr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expr.operatorToken.kind === ts.SyntaxKind.PlusToken)
    ) {
      return (
        [literalText(expr.left), literalText(expr.right)]
          .filter((t) => t !== null)
          .join(" ") || null
      );
    }
    return null;
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && LETTER.test(node.text)) {
      add(node, "text", node.text);
    } else if (
      ts.isJsxExpression(node) &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const text = literalText(node.expression);
      if (text !== null && LETTER.test(text)) add(node, "child", text);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (TEXT_ATTRIBUTES.has(name) && node.initializer) {
        const text = ts.isStringLiteral(node.initializer)
          ? node.initializer.text
          : ts.isJsxExpression(node.initializer)
            ? literalText(node.initializer.expression)
            : null;
        if (text !== null && LETTER.test(text)) add(node, name, text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** String literals inside `export const metadata = { … }`. */
function metadataLiterals(file: string, source: string): string[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== "metadata")
        continue;
      const visit = (node: ts.Node) => {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateExpression(node)
        ) {
          found.push(node.getText(sf));
        }
        ts.forEachChild(node, visit);
      };
      if (decl.initializer) visit(decl.initializer);
    }
  }
  return found;
}

describe("no user-facing literal in this story's TSX (T15, AC-10)", () => {
  test.each(STORY_TSX)("%s", (file) => {
    expect(userFacingLiterals(file, read(file))).toEqual([]);
  });

  test("src/app/page.tsx exports metadata with no string literal", () => {
    const source = read("src/app/page.tsx");
    expect(source).toMatch(/export const metadata/);
    expect(metadataLiterals("src/app/page.tsx", source)).toEqual([]);
  });

  test("self-test: planted text, labels, placeholders, alt, titles and metadata are flagged; classes and glyphs are not", () => {
    const sample = [
      'export const metadata = { title: "Mox Market", description: COPY.d };',
      'export const A = () => <p className="x-y">Pick a card</p>;',
      'export const B = () => <input aria-label="Card name" placeholder={"Search"} />;',
      'export const C = () => <img alt="Logo" title={`Hi ${x}`} />;',
      'export const D = () => <span aria-hidden="true">+</span>;',
      "export const E = () => <span>◇</span>;",
      'export const F = () => <p>{"Couldn\'t find that card"}</p>;',
      'export const G = () => <p>{ok ? "Yes" : COPY.no}</p>;',
      "export const H = () => <p aria-label={COPY.label} className={`a ${b}`}>{COPY.text}</p>;",
      'export const I = () => <img alt="" />;',
      "// <p>Commented text</p>",
    ].join("\n");
    expect(userFacingLiterals("x.tsx", sample)).toEqual([
      'x.tsx:2 text "Pick a card"',
      'x.tsx:3 aria-label "Card name"',
      'x.tsx:3 placeholder "Search"',
      'x.tsx:4 alt "Logo"',
      'x.tsx:4 title "Hi"',
      `x.tsx:7 child "Couldn't find that card"`,
      'x.tsx:8 child "Yes"',
    ]);
    expect(metadataLiterals("x.tsx", sample)).toEqual(['"Mox Market"']);
  });
});
