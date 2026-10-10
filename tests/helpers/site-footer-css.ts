// AC-6 and AC-8 support (S2.2d12): a small regex-and-scanner CSS reader, a
// resolver for var() chains defined in tokens.css :root, and the footer
// visibility, contrast and size checks. No CSS parser dependency. Anything the
// reader cannot understand fails the check instead of passing silently.

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
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];

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
        prelude = "";
        i++;
        continue;
      }
      prelude += ch;
      i++;
    }
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
  return rules;
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

const isZeroLength = (v: string) =>
  /^-?0*\.?0+(px|em|rem|%|vh|vw|ch)?$/.test(v);

/** Properties a :hover or :focus rule may set: colour, underline and outline only. */
const STATE_ALLOWED = /^(color|text-decoration(-[a-z-]+)?|outline(-[a-z-]+)?)$/;
const STATE_SELECTOR = /:(hover|focus)/;

export type FooterCssOptions = {
  /** The token the footer is painted over. */
  ground?: string;
  minContrast?: number;
  minFontPx?: number;
  /** Selectors that must set a colour in a plain (non-state, non-@media) rule. */
  requireColorFor?: string[];
};

/**
 * Every way `css` could hide, shrink or wash out the footer, as findings
 * (empty means pass). Applies to every rule, including those inside @media.
 */
export function checkFooterCss(
  css: string,
  tokensCss: string,
  {
    ground = "--mox-onyx",
    minContrast = 4.5,
    minFontPx = 11,
    requireColorFor = [".mm-site-footer", ".mm-site-footer-link"],
  }: FooterCssOptions = {},
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
  if (!groundColor || groundColor.a !== 1) {
    return [`ground ${ground} does not resolve to an opaque colour`];
  }

  for (const rule of rules) {
    const where =
      rule.selector +
      (rule.atRules.length ? ` (in ${rule.atRules.join(" ")})` : "");
    const flag = (message: string) => findings.push(`${where}: ${message}`);
    const isState = STATE_SELECTOR.test(rule.selector);

    for (const { property, value } of rule.declarations) {
      const decl = `${property}: ${value}`;
      for (const { name, fallback } of directVars(value)) {
        if (!fallback && !tokens.has(name)) {
          flag(`${decl} names ${name}, which tokens.css does not define`);
        }
      }
      if (isState && !STATE_ALLOWED.test(property)) {
        flag(
          `${decl} in a :hover/:focus rule (only colour, underline and outline may change)`,
        );
      }
      const { value: resolved, unresolved } = resolveVars(value, tokens);
      const v = resolved.toLowerCase();

      switch (property) {
        case "display":
          if (/\bnone\b/.test(v)) flag(`${decl} hides the footer`);
          break;
        case "visibility":
          if (v === "hidden" || v === "collapse")
            flag(`${decl} hides the footer`);
          break;
        case "content-visibility":
          if (v === "hidden") flag(`${decl} hides the footer`);
          break;
        case "opacity": {
          const n = v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
          if (!Number.isFinite(n) || n < 1)
            flag(`${decl} dims or hides the footer`);
          break;
        }
        case "height":
        case "max-height":
        case "width":
        case "max-width":
        case "line-height":
          if (isZeroLength(v)) flag(`${decl} collapses the footer`);
          break;
        case "clip":
        case "clip-path":
          if (v !== "auto" && v !== "none") flag(`${decl} clips the footer`);
          break;
        case "text-indent":
          if (v.startsWith("-")) flag(`${decl} pushes text out of view`);
          break;
        case "position":
          if (!["relative", "static"].includes(v)) {
            flag(`${decl}: the footer stays in normal flow (S2.2d5)`);
          }
          break;
        case "z-index":
          if (parseInt(v, 10) < 0)
            flag(`${decl} sinks the footer below the page`);
          break;
        case "transform":
        case "filter":
        case "mix-blend-mode":
          if (v !== "none" && v !== "normal")
            flag(`${decl} can hide or wash out the footer`);
          break;
        case "color": {
          const parsed = unresolved.length ? null : parseColor(v);
          if (!parsed) {
            flag(
              `${decl} does not resolve to a colour (${unresolved.join(", ") || v})`,
            );
            break;
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
          break;
        }
        case "font":
        case "font-size": {
          const px = fontSizePx(property, v);
          if (px === null) flag(`${decl} has no readable font size`);
          else if (px < minFontPx)
            flag(`${decl} is ${px}px, below ${minFontPx}px`);
          break;
        }
        default:
          if (property.startsWith("background")) {
            flag(
              `${decl}: contrast is checked against ${ground} only, so the footer sets no background`,
            );
          }
      }
    }
  }

  for (const selector of requireColorFor) {
    const sets = rules.some(
      (rule) =>
        !rule.atRules.length &&
        splitTopLevel(rule.selector, ",").map(collapse).includes(selector) &&
        rule.declarations.some((d) => d.property === "color"),
    );
    if (!sets)
      findings.push(`${selector}: no colour set, so its contrast is unchecked`);
  }
  return findings;
}
