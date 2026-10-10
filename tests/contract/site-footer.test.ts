// T11 (AC-5), T12 (AC-8, AC-6), T13 (AC-6), T14 (AC-1, AC-2): source-level
// contracts for the site footer: the false per-page footers are gone, the
// footer's styles live only with the component, its CSS cannot hide, shrink
// or wash it out, and every root layout renders it.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  checkFooterCss,
  composite,
  contrastRatio,
  CssReadError,
  extractRules,
  parseColor,
  parseTokens,
  resolveVars,
  selectorsOf,
} from "../helpers/site-footer-css";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
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
const SOURCES = [
  ...filesUnder("src/app"),
  ...filesUnder("src/components"),
].filter((f) => /\.(ts|tsx|css)$/.test(f) && !isTest(f));

const FALSE_CLAIMS = /CardKingdom|CardMarket|Updated every 4 hours/i;

describe("the false per-page footers are gone (T11)", () => {
  test("the scan covers the routes and components", () => {
    expect(SOURCES).toEqual(
      expect.arrayContaining([
        "src/app/evaluate/evaluate-client.tsx",
        "src/app/sample/decision-analysis.tsx",
        "src/app/evaluate/evaluate.css",
        "src/components/site-footer.tsx",
      ]),
    );
  });

  test.each(SOURCES)(
    "%s has no CardKingdom, CardMarket or 'Updated every 4 hours'",
    (file) => {
      expect(read(file)).not.toMatch(FALSE_CLAIMS);
    },
  );

  test("evaluate-client.tsx has no Footer component", () => {
    const source = read("src/app/evaluate/evaluate-client.tsx");
    expect(source).not.toMatch(/function\s+Footer\b/);
    expect(source).not.toMatch(/<Footer\b/);
    expect(source).not.toMatch(/<footer\b/);
  });

  test.each(SOURCES.filter((f) => f.endsWith(".tsx")))(
    "%s uses neither the mm-footer nor the t-actions-foot class",
    (file) => {
      const source = read(file);
      expect(source).not.toMatch(/(?<![\w-])mm-footer(?![\w-])/);
      expect(source).not.toMatch(/(?<![\w-])t-actions-foot(?![\w-])/);
    },
  );
});

/** A selector that names the footer element, the site footer or the contentinfo role. */
const FOOTER_SELECTOR =
  /(?:^|[\s>+~,(])footer(?![\w-])|mm-site-footer|contentinfo/i;

const ROUTE_STYLESHEETS = filesUnder("src/app").filter(
  (f) =>
    f.endsWith(".css") &&
    !["src/app/globals.css", "src/app/tokens.css"].includes(f),
);

describe("footer styles live with the component (T12)", () => {
  test("evaluate.css has no .mm-footer selector", () => {
    const selectors = selectorsOf(read("src/app/evaluate/evaluate.css"));
    expect(selectors.filter((s) => /\.mm-footer(?![\w-])/.test(s))).toEqual([]);
    expect(read("src/app/evaluate/evaluate.css")).not.toMatch(
      /\.mm-footer(?![\w-])/,
    );
  });

  test("route stylesheets exist to check", () => {
    expect(ROUTE_STYLESHEETS).toEqual(
      expect.arrayContaining([
        "src/app/landing.css",
        "src/app/evaluate/evaluate.css",
        "src/app/sample/styles.css",
      ]),
    );
  });

  test.each(ROUTE_STYLESHEETS)(
    "%s has no selector naming footer, mm-site-footer or contentinfo",
    (file) => {
      expect(
        selectorsOf(read(file)).filter((s) => FOOTER_SELECTOR.test(s)),
      ).toEqual([]);
    },
  );

  test("the footer-selector pattern catches the element and spares look-alike classes", () => {
    for (const hit of [
      "footer",
      "body > footer",
      ".a footer p",
      "main,footer",
      ":is(footer)",
      "[role=contentinfo]",
      ".mm-site-footer-line",
    ]) {
      expect(FOOTER_SELECTOR.test(hit)).toBe(true);
    }
    for (const miss of [
      ".t-price-footer",
      ".footer-ish",
      "#footer-x",
      ".mm-footer-old",
    ]) {
      expect(FOOTER_SELECTOR.test(miss)).toBe(false);
    }
  });

  test("mm-site-footer selectors appear only in src/components/site-footer.css", () => {
    const css = [...filesUnder("src")].filter((f) => f.endsWith(".css"));
    const withFooter = css.filter((f) => /mm-site-footer/.test(read(f)));
    expect(withFooter).toEqual(["src/components/site-footer.css"]);
  });

  test("site-footer.tsx imports ./site-footer.css", () => {
    expect(read("src/components/site-footer.tsx")).toMatch(
      /^import\s+["']\.\/site-footer\.css["'];?$/m,
    );
  });
});

const TOKENS = read("src/app/tokens.css");
const FOOTER_CSS = read("src/components/site-footer.css");

describe("footer CSS keeps the text visible and legible (T13)", () => {
  test("site-footer.css passes every check", () => {
    expect(checkFooterCss(FOOTER_CSS, TOKENS)).toEqual([]);
  });

  test("the footer's text and link colours meet 4.5:1 on onyx (today 5.59 and 19.51)", () => {
    const tokens = parseTokens(TOKENS);
    const onyx = parseColor(resolveVars("var(--mox-onyx)", tokens).value)!;
    const ratio = (token: string) =>
      contrastRatio(
        composite(
          parseColor(resolveVars(`var(${token})`, tokens).value)!,
          onyx,
        ),
        onyx,
      );
    expect(ratio("--fg-secondary")).toBeCloseTo(5.59, 2);
    expect(ratio("--fg-primary")).toBeCloseTo(19.51, 2);
  });

  const base = `.mm-site-footer { color: var(--fg-secondary); font: var(--ts-caption); }
.mm-site-footer-link { color: var(--fg-primary); }`;

  test.each([
    [
      "display: none in a media query",
      "@media (max-width: 600px) { .mm-site-footer { display: none } }",
      /display: none/,
    ],
    [
      "a base opacity: 0 revealed by :hover",
      ".mm-site-footer { opacity: 0 } .mm-site-footer:hover { opacity: 1 }",
      /opacity: 0 dims[\s\S]*opacity: 1 in a :hover/,
    ],
    [
      "a low-contrast rgba colour",
      ".mm-site-footer-line { color: rgba(255, 255, 255, 0.2) }",
      /contrast \d\.\d\d:1/,
    ],
    [
      "a 9px font size",
      ".mm-site-footer-line { font-size: 9px }",
      /9px, below 11px/,
    ],
    [
      "an unresolvable var(--nope)",
      ".mm-site-footer-line { color: var(--nope) }",
      /--nope/,
    ],
    ["visibility: hidden", ".mm-site-footer { visibility: hidden }", /hides/],
    [
      "visibility: collapse",
      ".mm-site-footer { visibility: collapse }",
      /hides/,
    ],
    [
      "height: 0",
      ".mm-site-footer { height: 0; overflow: hidden }",
      /collapses/,
    ],
    ["max-height: 0px", ".mm-site-footer { max-height: 0px }", /collapses/],
    ["clip", ".mm-site-footer { clip: rect(0 0 0 0) }", /clips/],
    ["clip-path", ".mm-site-footer { clip-path: inset(50%) }", /clips/],
    [
      "content-visibility: hidden",
      ".mm-site-footer { content-visibility: hidden }",
      /hides/,
    ],
    [
      "a negative text-indent",
      ".mm-site-footer-line { text-indent: -9999px }",
      /out of view/,
    ],
    ["position: fixed", ".mm-site-footer { position: fixed }", /normal flow/],
    ["position: sticky", ".mm-site-footer { position: sticky }", /normal flow/],
    ["a negative z-index", ".mm-site-footer { z-index: -1 }", /sinks/],
    [
      "transform: scale(0)",
      ".mm-site-footer { transform: scale(0) }",
      /wash out/,
    ],
    [
      "a background",
      ".mm-site-footer { background: #fefffe }",
      /no background/,
    ],
    [
      "color: transparent",
      ".mm-site-footer-line { color: transparent }",
      /contrast 1\.00:1/,
    ],
    [
      "a :focus rule changing display",
      ".mm-site-footer-link:focus { display: inline-block }",
      /in a :hover\/:focus rule/,
    ],
    [
      "a font shorthand below 11px",
      ".mm-site-footer { font: var(--ts-meta) }",
      /10px, below 11px/,
    ],
    [
      "a keyword font size",
      ".mm-site-footer { font-size: smaller }",
      /no readable font size/,
    ],
    [
      "an important display: none",
      ".mm-site-footer { display: none !important }",
      /display: none/,
    ],
  ])("flags %s", (_name, extra, expected) => {
    const findings = checkFooterCss(`${base}\n${extra}`, TOKENS);
    expect(findings.join("\n")).toMatch(expected);
  });

  test("the fixture base alone passes", () => {
    expect(checkFooterCss(base, TOKENS)).toEqual([]);
  });

  test("a missing text or link colour is flagged", () => {
    expect(
      checkFooterCss(".mm-site-footer { font: var(--ts-caption) }", TOKENS),
    ).toEqual([
      ".mm-site-footer: no colour set, so its contrast is unchecked",
      ".mm-site-footer-link: no colour set, so its contrast is unchecked",
    ]);
  });

  test("hover and focus may change colour, underline and outline only", () => {
    const ok = `${base}
.mm-site-footer-link:hover { color: var(--fg-primary); text-decoration-thickness: 2px }
.mm-site-footer-link:focus-visible { outline: 2px solid var(--fg-primary); outline-offset: 2px }`;
    expect(checkFooterCss(ok, TOKENS)).toEqual([]);
  });

  test("unreadable CSS fails instead of passing", () => {
    expect(
      checkFooterCss(
        ".mm-site-footer { color: red; &:hover { display: none } }",
        TOKENS,
      )[0],
    ).toMatch(/unreadable CSS: nested rule/);
    expect(() => extractRules(".a { color: red")).toThrow(CssReadError);
  });

  test("the reader finds rules inside nested at-rules and skips comments", () => {
    const rules = extractRules(`/* .x { display: none } */
@supports (display: grid) { @media (min-width: 1px) { .a, .b { color: red } } }
@font-face { font-family: X; src: url("a;b.woff2") }
.c { background: url("data:image/png;base64,AAA") }`);
    expect(rules.map((r) => [r.selector, r.atRules])).toEqual([
      [".a, .b", ["@supports (display: grid)", "@media (min-width: 1px)"]],
      [".c", []],
    ]);
    expect(rules[1].declarations).toEqual([
      { property: "background", value: 'url("data:image/png;base64,AAA")' },
    ]);
  });

  test("var() chains resolve through tokens, and a cycle is unresolved", () => {
    const tokens = parseTokens(
      ":root { --a: var(--b); --b: #fff; --c: var(--d); --d: var(--c); }",
    );
    expect(resolveVars("var(--a)", tokens)).toEqual({
      value: "#fff",
      unresolved: [],
    });
    expect(resolveVars("var(--c)", tokens).unresolved).toContain("--c");
    expect(resolveVars("var(--zz, #000)", tokens)).toEqual({
      value: "#000",
      unresolved: [],
    });
  });

  test("colour parsing covers hex, rgb and rgba forms", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#0c0c0c")).toEqual({ r: 12, g: 12, b: 12, a: 1 });
    expect(parseColor("#ffffff80")?.a).toBeCloseTo(0.502, 3);
    expect(parseColor("rgba(255, 255, 255, 0.05)")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 0.05,
    });
    expect(parseColor("rgb(255 0 0 / 50%)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 0.5,
    });
    expect(parseColor("currentColor")).toBeNull();
    expect(parseColor("hsl(0 0% 100%)")).toBeNull();
  });
});

/** Every non-test file under src/app that renders <html, and whether it also renders <SiteFooter. */
function rootLayoutsWithoutFooter(files: { path: string; source: string }[]): {
  roots: string[];
  missing: string[];
} {
  const roots = files
    .filter((f) => /<html[\s>]/.test(f.source))
    .map((f) => f.path);
  const missing = files
    .filter(
      (f) => roots.includes(f.path) && !/<SiteFooter\s*\/>/.test(f.source),
    )
    .map((f) => f.path);
  return { roots, missing };
}

/** `<SiteFooter />` inside <body>, after {children}. */
const FOOTER_IN_BODY =
  /<body\b[^>]*>[\s\S]*?\{children\}[\s\S]*?<SiteFooter\s*\/>[\s\S]*?<\/body>/;

describe("every root layout renders the footer (T14)", () => {
  const appFiles = filesUnder("src/app")
    .filter((f) => /\.[cm]?[jt]sx?$/.test(f) && !isTest(f))
    .map((f) => ({ path: f, source: read(f) }));

  test("the only file under src/app that renders <html is layout.tsx, and it renders SiteFooter", () => {
    expect(rootLayoutsWithoutFooter(appFiles)).toEqual({
      roots: ["src/app/layout.tsx"],
      missing: [],
    });
  });

  test("layout.tsx renders <SiteFooter /> inside <body>, after {children}", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(FOOTER_IN_BODY);
    expect(layout.match(/<SiteFooter\b/g)).toHaveLength(1);
    expect(layout).toMatch(
      /^import \{ SiteFooter \} from "@\/components\/site-footer";$/m,
    );
  });

  test("self-test: a second root layout or a global-error.tsx without the footer is flagged", () => {
    const layout = {
      path: "src/app/layout.tsx",
      source: "<html><body>{children}<SiteFooter /></body></html>",
    };
    const groupLayout = {
      path: "src/app/(marketing)/layout.tsx",
      source: '<html lang="en"><body>{children}</body></html>',
    };
    const globalError = {
      path: "src/app/global-error.tsx",
      source: "<html>\n<body><h2>Something went wrong</h2></body></html>",
    };
    const page = { path: "src/app/page.tsx", source: "<main>hi</main>" };
    expect(
      rootLayoutsWithoutFooter([layout, groupLayout, globalError, page]),
    ).toEqual({
      roots: [layout.path, groupLayout.path, globalError.path],
      missing: [groupLayout.path, globalError.path],
    });
  });

  test("self-test: the body check rejects a footer before the page or outside body", () => {
    expect("<body>{children}<SiteFooter /></body>").toMatch(FOOTER_IN_BODY);
    expect("<body><SiteFooter />{children}</body>").not.toMatch(FOOTER_IN_BODY);
    expect("<body>{children}</body><SiteFooter />").not.toMatch(FOOTER_IN_BODY);
  });
});
