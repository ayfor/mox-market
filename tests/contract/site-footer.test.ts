// T11 (AC-5), T12 (AC-8, AC-6), T13 (AC-6), T14 (AC-1, AC-2): source-level
// contracts for the site footer: the false per-page footers are gone, the
// footer's styles live only with the component and nothing else reaches it,
// its CSS cannot hide, shrink, move or wash it out, and the root layout
// renders it, once, where nothing else renders a footer.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { FALSE_FOOTER_CLAIMS } from "../helpers/attribution-spec";
import {
  footerPlacement,
  renderedElements,
  type FooterPlacement,
} from "../helpers/footer-jsx";
import {
  checkCssOutsideFooter,
  checkFooterCss,
  composite,
  contrastRatio,
  CssReadError,
  elementsReached,
  extractAtRules,
  extractRules,
  FOOTER_SELECTOR,
  parseColor,
  parseSelector,
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
/** Every non-test text file under src/, the gitignored generated client excepted. */
const SRC_FILES = filesUnder("src").filter(
  (f) =>
    !f.startsWith("src/generated/") &&
    !isTest(f) &&
    /\.(?:[cm]?[jt]sx?|css|json|md|mdx|html|txt|svg)$/.test(f),
);
const CODE_FILES = SRC_FILES.filter((f) => /\.[cm]?[jt]sx?$/.test(f));

/** Every file whose source makes one of the old footers' false claims. */
const falseClaimFiles = (files: { path: string; source: string }[]) =>
  files.filter((f) => FALSE_FOOTER_CLAIMS.test(f.source)).map((f) => f.path);

describe("the false per-page footers are gone (T11)", () => {
  test("the scan covers every source file under src/, copy modules included (ADV.6)", () => {
    expect(SRC_FILES).toEqual(
      expect.arrayContaining([
        "src/app/evaluate/evaluate-client.tsx",
        "src/app/landing-form.tsx",
        "src/lib/copy/entry-points.ts",
        "src/app/evaluate/evaluate.css",
        "src/app/globals.css",
        "src/components/site-footer.tsx",
        "src/lib/copy/legal.ts",
        "src/lib/scryfall.ts",
      ]),
    );
    expect(SRC_FILES.some((f) => f.startsWith("src/generated/"))).toBe(false);
  });

  test.each(SRC_FILES)(
    "%s makes none of the old footers' false claims",
    (file) => {
      expect(read(file)).not.toMatch(FALSE_FOOTER_CLAIMS);
    },
  );

  test("the claim pattern catches every spelling (ADV.6)", () => {
    for (const hit of [
      "CardKingdom",
      "Card Kingdom",
      "card  kingdom",
      "CardMarket",
      "Cardmarket",
      "Card Market",
      "Updated every 4 hours",
      "updated every four hours",
      "EVERY  4  HOURS",
    ]) {
      expect(hit).toMatch(FALSE_FOOTER_CLAIMS);
    }
    for (const miss of [
      "This product uses TCGplayer data",
      "Card prices are daily estimates",
      "every 24 hours",
      "every fourteen hours",
    ]) {
      expect(miss).not.toMatch(FALSE_FOOTER_CLAIMS);
    }
  });

  test("self-test: a false claim in a src/lib copy module is caught (ADV.6)", () => {
    expect(
      falseClaimFiles([
        {
          path: "src/lib/copy/legal.ts",
          source: read("src/lib/copy/legal.ts"),
        },
        {
          path: "src/lib/copy/entry-points.ts",
          source:
            'export const SOURCE = "Prices from TCGplayer and Card Kingdom, updated every four hours";',
        },
      ]),
    ).toEqual(["src/lib/copy/entry-points.ts"]);
  });

  test("evaluate-client.tsx has no Footer component", () => {
    const source = read("src/app/evaluate/evaluate-client.tsx");
    expect(source).not.toMatch(/function\s+Footer\b/);
    expect(source).not.toMatch(/<Footer\b/);
    expect(source).not.toMatch(/<footer\b/);
  });

  test.each(SRC_FILES.filter((f) => f.endsWith(".tsx")))(
    "%s uses neither the mm-footer nor the t-actions-foot class",
    (file) => {
      const source = read(file);
      expect(source).not.toMatch(/(?<![\w-])mm-footer(?![\w-])/);
      expect(source).not.toMatch(/(?<![\w-])t-actions-foot(?![\w-])/);
    },
  );
});

const TOKENS = read("src/app/tokens.css");
const FOOTER_CSS_PATH = "src/components/site-footer.css";
const FOOTER_CSS = read(FOOTER_CSS_PATH);

/** Every stylesheet under src/ except the footer's own (ADV.2: globals, tokens and component CSS included). */
const OTHER_STYLESHEETS = SRC_FILES.filter(
  (f) => f.endsWith(".css") && f !== FOOTER_CSS_PATH,
);
const outsideFindings = (file: string, css = read(file)) =>
  checkCssOutsideFooter(css, TOKENS, {
    rootTokens: file === "src/app/tokens.css",
  });

/** A Tailwind arbitrary variant ("[&~footer]:hidden"). */
const ARBITRARY_VARIANT = /\[[^\]\s"'`]*&[^\]\s"'`]*\]:/g;
/** One that reaches a sibling (the footer follows the page) or names the footer. */
const VARIANT_REACHES_FOOTER = /[~+]|footer|contentinfo/i;
const footerVariants = (source: string) =>
  [...source.matchAll(ARBITRARY_VARIANT)]
    .map((m) => m[0])
    .filter((v) => VARIANT_REACHES_FOOTER.test(v));
/** A DOM query for the footer from page code. */
const FOOTER_DOM_QUERY =
  /\b(?:querySelector(?:All)?|closest|matches|getElementsByTagName|getElementsByClassName)\s*\(\s*["'`][^"'`]*(?:footer|contentinfo)/i;

describe("footer styles live with the component, and nothing else reaches it (T12)", () => {
  test("evaluate.css has no .mm-footer selector", () => {
    const selectors = selectorsOf(read("src/app/evaluate/evaluate.css"));
    expect(selectors.filter((s) => /\.mm-footer(?![\w-])/.test(s))).toEqual([]);
    expect(read("src/app/evaluate/evaluate.css")).not.toMatch(
      /\.mm-footer(?![\w-])/,
    );
  });

  test("every other stylesheet is checked: globals, tokens, routes and components (ADV.2)", () => {
    expect(OTHER_STYLESHEETS).toEqual(
      expect.arrayContaining([
        "src/app/globals.css",
        "src/app/tokens.css",
        "src/app/landing.css",
        "src/app/evaluate/evaluate.css",
        "src/app/[card]/result.css",
        "src/components/nav-bar.css",
      ]),
    );
    expect(OTHER_STYLESHEETS).not.toContain(FOOTER_CSS_PATH);
  });

  test.each(OTHER_STYLESHEETS)(
    "%s neither names nor reaches the footer, and its html and body rules cannot hide it",
    (file) => {
      expect(outsideFindings(file)).toEqual([]);
    },
  );

  test.each([
    ["src/app/globals.css", "footer { display: none }", /names the footer/],
    [
      "src/components/nav-bar.css",
      "footer { display: none }",
      /names the footer/,
    ],
    [
      "src/app/evaluate/evaluate.css",
      "body > :last-child { visibility: hidden }",
      /can match the footer's footer/,
    ],
    [
      "src/app/evaluate/evaluate.css",
      "p { display: none }",
      /footer's line 1, line 2, line 3/,
    ],
    ["src/app/landing.css", "a { color: #0c0c0c }", /footer's link/],
    [
      "src/app/landing.css",
      "* { opacity: 0 }",
      /can match the footer's footer/,
    ],
    ["src/app/landing.css", "body > * { visibility: hidden }", /can match/],
    [
      "src/app/[card]/result.css",
      ":last-of-type { display: none }",
      /can match/,
    ],
    ["src/app/[card]/result.css", ".mm-app ~ * { display: none }", /can match/],
    ["src/app/[card]/result.css", "main + * { display: none }", /can match/],
    ["src/app/globals.css", "body * { opacity: 0 }", /can match/],
    [
      "src/app/globals.css",
      "[role=contentinfo] { display: none }",
      /names the footer/,
    ],
    [
      "src/app/globals.css",
      ".mm-site-footer { display: none }",
      /names the footer/,
    ],
    [
      "src/app/globals.css",
      "@media print { p { display: none } }",
      /\(in @media print\): can match/,
    ],
    [
      "src/app/globals.css",
      "body { visibility: hidden }",
      /visibility: hidden on body can hide/,
    ],
    [
      "src/app/globals.css",
      "body { overflow: hidden; height: 100vh }",
      /overflow: hidden on body/,
    ],
    [
      "src/app/globals.css",
      "html { -webkit-text-fill-color: #0c0c0c }",
      /-webkit-text-fill-color: #0c0c0c on html/,
    ],
    [
      "src/app/globals.css",
      "html { font-size: 1px }",
      /font-size: 1px on html/,
    ],
    [
      "src/app/globals.css",
      "body { background: #fefffe }",
      /ground stays --mox-onyx/,
    ],
    [
      "src/app/globals.css",
      "body { --fg-secondary: #0c0c0c }",
      /redefines a token/,
    ],
    [
      "src/app/tokens.css",
      "@media (min-width: 1px) { :root { --fg-secondary: #0c0c0c } }",
      /redefines a token/,
    ],
    [
      "src/app/globals.css",
      ".x { color: red; &:hover { color: blue } }",
      /unreadable CSS/,
    ],
  ])("flags %s + %s", (file, extra, expected) => {
    const findings = outsideFindings(file, `${read(file)}\n${extra}`);
    expect(findings.join("\n")).toMatch(expected);
  });

  test("the reach model: what can and cannot match the footer, its lines or its link", () => {
    const reach = (selector: string) =>
      elementsReached(selector).map((e) => e.name);
    for (const [selector, names] of [
      ["footer", ["footer"]],
      ["p", ["line 1", "line 2", "line 3"]],
      ["a", ["link"]],
      ["a:any-link", ["link"]],
      ["body > :last-child", ["footer"]],
      ["body > *", ["footer"]],
      ["body *", ["footer", "line 1", "line 2", "line 3", "link"]],
      ["html p", ["line 1", "line 2", "line 3"]],
      ["p + p", ["line 2", "line 3"]],
      ["p ~ p > a", []],
      ["p:first-child > a", ["link"]],
      ["[class] > a[href]", ["link"]],
      [
        ":not(.x)",
        ["html", "body", "footer", "line 1", "line 2", "line 3", "link"],
      ],
      ["html", ["html"]],
      [":root", ["html"]],
      ["body", ["body"]],
      [".mm-app > *", []],
      [".landing-page > *", []],
      [".mm-tile.has-agate > *", []],
      [".x p", []],
      [".x *", []],
      [".x > p", []],
      ["#main ~ *", ["footer"]],
      ["#main + body", []],
      [".t-toggle button", []],
      [".mm-brand img", []],
      [".t-price-editable input.val", []],
      [".mm-app::before", []],
      ["[role=contentinfo]", []],
      [":root > body > footer", ["footer"]],
    ] as const) {
      expect([selector, reach(selector)]).toEqual([selector, names]);
    }
  });

  test("the selector reader splits compounds and combinators, and rejects what it cannot read", () => {
    expect(
      parseSelector("body > main.a + .b ~ p:nth-child(2n+1) a[href^='x y']")
        .combinators,
    ).toEqual([">", "+", "~", " "]);
    expect(parseSelector(".a::before").compounds[0]).toMatchObject({
      classes: ["a"],
      pseudoElements: ["before"],
    });
    expect(() => parseSelector("> a")).toThrow(CssReadError);
    expect(() => parseSelector("a >")).toThrow(CssReadError);
    expect(() => parseSelector("&:hover")).toThrow(CssReadError);
    expect(() => parseSelector("a[href")).toThrow(CssReadError);
  });

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

  test("mm-site-footer appears in no stylesheet but site-footer.css", () => {
    const css = SRC_FILES.filter((f) => f.endsWith(".css"));
    const withFooter = css.filter((f) => /mm-site-footer/.test(read(f)));
    expect(withFooter).toEqual([FOOTER_CSS_PATH]);
  });

  test("site-footer.tsx imports ./site-footer.css", () => {
    expect(read("src/components/site-footer.tsx")).toMatch(
      /^import\s+["']\.\/site-footer\.css["'];?$/m,
    );
  });

  test.each(CODE_FILES)(
    "%s has no Tailwind variant that reaches the footer and no DOM query for it",
    (file) => {
      const source = read(file);
      expect(footerVariants(source)).toEqual([]);
      if (file !== "src/components/site-footer.tsx") {
        expect(source).not.toMatch(FOOTER_DOM_QUERY);
      }
    },
  );

  test("self-test: sibling and footer-naming Tailwind variants and footer DOM queries are caught", () => {
    expect(
      footerVariants(
        'className="[&~footer]:hidden [&+*]:invisible [&~*]:opacity-0 [&>svg]:size-4 [&:hover]:underline w-[calc(100%+2px)]"',
      ),
    ).toEqual(["[&~footer]:", "[&+*]:", "[&~*]:"]);
    expect('document.querySelector("footer")?.remove()').toMatch(
      FOOTER_DOM_QUERY,
    );
    expect("el.closest('[role=contentinfo]')").toMatch(FOOTER_DOM_QUERY);
    expect('document.querySelector(".mm-nav")').not.toMatch(FOOTER_DOM_QUERY);
  });
});

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

  const base = `.mm-site-footer { position: relative; z-index: 1; color: var(--fg-secondary); font: var(--ts-caption); }
.mm-site-footer-link { color: var(--fg-primary); }`;
  const notAllowed = (decl: string) =>
    new RegExp(
      `${decl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not on the footer's property allowlist`,
    );

  test.each([
    [
      "display: none in a media query",
      "@media (max-width: 600px) { .mm-site-footer { display: none } }",
      notAllowed("display: none"),
    ],
    [
      "a base opacity: 0 revealed by :hover",
      ".mm-site-footer { opacity: 0 } .mm-site-footer:hover { opacity: 1 }",
      /opacity: 0 is not on[\s\S]*opacity: 1 in a state rule/,
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
    [
      "visibility: hidden",
      ".mm-site-footer { visibility: hidden }",
      notAllowed("visibility: hidden"),
    ],
    [
      "visibility: collapse",
      ".mm-site-footer { visibility: collapse }",
      notAllowed("visibility: collapse"),
    ],
    [
      "height: 0",
      ".mm-site-footer { height: 0; overflow: hidden }",
      notAllowed("height: 0"),
    ],
    [
      "max-height: 0px",
      ".mm-site-footer { max-height: 0px }",
      notAllowed("max-height: 0px"),
    ],
    [
      "clip",
      ".mm-site-footer { clip: rect(0 0 0 0) }",
      notAllowed("clip: rect(0 0 0 0)"),
    ],
    [
      "clip-path",
      ".mm-site-footer { clip-path: inset(50%) }",
      notAllowed("clip-path: inset(50%)"),
    ],
    [
      "content-visibility: hidden",
      ".mm-site-footer { content-visibility: hidden }",
      notAllowed("content-visibility: hidden"),
    ],
    [
      "a negative text-indent",
      ".mm-site-footer-line { text-indent: -9999px }",
      notAllowed("text-indent: -9999px"),
    ],
    ["position: fixed", ".mm-site-footer { position: fixed }", /normal flow/],
    ["position: sticky", ".mm-site-footer { position: sticky }", /normal flow/],
    ["a negative z-index", ".mm-site-footer { z-index: -1 }", /grain overlays/],
    [
      "transform: scale(0)",
      ".mm-site-footer { transform: scale(0) }",
      notAllowed("transform: scale(0)"),
    ],
    [
      "a background",
      ".mm-site-footer { background: #fefffe }",
      notAllowed("background: #fefffe"),
    ],
    [
      "color: transparent",
      ".mm-site-footer-line { color: transparent }",
      /contrast 1\.00:1/,
    ],
    [
      "a :focus rule changing display",
      ".mm-site-footer-link:focus { display: inline-block }",
      /display: inline-block in a state rule/,
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
      notAllowed("display: none"),
    ],
    // ADV.1: truncation, expand-on-interaction and off-screen patterns.
    [
      "an ellipsis truncation",
      ".mm-site-footer-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }",
      /white-space: nowrap is not on[\s\S]*overflow: hidden is not on[\s\S]*text-overflow: ellipsis is not on/,
    ],
    [
      "a one-line clamp",
      ".mm-site-footer-line { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden }",
      notAllowed("-webkit-line-clamp: 1"),
    ],
    [
      "a max-height revealed by :active",
      ".mm-site-footer { max-height: 1.3em; overflow: hidden } .mm-site-footer:active { max-height: none }",
      /max-height: 1\.3em is not on[\s\S]*max-height: none in a state rule/,
    ],
    [
      "a max-height revealed by :target",
      ".mm-site-footer { max-height: 1.3em; overflow: hidden } .mm-site-footer:target { max-height: none }",
      /max-height: none in a state rule/,
    ],
    [
      "a 1px height",
      ".mm-site-footer { height: 1px; overflow: hidden }",
      notAllowed("height: 1px"),
    ],
    [
      "an off-screen left offset",
      ".mm-site-footer { position: relative; left: -10000px }",
      notAllowed("left: -10000px"),
    ],
    ["scale: 0", ".mm-site-footer { scale: 0 }", notAllowed("scale: 0")],
    [
      "translate",
      ".mm-site-footer { translate: -9999px }",
      notAllowed("translate: -9999px"),
    ],
    [
      "a negative margin",
      ".mm-site-footer { margin-top: -9999px }",
      /margin-top: -9999px has -9999px, outside 0px to 64px/,
    ],
    ["zoom", ".mm-site-footer { zoom: 0.1 }", notAllowed("zoom: 0.1")],
    [
      "block-size: 0",
      ".mm-site-footer { block-size: 0 }",
      notAllowed("block-size: 0"),
    ],
    [
      "contain: size",
      ".mm-site-footer { contain: size }",
      notAllowed("contain: size"),
    ],
    [
      "a text fill colour",
      ".mm-site-footer-line { -webkit-text-fill-color: #0c0c0c }",
      notAllowed("-webkit-text-fill-color: #0c0c0c"),
    ],
    ["inset", ".mm-site-footer { inset: 0 }", notAllowed("inset: 0")],
    [
      "rotate",
      ".mm-site-footer { rotate: 90deg }",
      notAllowed("rotate: 90deg"),
    ],
    [
      "inline-size",
      ".mm-site-footer { inline-size: 0 }",
      notAllowed("inline-size: 0"),
    ],
    // Bounds on the allowlisted properties.
    [
      "a huge positive margin",
      ".mm-site-footer { margin-left: 10000px }",
      /outside 0px to 64px/,
    ],
    [
      "a huge padding",
      ".mm-site-footer-line { padding: 0 0 0 9999px }",
      /outside 0px to 64px/,
    ],
    [
      "a percentage margin",
      ".mm-site-footer { margin: 0 50% }",
      /"50%", which is not a px, rem or em length/,
    ],
    [
      "a calc() padding",
      ".mm-site-footer { padding: calc(100vw) }",
      /not a px, rem or em length/,
    ],
    [
      "a narrow max-width",
      ".mm-site-footer { max-width: 1px }",
      /squeezes the footer below 320px/,
    ],
    [
      "a thick inset outline painted over the text",
      ".mm-site-footer { outline: 50px solid #0c0c0c; outline-offset: -50px }",
      /outline: 50px solid #0c0c0c has 50px[\s\S]*outline-offset: -50px has -50px/,
    ],
    [
      "a thick underline",
      ".mm-site-footer-link { text-decoration-thickness: 100px }",
      /outside 0px to 4px/,
    ],
    [
      "a thick border",
      ".mm-site-footer { border-top: 9999px solid #0c0c0c }",
      /outside 0px to 4px/,
    ],
    [
      "overlapping lines",
      ".mm-site-footer-line { line-height: 0.1 }",
      /line height 0\.1 is below 1/,
    ],
    [
      "a raw font shorthand (any family, any line height)",
      ".mm-site-footer { font: 12px/0.1 Blank }",
      /only through a var\(--ts-\*\) type token/,
    ],
    [
      "a token redefined on the footer",
      ".mm-site-footer { --fg-secondary: #0c0c0c }",
      notAllowed("--fg-secondary: #0c0c0c"),
    ],
    [
      "generated content",
      '.mm-site-footer::after { content: ""; background: #0c0c0c }',
      notAllowed('content: ""'),
    ],
    [
      "z-index: auto",
      ".mm-site-footer { z-index: auto }",
      /z-index: auto is not an integer of 1 or more/,
    ],
    ["position: static", ".mm-site-footer { position: static }", /normal flow/],
    [
      "a :has() state rule",
      ".mm-site-footer:has(a:hover) { z-index: 2 }",
      /z-index: 2 in a state rule/,
    ],
    [
      "a hover media query",
      "@media (hover: hover) { .mm-site-footer-line { margin: 0 } }",
      /margin: 0 in a state rule/,
    ],
    [
      "a :focus-within rule",
      ".mm-site-footer:focus-within { padding: 0 }",
      /padding: 0 in a state rule/,
    ],
    [
      "a selector outside the footer",
      ".mm-app { z-index: 5 }",
      /selector "\.mm-app" reaches outside the footer/,
    ],
    [
      "an ancestor compound",
      "body .mm-site-footer { color: var(--fg-secondary) }",
      /selector "body \.mm-site-footer" reaches outside the footer/,
    ],
    [
      "an @font-face",
      "@font-face { font-family: Blank; src: url(blank.woff2) }",
      /@font-face: only @media at-rules/,
    ],
    [
      "an @import",
      '@import "x.css";',
      /@import "x\.css": only @media at-rules/,
    ],
    [
      "an @supports wrapper",
      "@supports (display: grid) { .mm-site-footer { color: var(--fg-secondary) } }",
      /@supports \(display: grid\): only @media at-rules/,
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
      checkFooterCss(
        ".mm-site-footer { position: relative; z-index: 1; font: var(--ts-caption) }",
        TOKENS,
      ),
    ).toEqual([
      ".mm-site-footer: no colour set, so its contrast is unchecked",
      ".mm-site-footer-link: no colour set, so its contrast is unchecked",
    ]);
  });

  test("the footer must be lifted above the grain overlays by a plain rule (ADV.3)", () => {
    const lift =
      /\.mm-site-footer: no plain rule sets position: relative and a z-index of 1 or more/;
    const withoutLift = FOOTER_CSS.replace("position: relative;", "").replace(
      "z-index: 1;",
      "",
    );
    expect(checkFooterCss(withoutLift, TOKENS).join("\n")).toMatch(lift);
    const staticAuto = FOOTER_CSS.replace(
      "position: relative;",
      "position: static;",
    ).replace("z-index: 1;", "z-index: auto;");
    const findings = checkFooterCss(staticAuto, TOKENS).join("\n");
    expect(findings).toMatch(lift);
    expect(findings).toMatch(/position: static/);
    expect(findings).toMatch(/z-index: auto/);
    // A lift only inside @media does not count.
    const mediaOnly = `${withoutLift}\n@media (min-width: 1px) { .mm-site-footer { position: relative; z-index: 1 } }`;
    expect(checkFooterCss(mediaOnly, TOKENS).join("\n")).toMatch(lift);
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
    const css = `/* .x { display: none } */
@supports (display: grid) { @media (min-width: 1px) { .a, .b { color: red } } }
@font-face { font-family: X; src: url("a;b.woff2") }
.c { background: url("data:image/png;base64,AAA") }
@import "late.css";`;
    const rules = extractRules(css);
    expect(rules.map((r) => [r.selector, r.atRules])).toEqual([
      [".a, .b", ["@supports (display: grid)", "@media (min-width: 1px)"]],
      [".c", []],
    ]);
    expect(rules[1].declarations).toEqual([
      { property: "background", value: 'url("data:image/png;base64,AAA")' },
    ]);
    expect(extractAtRules(css)).toEqual([
      "@supports (display: grid)",
      "@media (min-width: 1px)",
      "@font-face",
      '@import "late.css"',
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

  test("the grain overlays sit at z-index 0, below the footer, on hosts with no z-index (ADV.3)", () => {
    const zIndexOf = (decls: { property: string; value: string }[]) =>
      decls.find((d) => d.property === "z-index")?.value;
    const footerZ = Number(
      zIndexOf(
        extractRules(FOOTER_CSS).find((r) => r.selector === ".mm-site-footer")!
          .declarations,
      ),
    );
    const overlays = OTHER_STYLESHEETS.flatMap((file) => {
      const rules = extractRules(read(file));
      return rules
        .filter(
          (r) =>
            /::(?:before|after)$/.test(r.selector) &&
            r.declarations.some(
              (d) => d.property === "position" && d.value === "fixed",
            ),
        )
        .map((r) => ({
          file,
          selector: r.selector,
          z: zIndexOf(r.declarations),
          hostZ: rules
            .filter((h) => h.selector === r.selector.replace(/::\w+$/, ""))
            .map((h) => zIndexOf(h.declarations))
            .filter((z) => z !== undefined),
        }));
    });
    expect(overlays.map((o) => `${o.file} ${o.selector}`).sort()).toEqual([
      // S2.1: the result route repeats the /evaluate shell (result.css).
      "src/app/[card]/result.css .mm-app::before",
      "src/app/evaluate/evaluate.css .mm-app::before",
      "src/app/landing.css .landing-page::before",
    ]);
    for (const overlay of overlays) {
      expect(Number(overlay.z)).toBe(0);
      expect(Number(overlay.z)).toBeLessThan(footerZ);
      expect(overlay.hostZ).toEqual([]);
    }
  });
});

/** Where a file places the footer, read from its AST. */
const placementOf = (file: string, source: string): FooterPlacement =>
  footerPlacement(file, source);

/** Root layouts (files that render <html>) and those whose body does not end with the footer. */
function rootLayoutsWithoutFooter(files: { path: string; source: string }[]): {
  roots: string[];
  missing: string[];
} {
  const placed = files.map((f) => ({
    path: f.path,
    ...placementOf(f.path, f.source),
  }));
  const roots = placed.filter((p) => p.rendersHtml);
  return {
    roots: roots.map((p) => p.path),
    missing: roots.filter((p) => !p.footerLast).map((p) => p.path),
  };
}

/** The only files that may render each footer element; nothing may render the rest. */
const RENDER_ALLOWLIST: Record<string, string[]> = {
  SiteFooter: ["src/app/layout.tsx"],
  footer: ["src/components/site-footer.tsx"],
};
const NEVER_RENDERED = ["[role=contentinfo]", "style", "link"];

/** Every place a file renders a footer outside the allowlist, or a stylesheet or second landmark. */
function footerRenderViolations(
  files: { path: string; source: string }[],
): string[] {
  return files.flatMap((f) =>
    renderedElements(f.path, f.source)
      .filter((e) =>
        Object.hasOwn(RENDER_ALLOWLIST, e.name)
          ? !RENDER_ALLOWLIST[e.name].includes(f.path)
          : NEVER_RENDERED.includes(e.name),
      )
      .map((e) => `${f.path}:${e.line} renders ${e.name}`),
  );
}

describe("the root layout renders the footer, and nothing else renders one (T14)", () => {
  const codeFiles = CODE_FILES.map((f) => ({ path: f, source: read(f) }));
  const appFiles = codeFiles.filter((f) => f.path.startsWith("src/app/"));

  test("the only file under src/app that renders <html is layout.tsx, and its body ends with SiteFooter", () => {
    expect(rootLayoutsWithoutFooter(appFiles)).toEqual({
      roots: ["src/app/layout.tsx"],
      missing: [],
    });
  });

  test("layout.tsx renders <SiteFooter /> once, as the last child of <body>, after {children}", () => {
    const layout = read("src/app/layout.tsx");
    expect(placementOf("src/app/layout.tsx", layout)).toEqual({
      rendersHtml: true,
      footersInBody: 1,
      footerLast: true,
      afterChildren: true,
    });
    expect(
      renderedElements("src/app/layout.tsx", layout).filter(
        (e) => e.name === "SiteFooter",
      ),
    ).toHaveLength(1);
    expect(layout).toMatch(
      /^import \{ SiteFooter \} from "@\/components\/site-footer";$/m,
    );
  });

  test("SiteFooter renders only in layout.tsx, footer only in site-footer.tsx, and no source renders a contentinfo role, <style> or <link> (ADV.5)", () => {
    expect(footerRenderViolations(codeFiles)).toEqual([]);
    const count = (file: string, name: string) =>
      renderedElements(file, read(file)).filter((e) => e.name === name).length;
    expect(count("src/app/layout.tsx", "SiteFooter")).toBe(1);
    expect(count("src/components/site-footer.tsx", "footer")).toBe(1);
  });

  test("self-test: a nested layout, a page footer, createElement, a contentinfo role and a <style> are caught; comments are not (ADV.5)", () => {
    expect(
      footerRenderViolations([
        {
          path: "src/app/evaluate/layout.tsx",
          source:
            "export default function L({ children }) { return <>{children}<SiteFooter /></>; }",
        },
        {
          path: "src/app/[card]/page.tsx",
          source:
            "export default function P() { return <main><footer>x</footer></main>; }",
        },
        {
          path: "src/app/x/page.tsx",
          source:
            'import { createElement } from "react";\nexport const F = () => createElement("footer", null, "x");',
        },
        {
          path: "src/app/y/page.tsx",
          source:
            'export const Y = () => <div role="contentinfo">x</div>;\nexport const S = () => <style>{"footer{display:none}"}</style>;',
        },
        {
          path: "src/app/z/page.tsx",
          source:
            "export const Z = () => (\n  <main>\n    Don't {/* <footer>old</footer> <SiteFooter /> */}\n  </main>\n);\n// <footer>",
        },
      ]),
    ).toEqual([
      "src/app/evaluate/layout.tsx:1 renders SiteFooter",
      "src/app/[card]/page.tsx:1 renders footer",
      "src/app/x/page.tsx:2 renders footer",
      "src/app/y/page.tsx:1 renders [role=contentinfo]",
      "src/app/y/page.tsx:2 renders style",
    ]);
  });

  test("self-test: a root layout without a live footer as the last body child is flagged (ADV.5)", () => {
    const fixture = (name: string, body: string) => ({
      path: `src/app/${name}`,
      source: `export default function L({ children }) {\n  return (\n    <html lang="en">\n      ${body}\n    </html>\n  );\n}`,
    });
    const files = [
      fixture(
        "layout.tsx",
        "<body><p>Don't</p>{children}<SiteFooter /></body>",
      ),
      fixture("(marketing)/layout.tsx", "<body>{children}</body>"),
      fixture("global-error.tsx", "<body><h2>Something went wrong</h2></body>"),
      fixture(
        "(m)/layout.tsx",
        "<body>{children}{/* <SiteFooter /> */}</body>",
      ),
      fixture(
        "(c)/layout.tsx",
        "<body>{children}{false && <SiteFooter />}</body>",
      ),
      fixture("(b)/layout.tsx", "<body><SiteFooter />{children}</body>"),
      fixture("(o)/layout.tsx", "<body>{children}</body><SiteFooter />"),
      fixture(
        "(d)/layout.tsx",
        "<body>{children}<SiteFooter /><SiteFooter /></body>",
      ),
      {
        path: "src/app/page.tsx",
        source: "export default () => <main>hi</main>;",
      },
    ];
    expect(rootLayoutsWithoutFooter(files)).toEqual({
      roots: files.slice(0, -1).map((f) => f.path),
      missing: files.slice(1, -1).map((f) => f.path),
    });
    expect(placementOf(files[0].path, files[0].source).afterChildren).toBe(
      true,
    );
  });
});
