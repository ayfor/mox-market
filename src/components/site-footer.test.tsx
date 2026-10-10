// T5 (AC-1), T6 (AC-4), T7 (AC-6): SiteFooter rendered with RTL, compared
// with the spec read at test time (footer heading only; the affiliate
// blockquote is never read).
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  DISCLAIMER_HEADING,
  FOOTER_HEADING,
  readSpec,
  readSpecBlockquotes,
  readSpecLinkTarget,
} from "../../tests/helpers/attribution-spec";
import { SiteFooter } from "./site-footer";

const spec = readSpec();
const footerQuotes = readSpecBlockquotes(spec, FOOTER_HEADING);
const [disclaimerQuote] = readSpecBlockquotes(spec, DISCLAIMER_HEADING);
const specHref = readSpecLinkTarget(spec, FOOTER_HEADING, "Fan Content Policy");

function renderFooter() {
  render(<SiteFooter />);
  return screen.getByRole("contentinfo");
}

describe("SiteFooter text (T5)", () => {
  test("renders one contentinfo landmark", () => {
    renderFooter();
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
  });

  test("its three lines, in order, equal the spec's footer blockquotes", () => {
    const footer = renderFooter();
    const lines = footer.querySelectorAll(":scope > p");
    expect(lines).toHaveLength(3);
    expect(footer.children).toHaveLength(3);
    lines.forEach((line, i) => {
      expect(line.textContent).toBe(footerQuotes[i]);
    });
  });

  test("the footer text is exactly the three lines, with nothing else in it", () => {
    const footer = renderFooter();
    expect(footer.textContent).toBe(footerQuotes.join(""));
  });

  test("the footer contains neither the disclaimer nor any affiliate wording", () => {
    const footer = renderFooter();
    expect(footer.textContent).not.toContain(disclaimerQuote);
    expect(footer.textContent).not.toMatch(/commission|paid link|affiliate/i);
  });
});

describe("Fan Content Policy link (T6)", () => {
  test("links to the spec URL", () => {
    renderFooter();
    const link = screen.getByRole("link", { name: "Fan Content Policy" });
    expect(link).toHaveAttribute("href", specHref);
  });

  test("is the only link in the footer and sits inside line 1", () => {
    const footer = renderFooter();
    const links = within(footer).getAllByRole("link");
    expect(links).toHaveLength(1);
    const [line1] = footer.querySelectorAll(":scope > p");
    expect(line1).toContainElement(links[0]);
  });

  test("opens in the same tab: no target, no rel", () => {
    renderFooter();
    const link = screen.getByRole("link", { name: "Fan Content Policy" });
    expect(link).not.toHaveAttribute("target");
    expect(link).not.toHaveAttribute("rel");
  });
});

describe("plain visible text (T7)", () => {
  const CONCEALING = [
    "details",
    "summary",
    "dialog",
    "button",
    "[hidden]",
    "[aria-hidden]",
    "[title]",
    "[popover]",
    "[role=tooltip]",
    "[role=dialog]",
    "[style]",
    "[inert]",
    "template",
    "noscript",
  ];

  test.each(CONCEALING)("the footer has no %s", (selector) => {
    const footer = renderFooter();
    expect(footer.matches(selector)).toBe(false);
    expect(footer.querySelector(selector)).toBeNull();
  });

  test("each line is visible", () => {
    const footer = renderFooter();
    for (const line of footer.querySelectorAll(":scope > p")) {
      expect(line).toBeVisible();
    }
  });

  test("site-footer.tsx is a server component with no interaction handlers", () => {
    const source = readFileSync(
      path.join(__dirname, "site-footer.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/["']use client["']/);
    for (const hook of [
      "useState",
      "useEffect",
      "onMouseEnter",
      "onMouseOver",
      "onFocus",
      "onClick",
      "onPointerEnter",
    ]) {
      expect(source).not.toContain(hook);
    }
  });
});
