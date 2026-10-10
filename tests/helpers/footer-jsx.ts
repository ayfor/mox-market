// T14 and ADV.5: what source files render, read from the TypeScript AST, so
// comments, strings and JSX text never count as markup. A commented-out
// `{/* <SiteFooter /> */}` renders nothing and is not counted; neither is an
// apostrophe in JSX text mistaken for a string.
import ts from "typescript";

export type RenderedElement = {
  /** The tag ("footer", "SiteFooter") or "[role=<value>]" for a role attribute. */
  name: string;
  line: number;
};

function parse(file: string, source: string): ts.SourceFile {
  const kind = /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

const CREATE_ELEMENT = /(?:^|\.)(?:createElement|jsxs?|jsxDEV|_jsxs?)$/;

/**
 * Every element `source` renders: JSX tags, and createElement or jsx calls
 * whose first argument is a string or an identifier. Each role="…"
 * attribute is reported too, as "[role=…]".
 */
export function renderedElements(
  file: string,
  source: string,
): RenderedElement[] {
  const sf = parse(file, source);
  const found: RenderedElement[] = [];
  const lineOf = (node: ts.Node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      found.push({ name: node.tagName.getText(sf), line: lineOf(node) });
    } else if (ts.isJsxAttribute(node) && node.name.getText(sf) === "role") {
      const init = node.initializer;
      const value =
        init && ts.isStringLiteral(init)
          ? init.text
          : init &&
              ts.isJsxExpression(init) &&
              init.expression &&
              ts.isStringLiteralLike(init.expression)
            ? init.expression.text
            : null;
      if (value !== null)
        found.push({ name: `[role=${value}]`, line: lineOf(node) });
    } else if (
      ts.isCallExpression(node) &&
      CREATE_ELEMENT.test(node.expression.getText(sf))
    ) {
      const [first] = node.arguments;
      if (first && (ts.isStringLiteralLike(first) || ts.isIdentifier(first))) {
        found.push({ name: first.text, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export type FooterPlacement = {
  /** The file renders an <html> element: it is a root layout or global-error. */
  rendersHtml: boolean;
  /** How many direct children of <body> are a <SiteFooter> element. */
  footersInBody: number;
  /** The one <SiteFooter> is the last direct child of <body> that renders anything. */
  footerLast: boolean;
  /** A direct `{children}` child of <body> comes before the footer. */
  afterChildren: boolean;
};

const tagOf = (sf: ts.SourceFile, node: ts.Node): string | null =>
  ts.isJsxElement(node)
    ? node.openingElement.tagName.getText(sf)
    : ts.isJsxSelfClosingElement(node)
      ? node.tagName.getText(sf)
      : null;

/**
 * Where `source` places <SiteFooter> inside its <body> element. Only direct
 * children count, so `{false && <SiteFooter />}` and a commented-out
 * footer are not placements.
 */
export function footerPlacement(file: string, source: string): FooterPlacement {
  const sf = parse(file, source);
  const rendersHtml = renderedElements(file, source).some(
    (e) => e.name === "html",
  );
  const findBody = (node: ts.Node): ts.JsxElement | undefined =>
    ts.isJsxElement(node) && tagOf(sf, node) === "body"
      ? node
      : ts.forEachChild(node, findBody);
  const body = findBody(sf);
  const children = body
    ? body.children.filter(
        (c) =>
          !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces) &&
          !(ts.isJsxExpression(c) && !c.expression),
      )
    : [];
  const footers = children.flatMap((c, i) =>
    tagOf(sf, c) === "SiteFooter" ? [i] : [],
  );
  const childrenAt = children.findIndex(
    (c) =>
      ts.isJsxExpression(c) &&
      !!c.expression &&
      ts.isIdentifier(c.expression) &&
      c.expression.text === "children",
  );
  return {
    rendersHtml,
    footersInBody: footers.length,
    footerLast: footers.length === 1 && footers[0] === children.length - 1,
    afterChildren:
      footers.length === 1 && childrenAt !== -1 && childrenAt < footers[0],
  };
}
