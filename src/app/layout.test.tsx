// T8 (AC-1) and T9 (AC-1, AC-5, AC-6): RootLayout renders SiteFooter inside
// <body>, and the real routes rendered inside RootLayout carry exactly one
// footer whose lines equal the spec. RootLayout renders <html>, so these use
// renderToStaticMarkup and DOMParser instead of RTL's render (S2.2d7, S2.2d8).
import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  FOOTER_HEADING,
  readSpec,
  readSpecBlockquotes,
} from "../../tests/helpers/attribution-spec";
import EvaluatePage from "./evaluate/page";
import RootLayout from "./layout";
import LandingPage from "./page";

vi.mock("next/font/local", () => ({
  default: () => ({
    variable: "font-inter",
    className: "font-inter",
    style: {},
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const footerQuotes = readSpecBlockquotes(readSpec(), FOOTER_HEADING);

/** RootLayout around `children`, rendered to HTML and parsed as a document. */
function renderInLayout(children: React.ReactNode) {
  const html = renderToStaticMarkup(<RootLayout>{children}</RootLayout>);
  return { html, doc: new DOMParser().parseFromString(html, "text/html") };
}

function footerLines(doc: Document): (string | null)[] {
  return [...doc.querySelectorAll("footer.mm-site-footer > p")].map(
    (p) => p.textContent,
  );
}

describe("RootLayout renders SiteFooter (T8)", () => {
  const { doc } = renderInLayout(<main data-testid="child">x</main>);

  test("exactly one site footer", () => {
    expect(doc.querySelectorAll("footer.mm-site-footer")).toHaveLength(1);
    expect(doc.querySelectorAll("footer")).toHaveLength(1);
  });

  test("it is the last element child of body, after the page content", () => {
    const footer = doc.querySelector("footer.mm-site-footer");
    expect(footer?.parentElement).toBe(doc.body);
    expect(doc.body.lastElementChild).toBe(footer);
    const child = doc.querySelector('[data-testid="child"]');
    expect(child?.parentElement).toBe(doc.body);
    expect(child?.nextElementSibling).toBe(footer);
  });

  test("its three lines equal the spec", () => {
    expect(footerLines(doc)).toEqual(footerQuotes);
  });

  test("with no page content the footer still renders", () => {
    const empty = renderInLayout(null).doc;
    expect(footerLines(empty)).toEqual(footerQuotes);
  });
});

const FALSE_CLAIMS = /CardKingdom|CardMarket|Updated every 4 hours/i;

describe.each([
  ["/", <LandingPage key="landing" />],
  ["/evaluate", <EvaluatePage key="evaluate" />],
])("route %s inside RootLayout (T9)", (_route, page) => {
  const { html, doc } = renderInLayout(page);

  test("has exactly one footer element, the site footer", () => {
    expect(doc.querySelectorAll("footer")).toHaveLength(1);
    expect(doc.querySelectorAll(".mm-footer, .t-actions-foot")).toHaveLength(0);
    expect(doc.body.lastElementChild?.matches("footer.mm-site-footer")).toBe(
      true,
    );
  });

  test("its lines equal the spec", () => {
    expect(footerLines(doc)).toEqual(footerQuotes);
  });

  test("carries none of the false per-page footer claims", () => {
    expect(html).not.toMatch(FALSE_CLAIMS);
  });

  test("the footer is plain text: no details, dialog, button or hidden wrapper", () => {
    const footer = doc.querySelector("footer.mm-site-footer")!;
    expect(
      footer.querySelector(
        "details, summary, dialog, button, [hidden], [aria-hidden], [style]",
      ),
    ).toBeNull();
    expect(
      footer.closest("[hidden], [aria-hidden], details, dialog"),
    ).toBeNull();
  });
});
