// T19 (AC-14; C1.45 = B; S2.4d11): Evaluate is a link tab; Import and About
// are disabled "soon" tabs that are not links, take no focus and never
// navigate; the brand and the CTA keep their hrefs; every label comes from
// the copy modules.
import { NAV_LABELS } from "@/lib/copy/entry-points";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NavBar } from "./nav-bar";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/evaluate",
}));

beforeEach(() => {
  for (const fn of Object.values(router)) fn.mockReset();
});

const tablist = () => screen.getByRole("tablist");

describe("the nav tabs (T19, AC-14)", () => {
  test("three tabs: Evaluate a link to /evaluate, selected when active", () => {
    render(<NavBar active="evaluate" />);
    const tabs = within(tablist()).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    const evaluate = tabs[0];
    expect(evaluate.tagName).toBe("A");
    expect(evaluate).toHaveAttribute("href", "/evaluate");
    expect(evaluate).toHaveAttribute("aria-selected", "true");
    expect(evaluate).toHaveTextContent(NAV_LABELS.evaluate);
  });

  test.each([
    ["Import", NAV_LABELS.import],
    ["About", NAV_LABELS.about],
  ])(
    "%s: an aria-disabled soon tab, not a link, not focusable",
    (_name, label) => {
      render(<NavBar />);
      const tab = within(tablist())
        .getAllByRole("tab")
        .find((t) => t.textContent?.startsWith(label))!;
      expect(tab).toBeDefined();
      expect(tab.tagName).not.toBe("A");
      expect(tab).toHaveAttribute("aria-disabled", "true");
      expect(tab).toHaveAttribute("aria-selected", "false");
      expect(tab).not.toHaveAttribute("href");
      expect(tab).not.toHaveAttribute("tabindex");
      expect(tab.closest("a")).toBeNull();
      expect(tab.querySelector("a")).toBeNull();
      expect(tab.textContent).toBe(`${label}${UI_COPY.navSoon}`);
      expect(tab.querySelector(".mm-nav-soon")?.textContent).toBe(
        UI_COPY.navSoon,
      );
      tab.focus();
      expect(document.activeElement).not.toBe(tab);
      const before = window.location.href;
      fireEvent.click(tab);
      fireEvent.keyDown(tab, { key: "Enter" });
      fireEvent.click(tab.querySelector(".mm-nav-soon")!);
      expect(window.location.href).toBe(before);
      expect(router.push).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(router.prefetch).not.toHaveBeenCalled();
    },
  );

  test("no anchor in the nav points at /import or /about", () => {
    const { container } = render(<NavBar />);
    const hrefs = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(["/", "/evaluate", "/"]);
    expect(
      container.querySelector('[href="/import"], [href="/about"]'),
    ).toBeNull();
  });

  test("the brand and the CTA keep their hrefs and take their labels from NAV_LABELS", () => {
    render(<NavBar />);
    const brand = screen.getByRole("link", { name: NAV_LABELS.brandHome });
    expect(brand).toHaveAttribute("href", "/");
    expect(brand).toHaveTextContent(NAV_LABELS.brand);
    const cta = screen.getByRole("link", { name: NAV_LABELS.ctaName });
    expect(cta).toHaveAttribute("href", "/");
    expect(cta).toHaveTextContent(NAV_LABELS.cta);
  });
});
