// T10 (AC-2, AC-5): /sample, still serving until S2.4 retires it, rendered
// inside RootLayout carries exactly one footer whose lines equal the spec.
// S2.4 AC-12 replaces this file's assertions with the AC-11 redirect test in
// the PR that retires /sample (S2.2d9).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  FOOTER_HEADING,
  readSpec,
  readSpecBlockquotes,
} from "../../../tests/helpers/attribution-spec";
import RootLayout from "../layout";
import SamplePage from "./page";

vi.mock("next/font/local", () => ({
  default: () => ({
    variable: "font-inter",
    className: "font-inter",
    style: {},
  }),
}));

const footerQuotes = readSpecBlockquotes(readSpec(), FOOTER_HEADING);

describe("route /sample inside RootLayout (T10)", () => {
  const html = renderToStaticMarkup(
    <RootLayout>
      <SamplePage />
    </RootLayout>,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");

  test("has exactly one footer element, the site footer, last in body", () => {
    expect(doc.querySelectorAll("footer")).toHaveLength(1);
    expect(doc.body.lastElementChild?.matches("footer.mm-site-footer")).toBe(
      true,
    );
  });

  test("its lines equal the spec", () => {
    const lines = [...doc.querySelectorAll("footer.mm-site-footer > p")].map(
      (p) => p.textContent,
    );
    expect(lines).toEqual(footerQuotes);
  });

  test("the per-page t-actions-foot block is gone", () => {
    expect(doc.querySelectorAll(".t-actions-foot")).toHaveLength(0);
  });

  test("carries none of the false per-page footer claims", () => {
    expect(html).not.toMatch(/CardKingdom|CardMarket|Updated every 4 hours/i);
  });
});
