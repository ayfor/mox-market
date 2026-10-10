// AC-6 and AC-8 support (S2.2d12): a small regex-and-scanner CSS reader, a
// resolver for var() chains defined in tokens.css :root, the footer's
// property allowlist with visibility, contrast and size bounds (ADV.1, ADV.3),
// and a selector reach model for every other stylesheet (ADV.2). No CSS
// parser dependency. Anything the reader cannot understand fails the check
// instead of passing silently.

export type Declaration = { property: string; value: string };
export type CssRule = {
  /** The rule's selector list as written, whitespace collapsed. */
  selector: string;
  /** Enclosing at-rule preludes, outermost first ("@media (max-width: 600px)"). */
  atRules: string[];
  declarations: Declaration[];
};

export class CssReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CssReadError";
  }
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Splits on `separator` outside parentheses and quotes. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function parseDeclarations(body: string): Declaration[] {
  return splitTopLevel(body, ";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const colon = chunk.indexOf(":");
      if (colon === -1) {
        throw new CssReadError(`unreadable declaration "${collapse(chunk)}"`);
      }
      return {
        property: chunk.slice(0, colon).trim().toLowerCase(),
        value: collapse(chunk.slice(colon + 1).replace(/!important\s*$/i, "")),
      };
    });
}

/**
 * Every style rule in `css`, including those nested in @media, @supports and
 * other block at-rules. Comments are stripped. Blocks of declarations under an
 * at-rule (@font-face, @theme) carry no selector and are skipped. Native CSS
 * nesting is not supported and throws CssReadError, so it cannot hide a rule.
 */
export function extractRules(css: string): CssRule[] {
  return scan(css).rules;
}

/**
 * Every at-rule prelude in `css` in document order: block at-rules
 * ("@media (max-width: 600px)", "@font-face") and statement at-rules
 * ("@import url(x.css)"), nested ones included.
 */
export function extractAtRules(css: string): string[] {
  return scan(css).atRules;
}

function scan(css: string): { rules: CssRule[]; atRules: string[] } {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const found: string[] = [];

  // Returns the index just past the block's closing brace.
  const readBlock = (from: number, atRules: string[]): number => {
    let prelude = "";
    let quote: string | null = null;
    let i = from;
    while (i < src.length) {
      const ch = src[i];
      if (quote) {
        if (ch === "\\") {
          prelude += ch + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
        prelude += ch;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        prelude += ch;
        i++;
        continue;
      }
      if (ch === "{") {
        const head = collapse(prelude);
        prelude = "";
        if (head.startsWith("@")) {
          found.push(head);
          i = readBlock(i + 1, [...atRules, head]);
          continue;
        }
        const close = findClose(i);
        const body = src.slice(i + 1, close);
        if (body.includes("{")) {
          throw new CssReadError(
            `nested rule inside "${head}" is not supported`,
          );
        }
        rules.push({
          selector: head,
          atRules,
          declarations: parseDeclarations(body),
        });
        i = close + 1;
        continue;
      }
      if (ch === "}") return i + 1;
      if (ch === ";") {
        // A statement at-rule (@import …;) or a declaration in an at-rule body.
        const head = collapse(prelude);
        if (head.startsWith("@")) found.push(head);
        prelude = "";
        i++;
        continue;
      }
      prelude += ch;
      i++;
    }
    const tail = collapse(prelude);
    if (tail.startsWith("@")) found.push(tail);
    return i;
  };

  // The matching close brace for the open brace at `open`, quote-aware.
  const findClose = (open: number): number => {
    let quote: string | null = null;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return i;
    }
    throw new CssReadError("unbalanced braces");
  };

  readBlock(0, []);
  return { rules, atRules: found };
}

/** The selectors of every rule in `css`, split on top-level commas. */
export function selectorsOf(css: string): string[] {
  return extractRules(css).flatMap((rule) =>
    splitTopLevel(rule.selector, ",").map(collapse).filter(Boolean),
  );
}

/** Custom properties declared on `:root` in `tokensCss`. */
export function parseTokens(tokensCss: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const rule of extractRules(tokensCss)) {
    if (rule.atRules.length || collapse(rule.selector) !== ":root") continue;
    for (const { property, value } of rule.declarations) {
      if (property.startsWith("--")) tokens.set(property, value);
    }
  }
  return tokens;
}

/** Every var() referenced directly in `value`: its name, and whether it has a fallback. */
export function directVars(
  value: string,
): { name: string; fallback: boolean }[] {
  return [...value.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)].map((m) => ({
    name: m[1],
    fallback: m[2] === ",",
  }));
}

export type Resolved = { value: string; unresolved: string[] };

/**
 * Replaces every var(--x[, fallback]) in `value` with its token value,
 * recursively. Names neither defined nor given a fallback are reported in
 * `unresolved` and left in place; a reference cycle reports its name.
 */
export function resolveVars(
  value: string,
  tokens: ReadonlyMap<string, string>,
  seen: readonly string[] = [],
): Resolved {
  const unresolved: string[] = [];
  let out = "";
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf("var(", i);
    if (at === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at);
    let depth = 0;
    let end = at + 3;
    for (; end < value.length; end++) {
      if (value[end] === "(") depth++;
      else if (value[end] === ")" && --depth === 0) break;
    }
    const inner = value.slice(at + 4, end);
    const [rawName, ...rest] = splitTopLevel(inner, ",");
    const name = rawName.trim();
    const fallback = rest.length ? rest.join(",").trim() : undefined;
    let replacement: string | undefined;
    if (seen.includes(name)) {
      unresolved.push(name);
    } else if (tokens.has(name)) {
      const nested = resolveVars(tokens.get(name)!, tokens, [...seen, name]);
      unresolved.push(...nested.unresolved);
      replacement = nested.value;
    } else if (fallback !== undefined) {
      const nested = resolveVars(fallback, tokens, seen);
      unresolved.push(...nested.unresolved);
      replacement = nested.value;
    } else {
      unresolved.push(name);
    }
    out += replacement ?? value.slice(at, end + 1);
    i = end + 1;
  }
  return { value: collapse(out), unresolved };
}

export type Rgba = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, Rgba> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
};

/** Hex, rgb()/rgba() (comma or space syntax) and a few keywords; else null. */
export function parseColor(raw: string): Rgba | null {
  const v = raw.trim().toLowerCase();
  if (v in NAMED) return { ...NAMED[v] };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = (k: number) => parseInt(h.slice(k, k + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\((.*)\)$/.exec(v);
  if (!fn) return null;
  const [channels, alphaPart] = fn[1].includes("/")
    ? fn[1].split("/")
    : [fn[1], undefined];
  const parts = channels
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  let alpha = alphaPart;
  if (parts.length === 4 && alpha === undefined) alpha = parts.pop();
  if (parts.length !== 3) return null;
  const channel = (p: string) =>
    p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p);
  const [r, g, b] = parts.map(channel);
  const a =
    alpha === undefined
      ? 1
      : alpha.trim().endsWith("%")
        ? parseFloat(alpha) / 100
        : parseFloat(alpha);
  if ([r, g, b, a].some((x) => !Number.isFinite(x))) return null;
  return { r, g, b, a: Math.min(1, Math.max(0, a)) };
}

/** `fg` painted over an opaque `bg`. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const mix = (f: number, b: number) => f * fg.a + b * (1 - fg.a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

/** WCAG 2.x relative luminance. */
export function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio between two opaque colours. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const LENGTH = /^(-?\d*\.?\d+)(px|rem|em)$/;
const toPx = (n: number, unit: string) => (unit === "px" ? n : n * 16);

/** A px, rem or em length (rem and em at 16px), or a bare 0, in px; else null. */
export function lengthPx(token: string): number | null {
  if (/^-?0*\.?0+$/.test(token)) return 0;
  const m = LENGTH.exec(token);
  return m ? toPx(parseFloat(m[1]), m[2]) : null;
}

/**
 * The font size in px from a resolved `font-size` or `font` value: px, or
 * rem/em at 16px. Null when no size can be read (a keyword, a percentage,
 * an unresolved var()).
 */
export function fontSizePx(property: string, resolved: string): number | null {
  const tokens =
    property === "font"
      ? resolved.split(" ").map((t) => t.split("/")[0])
      : [resolved];
  for (const token of tokens) {
    const m = LENGTH.exec(token);
    if (m) return toPx(parseFloat(m[1]), m[2]);
  }
  return null;
}

/** The line height after the size in a resolved `font` shorthand ("400 12px/1.3 …" gives "1.3"). */
function fontLineHeight(resolved: string): string | null {
  const m = /(?:^|\s)-?[\d.]+(?:px|rem|em)\s*\/\s*([^\s,]+)/.exec(resolved);
  return m ? m[1] : null;
}

/** The space-separated parts of a value, keeping rgba(…) and the like whole. */
const words = (value: string) =>
  splitTopLevel(collapse(value), " ").filter(Boolean);

// Bounds for the allowlisted properties (ADV.1). Spacing tops out at the
// largest spacing token, --mox-space-16.
const MAX_SPACING_PX = 64;
const MAX_STROKE_PX = 4;
const MAX_OFFSET_PX = 8;
const MIN_MAX_WIDTH_PX = 320;

type Problem = string | null;

/** Every part is `auto` (when allowed) or a length from 0 to `max` px. */
function lengthsProblem(value: string, max: number, auto = false): Problem {
  for (const part of words(value)) {
    if (auto && part === "auto") continue;
    const px = lengthPx(part);
    if (px === null)
      return `has "${part}", which is not a px, rem or em length`;
    if (px < 0 || px > max) return `has ${part}, outside 0px to ${max}px`;
  }
  return null;
}

const STROKE_STYLES = [
  "none",
  "hidden",
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
];
const BORDER_KEYWORDS = new Set([
  ...STROKE_STYLES,
  "thin",
  "medium",
  "currentcolor",
]);
const OUTLINE_KEYWORDS = new Set([...BORDER_KEYWORDS, "auto"]);
const DECORATION_KEYWORDS = new Set([
  "none",
  "underline",
  "overline",
  "line-through",
  "solid",
  "double",
  "dotted",
  "dashed",
  "wavy",
  "auto",
  "from-font",
  "currentcolor",
]);

/** Border, outline and underline values: keywords, colours, and lengths no thicker than `max` px. */
function strokeProblem(
  value: string,
  keywords: ReadonlySet<string>,
  max: number,
): Problem {
  for (const part of words(value)) {
    if (keywords.has(part) || parseColor(part)) continue;
    const px = lengthPx(part);
    if (px === null)
      return `has "${part}", which is not a keyword, colour or length`;
    if (px < 0 || px > max) return `has ${part}, outside 0px to ${max}px`;
  }
  return null;
}

function lineHeightProblem(value: string, minFontPx: number): Problem {
  if (value === "normal") return null;
  if (/^\d*\.?\d+$/.test(value)) {
    return parseFloat(value) >= 1
      ? null
      : `line height ${value} is below 1, so the lines overlap`;
  }
  if (/^\d*\.?\d+%$/.test(value)) {
    return parseFloat(value) >= 100
      ? null
      : `line height ${value} is below 100%, so the lines overlap`;
  }
  const px = lengthPx(value);
  if (px === null) return `line height ${value} is not readable`;
  return px >= minFontPx
    ? null
    : `line height ${value} is below ${minFontPx}px, so the lines overlap`;
}

const MARGIN =
  /^margin(?:-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?$/;
const PADDING =
  /^padding(?:-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?$/;
const BORDER_TOP = /^border-top(?:-(?:width|style|color))?$/;
const TEXT_DECORATION = /^text-decoration(?:-(?:line|style|color|thickness))?$/;
const OUTLINE = /^outline(?:-(?:width|style|color))?$/;
const TEXT_ALIGN = new Set([
  "left",
  "right",
  "center",
  "justify",
  "start",
  "end",
]);
const TYPE_TOKEN = /^var\(\s*--ts-[\w-]+\s*\)$/;

/** Properties a state rule may set: colour, underline and outline only. */
const STATE_ALLOWED = /^(color|text-decoration(-[a-z-]+)?|outline(-[a-z-]+)?)$/;
/** Selectors that apply only on interaction (ADV.1). */
const STATE_SELECTOR = /:(?:hover|focus|active|target|visited|has)\b/i;
/** Media queries that apply only on hover-capable devices (ADV.1). */
const HOVER_MEDIA = /\(\s*(?:any-)?hover\b/i;
/** A compound that names one of the footer's own classes. */
const FOOTER_CLASS = /\.mm-site-footer(?:-line|-link)?(?![\w-])/;

export type FooterCssOptions = {
  /** The token the footer is painted over. */
  ground?: string;
  minContrast?: number;
  minFontPx?: number;
  /** Selectors that must set a colour in a plain (non-state, non-@media) rule. */
  requireColorFor?: string[];
  /** The selector whose plain rule must lift the footer above the grain overlays (ADV.3). */
  liftSelector?: string;
};

/**
 * Every way `css` could hide, shrink, clip, move or wash out the footer, as
 * findings (empty means pass). An allowlist (ADV.1): a property not listed
 * below is a finding wherever it appears, and each listed one has bounds.
 *
 * - position: relative only; z-index: an integer of 1 or more (above the
 *   grain overlays at z-index 0), and a plain `liftSelector` rule sets both.
 * - max-width: none or at least 320px.
 * - margin and padding (and longhands): auto (margin only) or 0 to 64px.
 * - border-top (and longhands), outline (and longhands) and text-decoration
 *   (and longhands): keywords, colours and lengths up to 4px;
 *   outline-offset and text-underline-offset 0 to 8px.
 * - font: a var(--ts-*) type token only, at least 11px, line height at
 *   least 1; font-size at least 11px; line-height at least 1.
 * - color: at least 4.5:1 against the ground; text-align: a keyword.
 *
 * Selectors stay inside the footer: every compound names an mm-site-footer
 * class. A state rule (:hover, :focus*, :active, :target, :visited, :has(),
 * or inside a hover media query) may set colour, underline and outline only.
 * The only at-rule allowed is @media.
 */
export function checkFooterCss(
  css: string,
  tokensCss: string,
  {
    ground = "--mox-onyx",
    minContrast = 4.5,
    minFontPx = 11,
    requireColorFor = [".mm-site-footer", ".mm-site-footer-link"],
    liftSelector = ".mm-site-footer",
  }: FooterCssOptions = {},
): string[] {
  const findings: string[] = [];
  let rules: CssRule[];
  let atRules: string[];
  try {
    ({ rules, atRules } = scan(css));
  } catch (error) {
    return [`unreadable CSS: ${(error as Error).message}`];
  }
  const tokens = parseTokens(tokensCss);
  const groundColor = parseColor(resolveVars(`var(${ground})`, tokens).value);
  if (!groundColor || groundColor.a !== 1) {
    return [`ground ${ground} does not resolve to an opaque colour`];
  }

  for (const at of atRules) {
    if (!/^@media\b/i.test(at)) {
      findings.push(`${at}: only @media at-rules may appear in the footer CSS`);
    }
  }

  const problemOf = (property: string, raw: string, v: string): Problem => {
    if (property === "position") {
      return v === "relative"
        ? null
        : "keeps the footer out of normal flow or below the overlays: it stays in normal flow, lifted with position: relative (S2.2d5)";
    }
    if (property === "z-index") {
      return /^\d+$/.test(v) && parseInt(v, 10) >= 1
        ? null
        : "is not an integer of 1 or more, so the grain overlays (z-index 0) can paint over the footer";
    }
    if (property === "max-width") {
      if (v === "none") return null;
      const px = lengthPx(v);
      return px !== null && px >= MIN_MAX_WIDTH_PX
        ? null
        : `squeezes the footer below ${MIN_MAX_WIDTH_PX}px (or is not a length)`;
    }
    if (MARGIN.test(property)) return lengthsProblem(v, MAX_SPACING_PX, true);
    if (PADDING.test(property)) return lengthsProblem(v, MAX_SPACING_PX);
    if (BORDER_TOP.test(property)) {
      return strokeProblem(v, BORDER_KEYWORDS, MAX_STROKE_PX);
    }
    if (OUTLINE.test(property)) {
      return strokeProblem(v, OUTLINE_KEYWORDS, MAX_STROKE_PX);
    }
    if (TEXT_DECORATION.test(property)) {
      return strokeProblem(v, DECORATION_KEYWORDS, MAX_STROKE_PX);
    }
    if (property === "outline-offset") {
      return lengthsProblem(v, MAX_OFFSET_PX);
    }
    if (property === "text-underline-offset") {
      return v === "auto" ? null : lengthsProblem(v, MAX_OFFSET_PX);
    }
    if (property === "text-align") {
      return TEXT_ALIGN.has(v) ? null : "is not a text-align keyword";
    }
    if (property === "line-height") return lineHeightProblem(v, minFontPx);
    if (property === "font" || property === "font-size") {
      if (property === "font" && !TYPE_TOKEN.test(raw.trim())) {
        return "sets the font only through a var(--ts-*) type token";
      }
      const px = fontSizePx(property, v);
      if (px === null) return "has no readable font size";
      if (px < minFontPx) return `is ${px}px, below ${minFontPx}px`;
      const lineHeight = property === "font" ? fontLineHeight(v) : null;
      return lineHeight === null
        ? null
        : lineHeightProblem(lineHeight, minFontPx);
    }
    return "is not on the footer's property allowlist";
  };

  for (const rule of rules) {
    const where =
      rule.selector +
      (rule.atRules.length ? ` (in ${rule.atRules.join(" ")})` : "");
    const flag = (message: string) => findings.push(`${where}: ${message}`);
    const isState =
      STATE_SELECTOR.test(rule.selector) ||
      rule.atRules.some((at) => HOVER_MEDIA.test(at));

    for (const part of splitTopLevel(rule.selector, ",")
      .map(collapse)
      .filter(Boolean)) {
      let compounds: Compound[];
      try {
        compounds = parseSelector(part).compounds;
      } catch (error) {
        flag(`unreadable selector: ${(error as Error).message}`);
        continue;
      }
      if (compounds.some((c) => !FOOTER_CLASS.test(c.text))) {
        flag(
          `selector "${part}" reaches outside the footer (every compound names an mm-site-footer class)`,
        );
      }
    }

    for (const { property, value } of rule.declarations) {
      const decl = `${property}: ${value}`;
      for (const { name, fallback } of directVars(value)) {
        if (!fallback && !tokens.has(name)) {
          flag(`${decl} names ${name}, which tokens.css does not define`);
        }
      }
      if (isState && !STATE_ALLOWED.test(property)) {
        flag(
          `${decl} in a state rule (:hover, :focus, :active, :target, :has() or a hover media query); only colour, underline and outline may change`,
        );
      }
      const { value: resolved, unresolved } = resolveVars(value, tokens);
      const v = resolved.toLowerCase();

      if (property === "color") {
        const parsed = unresolved.length ? null : parseColor(v);
        if (!parsed) {
          flag(
            `${decl} does not resolve to a colour (${unresolved.join(", ") || v})`,
          );
          continue;
        }
        const ratio = contrastRatio(
          composite(parsed, groundColor),
          groundColor,
        );
        if (ratio < minContrast) {
          flag(
            `${decl} contrast ${ratio.toFixed(2)}:1 against ${ground} is below ${minContrast}:1`,
          );
        }
        continue;
      }
      const problem = problemOf(property, value, v);
      if (problem) flag(`${decl} ${problem}`);
    }
  }

  const plainRulesFor = (selector: string) =>
    rules.filter(
      (rule) =>
        !rule.atRules.length &&
        splitTopLevel(rule.selector, ",").map(collapse).includes(selector),
    );

  const lifted = plainRulesFor(liftSelector).some(
    (rule) =>
      rule.declarations.some(
        (d) =>
          d.property === "position" && d.value.toLowerCase() === "relative",
      ) &&
      rule.declarations.some(
        (d) =>
          d.property === "z-index" &&
          /^\d+$/.test(d.value) &&
          parseInt(d.value, 10) >= 1,
      ),
  );
  if (!lifted) {
    findings.push(
      `${liftSelector}: no plain rule sets position: relative and a z-index of 1 or more, so the grain overlays (z-index 0) can paint over it`,
    );
  }

  for (const selector of requireColorFor) {
    const sets = plainRulesFor(selector).some((rule) =>
      rule.declarations.some((d) => d.property === "color"),
    );
    if (!sets)
      findings.push(`${selector}: no colour set, so its contrast is unchecked`);
  }
  return findings;
}

// ── Selectors and the footer's place in the document (ADV.2) ──────────────

export type Compound = {
  /** The compound as written. */
  text: string;
  /** Lower-case type selector, "*", or null. */
  tag: string | null;
  classes: string[];
  ids: string[];
  /** The contents of each [...] attribute selector. */
  attrs: string[];
  /** Pseudo-class names, with their arguments ("not(.x)"). */
  pseudoClasses: string[];
  pseudoElements: string[];
};
export type Combinator = " " | ">" | "+" | "~";
export type ComplexSelector = {
  compounds: Compound[];
  /** combinators[i] joins compounds[i] and compounds[i + 1]. */
  combinators: Combinator[];
};

const IDENT = /^(?:[\w-]|\\[\s\S]|[^\x00-\x7f])+/;
const LEGACY_PSEUDO_ELEMENTS = new Set([
  "before",
  "after",
  "first-line",
  "first-letter",
]);

function parseCompound(text: string): Compound {
  const c: Compound = {
    text,
    tag: null,
    classes: [],
    ids: [],
    attrs: [],
    pseudoClasses: [],
    pseudoElements: [],
  };
  let i = 0;
  const unreadable = () =>
    new CssReadError(`unreadable selector compound "${text}"`);
  const ident = (): string => {
    const m = IDENT.exec(text.slice(i));
    if (!m) throw unreadable();
    i += m[0].length;
    return m[0].replace(/\\([\s\S])/g, "$1");
  };
  // A balanced (...) or [...] group starting at i, quote-aware; its contents.
  const group = (open: string, close: string): string => {
    const start = i;
    let depth = 0;
    let quote: string | null = null;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        i++;
        return text.slice(start + 1, i - 1);
      }
    }
    throw unreadable();
  };

  if (text[i] === "*") {
    c.tag = "*";
    i++;
  } else if (IDENT.test(text)) {
    c.tag = ident().toLowerCase();
  }
  if (text[i] === "|") {
    i++;
    if (text[i] === "*") {
      c.tag = "*";
      i++;
    } else c.tag = ident().toLowerCase();
  }
  while (i < text.length) {
    const ch = text[i];
    if (ch === ".") {
      i++;
      c.classes.push(ident());
    } else if (ch === "#") {
      i++;
      c.ids.push(ident());
    } else if (ch === "[") {
      c.attrs.push(group("[", "]").trim());
    } else if (ch === ":") {
      const element = text[i + 1] === ":";
      i += element ? 2 : 1;
      const name = ident().toLowerCase();
      const arg = text[i] === "(" ? group("(", ")") : null;
      if (element || LEGACY_PSEUDO_ELEMENTS.has(name)) {
        c.pseudoElements.push(name);
      } else c.pseudoClasses.push(arg === null ? name : `${name}(${arg})`);
    } else if (ch === "&") {
      throw new CssReadError(
        `nesting selector "&" in "${text}" is not supported`,
      );
    } else throw unreadable();
  }
  return c;
}

/** One complex selector (no top-level commas) as compounds and combinators. */
export function parseSelector(selector: string): ComplexSelector {
  const s = collapse(selector);
  const parts: string[] = [];
  const combinators: Combinator[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;
  let pending: Combinator | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      current += ch;
      if (ch === "\\") current += s[++i] ?? "";
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (
      depth === 0 &&
      (ch === " " || ch === ">" || ch === "+" || ch === "~")
    ) {
      if (current) {
        parts.push(current);
        current = "";
        pending = " ";
      } else if (!parts.length) {
        throw new CssReadError(`selector "${s}" starts with a combinator`);
      }
      if (ch !== " ") pending = ch;
      continue;
    }
    if (pending) {
      combinators.push(pending);
      pending = null;
    }
    current += ch;
  }
  if (current) parts.push(current);
  else if (pending && pending !== " ") {
    throw new CssReadError(`selector "${s}" ends with a combinator`);
  }
  if (!parts.length) throw new CssReadError("empty selector");
  return { compounds: parts.map(parseCompound), combinators };
}

export type ModelElement = {
  name: string;
  tag: string;
  classes: readonly string[];
  /** Attribute names the element carries. */
  attrs: readonly string[];
  parent: ModelElement | null;
  /** Preceding element siblings, or "any" where page content precedes it. */
  prev: readonly ModelElement[] | "any";
};

const HTML: ModelElement = {
  name: "html",
  tag: "html",
  // Its one class is next/font's generated variable class, which authored
  // CSS cannot name; a [class] attribute selector still reaches it.
  classes: [],
  attrs: ["lang", "class"],
  parent: null,
  prev: [],
};
const HEAD: ModelElement = {
  name: "head",
  tag: "head",
  classes: [],
  attrs: [],
  parent: HTML,
  prev: [],
};
const BODY: ModelElement = {
  name: "body",
  tag: "body",
  classes: [],
  attrs: [],
  parent: HTML,
  prev: [HEAD],
};
const FOOTER: ModelElement = {
  name: "footer",
  tag: "footer",
  classes: ["mm-site-footer"],
  attrs: ["class"],
  parent: BODY,
  prev: "any",
};
const line = (n: number, prev: ModelElement[]): ModelElement => ({
  name: `line ${n}`,
  tag: "p",
  classes: ["mm-site-footer-line"],
  attrs: ["class"],
  parent: FOOTER,
  prev,
});
const LINE_1 = line(1, []);
const LINE_2 = line(2, [LINE_1]);
const LINE_3 = line(3, [LINE_1, LINE_2]);
const LINK: ModelElement = {
  name: "link",
  tag: "a",
  classes: ["mm-site-footer-link"],
  attrs: ["class", "href"],
  parent: LINE_1,
  prev: [],
};

/**
 * The footer's path in every document RootLayout renders: html > head +
 * body > footer > three p lines, the first holding the link. What precedes
 * the footer in body is page content, so its siblings are "any".
 * layout.test.tsx pins this model against the rendered layout.
 */
export const FOOTER_PATH = {
  html: HTML,
  body: BODY,
  footer: FOOTER,
  lines: [LINE_1, LINE_2, LINE_3],
  link: LINK,
} as const;
const ANCESTORS = [HTML, BODY];
const FOOTER_SUBTREE = [FOOTER, LINE_1, LINE_2, LINE_3, LINK];

const PSEUDO_ONLY: Record<string, readonly string[]> = {
  root: ["html"],
  link: ["a"],
  "any-link": ["a"],
  visited: ["a"],
};
const attrName = (attr: string) =>
  attr
    .split(/[~|^$*]?=/)[0]
    .trim()
    .replace(/^(?:[\w-]*|\*)\|/, "")
    .toLowerCase();

/**
 * Whether `c` can match `e`. Type, class, id, attribute names and :root or
 * :link-like pseudo-classes are checked; every other pseudo-class (:not,
 * :is, :last-child, :hover …) is assumed to match, so the answer errs
 * towards "reaches".
 */
function compoundMatches(c: Compound, e: ModelElement): boolean {
  if (c.tag && c.tag !== "*" && c.tag !== e.tag) return false;
  if (!c.classes.every((k) => e.classes.includes(k))) return false;
  if (c.ids.length) return false; // nothing on the footer's path has an id
  if (!c.attrs.every((a) => e.attrs.includes(attrName(a)))) return false;
  for (const pseudo of c.pseudoClasses) {
    const name = pseudo.split("(")[0];
    const only = Object.hasOwn(PSEUDO_ONLY, name) ? PSEUDO_ONLY[name] : null;
    if (only && !only.includes(e.tag)) return false;
  }
  return true;
}

function matchesAt(
  sel: ComplexSelector,
  index: number,
  e: ModelElement,
): boolean {
  if (!compoundMatches(sel.compounds[index], e)) return false;
  if (index === 0) return true;
  const next = (other: ModelElement) => matchesAt(sel, index - 1, other);
  switch (sel.combinators[index - 1]) {
    case ">":
      return e.parent !== null && next(e.parent);
    case " ":
      for (let a = e.parent; a; a = a.parent) if (next(a)) return true;
      return false;
    case "+":
      return e.prev === "any" || (e.prev.length > 0 && next(e.prev.at(-1)!));
    case "~":
      return e.prev === "any" || e.prev.some(next);
  }
}

/** The elements on the footer's path (FOOTER_PATH) that `selector` can match. */
export function elementsReached(selector: string): ModelElement[] {
  const reached = new Set<ModelElement>();
  for (const part of splitTopLevel(selector, ",")
    .map(collapse)
    .filter(Boolean)) {
    const sel = parseSelector(part);
    for (const e of [...ANCESTORS, ...FOOTER_SUBTREE]) {
      if (matchesAt(sel, sel.compounds.length - 1, e)) reached.add(e);
    }
  }
  return [...reached];
}

/** A selector that names the footer element, the site footer or the contentinfo role. */
export const FOOTER_SELECTOR =
  /(?:^|[\s>+~,(])footer(?![\w-])|mm-site-footer|contentinfo/i;

/** What an html or body rule may set: nothing that inherits into, clips or moves the footer. */
const ANCESTOR_ALLOWED =
  /^(color|font-family|-webkit-font-smoothing|-moz-osx-font-smoothing|text-rendering)$/;

export type OutsideCssOptions = {
  /** The token the footer's contrast is checked against (checkFooterCss). */
  ground?: string;
  /** True for tokens.css: its plain :root rule may define custom properties. */
  rootTokens?: boolean;
};

/**
 * ADV.2: findings for a stylesheet other than site-footer.css. No rule may
 * name the footer or match the footer, its lines or its link (AC-8: the
 * footer's styles live with the component). Rules that match html or body
 * may set only colour, font family and smoothing, which the footer overrides
 * or which cannot hide it; the ground stays `ground`; custom properties live
 * only in tokens.css's plain :root rule. @keyframes steps are skipped.
 */
export function checkCssOutsideFooter(
  css: string,
  tokensCss: string,
  { ground = "--mox-onyx", rootTokens = false }: OutsideCssOptions = {},
): string[] {
  const findings: string[] = [];
  let rules: CssRule[];
  try {
    rules = extractRules(css);
  } catch (error) {
    return [`unreadable CSS: ${(error as Error).message}`];
  }
  const tokens = parseTokens(tokensCss);
  const groundColor = parseColor(resolveVars(`var(${ground})`, tokens).value);
  const isGround = (value: string) => {
    const c = parseColor(resolveVars(value, tokens).value);
    return (
      !!c &&
      !!groundColor &&
      c.a === 1 &&
      c.r === groundColor.r &&
      c.g === groundColor.g &&
      c.b === groundColor.b
    );
  };

  for (const rule of rules) {
    if (rule.atRules.some((at) => /^@(?:-webkit-)?keyframes\b/i.test(at))) {
      continue;
    }
    const inAt = rule.atRules.length ? ` (in ${rule.atRules.join(" ")})` : "";
    for (const part of splitTopLevel(rule.selector, ",")
      .map(collapse)
      .filter(Boolean)) {
      const flag = (message: string) =>
        findings.push(`${part}${inAt}: ${message}`);
      if (FOOTER_SELECTOR.test(part)) {
        flag(
          "names the footer, whose styles live only in site-footer.css (AC-8)",
        );
        continue;
      }
      let reached: ModelElement[];
      try {
        reached = elementsReached(part);
      } catch (error) {
        flag(`unreadable selector: ${(error as Error).message}`);
        continue;
      }
      const inFooter = reached.filter((e) => FOOTER_SUBTREE.includes(e));
      if (inFooter.length) {
        flag(
          `can match the footer's ${inFooter.map((e) => e.name).join(", ")}, whose styles live only in site-footer.css (AC-8)`,
        );
        continue;
      }
      if (!reached.length) continue;
      const above = reached.map((e) => e.name).join(" and ");
      for (const { property, value } of rule.declarations) {
        const decl = `${property}: ${value}`;
        if (property.startsWith("--")) {
          if (!(rootTokens && !rule.atRules.length && part === ":root")) {
            flag(
              `${decl} on ${above} redefines a token above the footer (tokens live in tokens.css :root only)`,
            );
          }
        } else if (
          property === "background" ||
          property === "background-color"
        ) {
          if (!isGround(value)) {
            flag(
              `${decl} on ${above}: the footer's contrast is checked against ${ground}, so the ground stays ${ground}`,
            );
          }
        } else if (!ANCESTOR_ALLOWED.test(property)) {
          flag(
            `${decl} on ${above} can hide, clip or move the footer through inheritance or layout`,
          );
        }
      }
    }
  }
  return findings;
}
