/// <reference types="vite/types/import-meta.d.ts" />
// T8, T17, T19 (S1.3, AC-1, AC-2, AC-5; C1.54, C1-F.15): one forbidden-phrase
// list, tamper-evident copy text, and every locked sentence in exactly one
// module. Source scans read the TypeScript AST, so comments never count.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import * as copyModule from "../../src/lib/recommendation/copy";
import { fillTemplate } from "../../src/lib/recommendation/copy";
import * as forbidden from "../../src/lib/recommendation/forbidden-phrases";
import * as uiCopyModule from "../../src/lib/recommendation/ui-copy";
import * as attributionSpec from "../helpers/attribution-spec";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
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

// --- the copy modules and their strings (T6's walk) -------------------------
interface Found {
  /** "<module> → <key path>". */
  readonly id: string;
  readonly module: string;
  readonly text: string;
}

function stringsIn(
  value: unknown,
  at: string,
  seen: Set<object> = new Set(),
): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path: at, text: value }];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const found = Array.isArray(value)
    ? value.flatMap((item, i) => stringsIn(item, `${at}[${i}]`, seen))
    : Object.entries(value).flatMap(([key, item]) =>
        stringsIn(item, at ? `${at}.${key}` : key, seen),
      );
  seen.delete(value);
  return found;
}

/** Every non-test module under src/lib/copy, at any depth (ADV-5; S2.4's entry-points.ts joins on arrival). */
const LIB_COPY_MODULES = import.meta.glob(
  [
    "../../src/lib/copy/**/*.{ts,tsx}",
    "!../../src/lib/copy/**/*.test.{ts,tsx}",
    "!../../src/lib/copy/**/*.test-d.ts",
    "!../../src/lib/copy/**/*.d.ts",
  ],
  { eager: true },
);

/** Repo-relative module path → module namespace. */
const COPY_MODULES: Record<string, unknown> = {
  "src/lib/recommendation/copy.ts": copyModule,
  "src/lib/recommendation/ui-copy.ts": uiCopyModule,
  ...Object.fromEntries(
    Object.entries(LIB_COPY_MODULES).map(([file, mod]) => [
      file.replace(/^(\.\.\/)+/, ""),
      mod,
    ]),
  ),
};

const COPY_STRINGS: Found[] = Object.entries(COPY_MODULES).flatMap(
  ([module, mod]) =>
    stringsIn(mod, "").map(({ path: keyPath, text }) => ({
      id: `${module} → ${keyPath}`,
      module,
      text,
    })),
);

// --- T8: one forbidden-phrase list -----------------------------------------
/** The comma list after "Forbidden words" in a markdown file's line. */
function documentedList(markdown: string): string[] {
  const line = markdown.split("\n").find((l) => /Forbidden words/.test(l));
  if (!line) throw new Error('no "Forbidden words" line');
  const list = line.slice(
    line.indexOf(":", line.indexOf("Forbidden words")) + 1,
  );
  return list
    .trim()
    .replace(/\.$/, "")
    .split(",")
    .map((w) => w.trim());
}

/** The parser's script kind for a file name. */
function scriptKind(file: string): ts.ScriptKind {
  if (/\.[jt]sx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Runtime string and no-substitution template literals in a source, read
 * from the AST. A literal type (`Fixture["expected"]`) never reaches a user,
 * so it is skipped.
 */
function stringLiterals(file: string, source: string): string[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !ts.isLiteralTypeNode(node.parent)
    ) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const PHRASE_HOME = "src/lib/recommendation/forbidden-phrases.ts";

describe("one forbidden-phrase list (T8, C1-F.15)", () => {
  test("the spec helper re-exports the very list and matcher", () => {
    expect(attributionSpec.FORBIDDEN_REASON_WORDS).toBe(
      forbidden.FORBIDDEN_PHRASES,
    );
    expect(attributionSpec.findForbiddenReasonWords).toBe(
      forbidden.findForbiddenPhrases,
    );
  });

  test.each(["AGENTS.md", ".cursor/rules/recommendation-engine.mdc"])(
    "%s restates the list exactly (read-only drift guard)",
    (file) => {
      expect(documentedList(read(file))).toEqual([
        ...forbidden.FORBIDDEN_PHRASES,
      ]);
    },
  );

  test("the list parser reads a documented line", () => {
    expect(
      documentedList("- Forbidden words (lint-tested): likely, should.\n"),
    ).toEqual(["likely", "should"]);
  });

  test("no other non-test source holds a phrase as a string literal", () => {
    const files = [
      ...filesUnder("src"),
      ...filesUnder("scripts"),
      ...filesUnder("tests/helpers"),
    ].filter(
      (f) =>
        isCode(f) &&
        !isTest(f) &&
        !f.startsWith("src/generated/") &&
        f !== PHRASE_HOME,
    );
    expect(files).toEqual(
      expect.arrayContaining([
        "src/lib/recommendation/copy.ts",
        "src/lib/recommendation/ui-copy.ts",
        "tests/helpers/attribution-spec.ts",
        "scripts/test-report.mjs",
      ]),
    );
    const phrases = new Set<string>(forbidden.FORBIDDEN_PHRASES);
    const offenders = files.flatMap((file) =>
      stringLiterals(file, read(file))
        .filter((text) => phrases.has(text.trim().toLowerCase()))
        .map((text) => `${file}: "${text}"`),
    );
    expect(offenders).toEqual([]);
    // The home module does hold them, so the scan reads literals.
    expect(
      stringLiterals(PHRASE_HOME, read(PHRASE_HOME)).filter((t) =>
        phrases.has(t),
      ),
    ).toHaveLength(phrases.size);
  });
});

// --- T17: tamper-evident text ----------------------------------------------
/** Declared fragments: strings meant to be joined, exempt from the edge checks. */
const FRAGMENTS = [
  "src/lib/recommendation/copy.ts → CLAUSE_SEPARATOR",
  "src/lib/recommendation/copy.ts → SENTENCE_END",
  "src/lib/copy/legal.ts → FAN_CONTENT_LINE.before",
  "src/lib/copy/legal.ts → FAN_CONTENT_LINE.after",
  "src/lib/copy/legal.ts → FAN_CONTENT_LINE.link.href",
  "src/lib/copy/legal.ts → FAN_CONTENT_POLICY_LINK.href",
];

/** The only strings that may hold U+2014. */
const EM_DASH_HOMES = [
  "src/lib/recommendation/copy.ts → REASON_COPY.insufficientData",
  "src/lib/recommendation/copy.ts → FALLBACK_NOTICE",
  "src/lib/recommendation/ui-copy.ts → UI_COPY.errorPanel",
];

/** Each template's placeholder set (S1.3d7); every other string has none. */
const DECLARED_PLACEHOLDERS: Record<string, string[]> = {
  "src/lib/recommendation/copy.ts → REASON_COPY.within": ["X"],
  "src/lib/recommendation/copy.ts → REASON_COPY.below": ["X"],
  "src/lib/recommendation/copy.ts → REASON_COPY.above": ["X"],
  "src/lib/recommendation/copy.ts → REASON_COPY.thinData": ["n"],
  "src/lib/recommendation/copy.ts → REASON_COPY.stale": ["d"],
  "src/lib/recommendation/copy.ts → REASON_COPY.trend": ["direction", "X"],
  "src/lib/recommendation/copy.ts → REASON_COPY.volatility": ["X"],
  "src/lib/recommendation/copy.ts → FALLBACK_NOTICE": ["finish"],
  "src/lib/recommendation/copy.ts → SHOCK_TOOLTIP": ["signedX"],
  "src/lib/recommendation/ui-copy.ts → UI_COPY.historyLine": [
    "N",
    "relativeTime",
  ],
  "src/lib/recommendation/ui-copy.ts → UI_COPY.staleFlag": ["hours"],
  "src/lib/recommendation/ui-copy.ts → UI_COPY.printingOption": [
    "set_name",
    "SET",
    "collector_number",
  ],
};

/**
 * The code points copy may hold (ADV-7): printable ASCII, the em dash, ±, ·
 * and ©. Newlines and tabs have their own check.
 */
const OUTSIDE_ALLOWED_CODE_POINTS =
  /[^\x20-\x7E\u2014\u00B1\u00B7\u00A9\n\r\t]/gu;

/** Typographic problems in one string; `fragment` skips the edge checks. */
function hygiene(text: string, fragment: boolean): string[] {
  const problems: string[] = [];
  if (!fragment && text !== text.trim()) problems.push("edge whitespace");
  if (/ {2}/.test(text)) problems.push("double space");
  if (/[\n\r\t]/.test(text)) problems.push("newline or tab");
  if (/--/.test(text)) problems.push("double hyphen");
  if (/\s-\s/.test(text)) problems.push("spaced hyphen");
  // ADV-7: an allowlist, not a denylist, so curly quotes, en dashes, format
  // and default-ignorable characters, Hangul fillers and Cyrillic or Greek
  // lookalikes all fail by name.
  for (const char of new Set(text.match(OUTSIDE_ALLOWED_CODE_POINTS) ?? [])) {
    problems.push(
      `code point U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
    );
  }
  return problems;
}

/** The `{name}` placeholders, or null when a brace is unbalanced. */
function placeholdersOf(text: string): string[] | null {
  const names = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const rest = text.replace(/\{\w+\}/g, "");
  return /[{}]/.test(rest) ? null : names;
}

describe("tamper-evident copy text (T17)", () => {
  test("self-test: the checks flag broken text and pass clean text", () => {
    expect(placeholdersOf("{X")).toBeNull();
    expect(placeholdersOf("X}")).toBeNull();
    expect(placeholdersOf("{X} of {n}")).toEqual(["X", "n"]);
    expect(hygiene("a  b", false)).toEqual(["double space"]);
    expect(hygiene("a\u200bb", false)).toEqual(["code point U+200B"]);
    expect(hygiene("it\u2019s", false)).toEqual(["code point U+2019"]);
    expect(hygiene("\u0435xample", false)).toEqual(["code point U+0435"]);
    expect(hygiene("pre\u3164dict", false)).toEqual(["code point U+3164"]);
    expect(hygiene("sho\ufe0fuld", false)).toEqual(["code point U+FE0F"]);
    expect(hygiene("\u2014 \u00b1 \u00b7 \u00a9 ok", false)).toEqual([]);
    expect(hygiene(" a", false)).toEqual(["edge whitespace"]);
    expect(hygiene(" a", true)).toEqual([]);
    expect(hygiene("a - b", false)).toEqual(["spaced hyphen"]);
    expect(hygiene("a \u2013 b", false)).toEqual(["code point U+2013"]);
    expect(hygiene("third-party data", false)).toEqual([]);
  });

  test("every declared fragment, em-dash home and template exists", () => {
    const ids = COPY_STRINGS.map((s) => s.id);
    for (const id of [
      ...FRAGMENTS,
      ...EM_DASH_HOMES,
      ...Object.keys(DECLARED_PLACEHOLDERS),
    ]) {
      expect(ids).toContain(id);
    }
  });

  test("no string has edge whitespace, a double space, a spaced hyphen or a code point outside printable ASCII, —, ±, · and ©", () => {
    const problems = COPY_STRINGS.flatMap(({ id, text }) =>
      hygiene(text, FRAGMENTS.includes(id)).map((p) => `${id}: ${p}`),
    );
    expect(problems).toEqual([]);
  });

  test("U+2014 appears only in the insufficient_data sentence, the fallback notice and the error panel", () => {
    const withDash = COPY_STRINGS.filter(({ text }) =>
      text.includes("\u2014"),
    ).map((s) => s.id);
    expect(withDash.sort()).toEqual([...EM_DASH_HOMES].sort());
  });

  test("each string's placeholders are balanced and equal its declared set", () => {
    for (const { id, text } of COPY_STRINGS) {
      expect(placeholdersOf(text), id).toEqual(DECLARED_PLACEHOLDERS[id] ?? []);
    }
  });

  test("filling every declared placeholder leaves no brace", () => {
    for (const { id, text } of COPY_STRINGS) {
      const values = Object.fromEntries(
        (DECLARED_PLACEHOLDERS[id] ?? []).map((name) => [name, 7]),
      );
      const filled = fillTemplate(text, values);
      expect(filled, id).not.toMatch(/[{}]/);
    }
  });
});

// --- T19: every locked sentence has one home --------------------------------
/** HTML entities JSX text may spell copy with (`Couldn&rsquo;t`, ADV-2). */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  quot: '"',
  lt: "<",
  gt: ">",
  nbsp: " ",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  prime: "′",
  ndash: "–",
  mdash: "—",
  minus: "−",
  hellip: "…",
  middot: "·",
  plusmn: "±",
  copy: "©",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, body: string) => {
      if (!body.startsWith("#")) {
        return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
      }
      const hex = /^#x/i.test(body);
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    },
  );
}

/** An expression slot: a placeholder, a `${…}` or a JSX child that is not text. */
const SLOT = "\u0000";

/**
 * The key two texts are compared by (ADV-2): entities decoded, NFKC, format
 * characters dropped, curly quotes straight, every dash (hyphen, en, em,
 * minus) one " - ", whitespace collapsed, lower case, and trailing . ! ? and
 * whitespace dropped. Slots survive.
 */
function copyKey(text: string): string {
  return decodeEntities(text)
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[‘’‚‛′ʼ]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[^\S\0]*[\p{Pd}−]+[^\S\0]*/gu, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[.!?\s]+$/, "");
}

interface Literal {
  readonly line: number;
  /** The source text, slots shown as SLOT. */
  readonly text: string;
}

/**
 * Text a source can render, read from the AST: string and template literals,
 * whole templates (each `${…}` a slot), JSX text, and each JSX element's
 * children in order (each non-text child a slot), so a sentence split by
 * `{n}` is still one candidate.
 */
function textLiterals(file: string, source: string): Literal[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const found: Literal[] = [];
  const add = (node: ts.Node, text: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push({ line: line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      add(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      add(
        node,
        [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(
          SLOT,
        ),
      );
    } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      add(
        node,
        node.children
          .map((child) => (ts.isJsxText(child) ? child.text : SLOT))
          .join(""),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * Locked sentences, by key: placeholder-free, with a space once trimmed.
 * Short labels ("Normal", "soon") collide with enum and demo values.
 */
const LOCKED = new Map<string, string>();
/**
 * Locked templates (ADV-2): each one's static segments, matched in order, so
 * `This printing has no ${label} price — showing Normal pricing.` and
 * `<p>Price history: {n} snapshots, newest {t}</p>` are caught. A template
 * whose static text holds fewer than six letters (the printing option,
 * "{set_name} ({SET}) · #{collector_number}") is punctuation that any
 * formatting code shares, so it is left out.
 */
const LOCKED_TEMPLATES: { id: string; home: string; segments: string[] }[] = [];
for (const { id, module, text } of COPY_STRINGS) {
  const trimmed = text.trim();
  if (/\{\w+\}/.test(trimmed)) {
    const key = copyKey(trimmed.replace(/\{\w+\}/g, SLOT));
    const segments = key
      .split(SLOT)
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if ((segments.join("").match(/\p{L}/gu) ?? []).length >= 6) {
      LOCKED_TEMPLATES.push({ id, home: module, segments });
    }
  } else if (trimmed.includes(" ")) {
    const key = copyKey(trimmed);
    if (!LOCKED.has(key)) LOCKED.set(key, module);
  }
}

/** True when `key` holds every segment, in order. */
function holdsInOrder(key: string, segments: string[]): boolean {
  let from = 0;
  for (const segment of segments) {
    const at = key.indexOf(segment, from);
    if (at < 0) return false;
    from = at + segment.length;
  }
  return true;
}

/** Literals in `file` that repeat a locked sentence or template whose home is elsewhere. */
function duplicates(file: string, source: string): string[] {
  const shown = (text: string) =>
    text.replace(/\s+/g, " ").trim().split(SLOT).join("{…}");
  return textLiterals(file, source).flatMap(({ line, text }) => {
    const key = copyKey(text);
    const homes = new Set<string>();
    const sentenceHome = LOCKED.get(key);
    if (sentenceHome !== undefined) homes.add(sentenceHome);
    for (const t of LOCKED_TEMPLATES) {
      if (holdsInOrder(key, t.segments)) homes.add(t.home);
    }
    homes.delete(file);
    return [...homes].map(
      (home) => `${file}:${line} duplicates ${home}: "${shown(text)}"`,
    );
  });
}

/**
 * Exempt from the single-source scan. fixtures.ts is test data, deliberately
 * independent of copy.ts (S1.3d12). The /sample demo is V1 copy that S2.4
 * deletes (S2.4 AC-12); the test below fails once the file is gone, so S2.4
 * drops the entry in the same PR.
 */
const SINGLE_SOURCE_EXEMPT = new Set([
  "src/lib/recommendation/fixtures.ts",
  "src/app/sample/decision-analysis.tsx",
]);

describe("every locked sentence has one home (T19, C1.54)", () => {
  test("the locked set holds the sentences that matter", () => {
    for (const sentence of [
      "Couldn't reach price data — try again.",
      "Enter a card and a price.",
      "Couldn't find that card",
      "At market price",
      "Market price via Scryfall (TCGplayer), updated daily",
    ]) {
      expect(LOCKED.has(copyKey(sentence)), sentence).toBe(true);
    }
    expect(LOCKED.has(copyKey("Normal"))).toBe(false);
    expect(LOCKED.has(copyKey("soon"))).toBe(false);
  });

  test("the locked templates hold every placeholder template but the printing option (ADV-2)", () => {
    const ids = LOCKED_TEMPLATES.map((t) => t.id);
    expect(ids.sort()).toEqual(
      Object.keys(DECLARED_PLACEHOLDERS)
        .filter((id) => !id.endsWith("UI_COPY.printingOption"))
        .sort(),
    );
  });

  test("self-test: copyKey folds entities, quotes, dashes, case and the final stop (ADV-2)", () => {
    const key = copyKey("Couldn't reach price data — try again.");
    for (const variant of [
      "Couldn&rsquo;t reach price data &mdash; try again.",
      "Couldn&#8217;t reach price data &#x2014; try again",
      "Couldn’t reach price data – try again!",
      "couldn't  reach price data - try again",
      "COULDN'T REACH PRICE DATA—TRY AGAIN.",
      "Couldn​'t reach price data — try again?",
    ]) {
      expect(copyKey(variant), variant).toBe(key);
    }
    expect(copyKey("Enter a card and a price. We'll tell you.")).not.toBe(
      copyKey("Enter a card and a price."),
    );
  });

  test("self-test: flags planted literals, entities, variants, templates and split JSX, passes a longer sentence", () => {
    const sample = [
      'export const E = "Couldn\'t reach price data — try again.";',
      "export const P = () => <p>Couldn't find that card</p>;",
      'export const L = "Enter a card and a price. We\'ll tell you.";',
      "export const T = `At market price`;",
      "export const A = () => <p>Couldn&rsquo;t find that card</p>;",
      "export const B = () => <p>Couldn’t reach price data — try again.</p>;",
      'export const C = () => <p>{"Couldn\'t find that card."}</p>;',
      'export const D = "Couldn\'t reach price data - try again.";',
      "export const F = (label: string) => `This printing has no ${label} price — showing Normal pricing.`;",
      "export const H = ({ n, t }: { n: number; t: string }) => <p>Price history: {n} snapshots, newest {t}</p>;",
      "export const R = (x: number) => `${x}% below market`;",
      'export const ok = "Esper Sentinel";',
    ].join("\n");
    const ui = "src/lib/recommendation/ui-copy.ts";
    const copy = "src/lib/recommendation/copy.ts";
    expect(duplicates("src/components/x.tsx", sample)).toEqual([
      `src/components/x.tsx:1 duplicates ${ui}: "Couldn't reach price data — try again."`,
      `src/components/x.tsx:2 duplicates ${ui}: "Couldn't find that card"`,
      `src/components/x.tsx:2 duplicates ${ui}: "Couldn't find that card"`,
      `src/components/x.tsx:4 duplicates ${copy}: "At market price"`,
      `src/components/x.tsx:5 duplicates ${ui}: "Couldn&rsquo;t find that card"`,
      `src/components/x.tsx:5 duplicates ${ui}: "Couldn&rsquo;t find that card"`,
      `src/components/x.tsx:6 duplicates ${ui}: "Couldn’t reach price data — try again."`,
      `src/components/x.tsx:6 duplicates ${ui}: "Couldn’t reach price data — try again."`,
      `src/components/x.tsx:7 duplicates ${ui}: "Couldn't find that card."`,
      `src/components/x.tsx:8 duplicates ${ui}: "Couldn't reach price data - try again."`,
      `src/components/x.tsx:9 duplicates ${copy}: "This printing has no {…} price — showing Normal pricing."`,
      `src/components/x.tsx:10 duplicates ${ui}: "Price history: {…} snapshots, newest {…}"`,
      `src/components/x.tsx:11 duplicates ${copy}: "{…}% below market"`,
      `src/components/x.tsx:11 duplicates ${copy}: "% below market"`,
    ]);
  });

  test("each exempt file exists, so a deleted one leaves the list with it", () => {
    for (const file of SINGLE_SOURCE_EXEMPT) {
      expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    }
  });

  test("no non-test source under src/ repeats a locked sentence outside its home", () => {
    const files = filesUnder("src").filter(
      (f) =>
        /\.tsx?$/.test(f) &&
        !isTest(f) &&
        !f.startsWith("src/generated/") &&
        !SINGLE_SOURCE_EXEMPT.has(f),
    );
    expect(files).toEqual(
      expect.arrayContaining([
        "src/app/evaluate/evaluate-client.tsx",
        "src/app/page.tsx",
        "src/lib/recommendation/reason.ts",
        "src/components/site-footer.tsx",
      ]),
    );
    const offenders = files.flatMap((file) => duplicates(file, read(file)));
    expect(offenders).toEqual([]);
  });
});
