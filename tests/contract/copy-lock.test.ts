/// <reference types="vite/types/import-meta.d.ts" />
// T8, T17, T19 (S1.3, AC-1, AC-2, AC-5; C1.54, C1-F.15): one forbidden-phrase
// list, tamper-evident copy text, and every locked sentence in exactly one
// module. Source scans read the TypeScript AST, so comments never count.
import { readdirSync, readFileSync } from "node:fs";
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

/** Every non-test module under src/lib/copy (S2.4's entry-points.ts joins on arrival). */
const LIB_COPY_MODULES = import.meta.glob(
  [
    "../../src/lib/copy/*.ts",
    "!../../src/lib/copy/*.test.ts",
    "!../../src/lib/copy/*.test-d.ts",
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

/** Typographic problems in one string; `fragment` skips the edge checks. */
function hygiene(text: string, fragment: boolean): string[] {
  const problems: string[] = [];
  if (!fragment && text !== text.trim()) problems.push("edge whitespace");
  if (/ {2}/.test(text)) problems.push("double space");
  if (/[\n\r\t]/.test(text)) problems.push("newline or tab");
  if (/[\u2018\u2019\u201C\u201D]/.test(text)) problems.push("curly quote");
  if (/\u2013/.test(text)) problems.push("en dash");
  if (/--/.test(text)) problems.push("double hyphen");
  if (/\s-\s/.test(text)) problems.push("spaced hyphen");
  if (/\p{Cf}/u.test(text)) problems.push("format character");
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
    expect(hygiene("a\u200bb", false)).toEqual(["format character"]);
    expect(hygiene("it\u2019s", false)).toEqual(["curly quote"]);
    expect(hygiene(" a", false)).toEqual(["edge whitespace"]);
    expect(hygiene(" a", true)).toEqual([]);
    expect(hygiene("a - b", false)).toEqual(["spaced hyphen"]);
    expect(hygiene("a \u2013 b", false)).toEqual(["en dash"]);
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

  test("no string has edge whitespace, a double space, curly quotes, an en dash, a spaced hyphen or a format character", () => {
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
interface Literal {
  readonly line: number;
  readonly text: string;
}

/** String, template and JSX text in a source, whitespace collapsed and trimmed. */
function textLiterals(file: string, source: string): Literal[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const found: Literal[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text;
    } else if (ts.isJsxText(node)) {
      text = node.text;
    }
    if (text !== null) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      found.push({ line: line + 1, text: text.replace(/\s+/g, " ").trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * Locked sentences worth guarding: placeholder-free, with a space once
 * trimmed. Short labels ("Normal", "soon") collide with enum and demo values.
 */
const LOCKED = new Map<string, string>();
for (const { module, text } of COPY_STRINGS) {
  const trimmed = text.trim();
  if (/\{\w+\}/.test(trimmed) || !trimmed.includes(" ")) continue;
  if (!LOCKED.has(trimmed)) LOCKED.set(trimmed, module);
}

/** Literals in `file` that equal a locked sentence whose home is elsewhere. */
function duplicates(file: string, source: string): string[] {
  return textLiterals(file, source).flatMap(({ line, text }) => {
    const home = LOCKED.get(text);
    return home !== undefined && home !== file
      ? [`${file}:${line} duplicates ${home}: "${text}"`]
      : [];
  });
}

/** Test data, deliberately independent of copy.ts (S1.3d12). */
const SINGLE_SOURCE_EXEMPT = new Set(["src/lib/recommendation/fixtures.ts"]);

describe("every locked sentence has one home (T19, C1.54)", () => {
  test("the locked set holds the sentences that matter", () => {
    for (const sentence of [
      "Couldn't reach price data — try again.",
      "Enter a card and a price.",
      "Couldn't find that card",
      "At market price",
      "Market price via Scryfall (TCGplayer), updated daily",
    ]) {
      expect(LOCKED.has(sentence), sentence).toBe(true);
    }
    expect(LOCKED.has("Normal")).toBe(false);
    expect(LOCKED.has("soon")).toBe(false);
  });

  test("self-test: flags a planted literal and JSX text, passes a longer sentence", () => {
    const sample = [
      'export const E = "Couldn\'t reach price data — try again.";',
      "export const P = () => <p>Couldn't find that card</p>;",
      'export const L = "Enter a card and a price. We\'ll tell you.";',
      "export const T = `At market price`;",
    ].join("\n");
    expect(duplicates("src/components/x.tsx", sample)).toEqual([
      'src/components/x.tsx:1 duplicates src/lib/recommendation/ui-copy.ts: "Couldn\'t reach price data — try again."',
      'src/components/x.tsx:2 duplicates src/lib/recommendation/ui-copy.ts: "Couldn\'t find that card"',
      'src/components/x.tsx:4 duplicates src/lib/recommendation/copy.ts: "At market price"',
    ]);
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
