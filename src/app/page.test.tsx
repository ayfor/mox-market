// T6 (AC-2, AC-10; S2.4d4, S2.4d5): the landing page renders LandingForm and
// takes every visible string from LANDING_COPY; it defines no title of its
// own, so the root layout's title.default applies, and its description is
// the copy module's.
import { LANDING_COPY } from "@/lib/copy/entry-points";
import { FORM_LABELS } from "@/lib/copy/result-labels";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { LandingForm } from "./landing-form";
import { metadata as layoutMetadata } from "./layout";
import LandingPage, { metadata } from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({
    variable: "font-inter",
    className: "font-inter",
    style: {},
  }),
}));

/** Every element in a tree of unrendered elements, depth first. */
function elementsIn(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elementsIn);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elementsIn(props.children)];
}

/** Text with each <br> read as a line break. */
const linesOf = (element: Element) =>
  [...element.childNodes]
    .map((node) => (node.nodeName === "BR" ? "\n" : node.textContent))
    .join("")
    .split("\n");

describe("the landing page (T6, AC-2, AC-10)", () => {
  test("renders LandingForm, and no element carries an action", () => {
    expect(elementsIn(LandingPage()).some((e) => e.type === LandingForm)).toBe(
      true,
    );
    const { container } = render(<LandingPage />);
    expect(container.querySelector("[action]")).toBeNull();
    expect(container.querySelectorAll("form")).toHaveLength(1);
  });

  test("every visible string is its LANDING_COPY constant", () => {
    const { container } = render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      LANDING_COPY.wordmarkTop,
    );
    expect(
      container.querySelector(".landing-wordmark.market")?.textContent,
    ).toBe(LANDING_COPY.wordmarkBottom);
    expect(container.querySelector(".landing-tagline")?.textContent).toBe(
      LANDING_COPY.tagline,
    );
    const question = container.querySelector(".landing-ruby-question")!;
    expect(linesOf(question)).toEqual(["Should", "you buy", "it?"]);
    expect(linesOf(question).join(" ")).toBe(LANDING_COPY.question);
    const prompt = container.querySelector(".landing-prompt")!;
    expect(linesOf(prompt)).toEqual([...LANDING_COPY.prompt]);
    expect(
      screen.getByRole("textbox", { name: FORM_LABELS.card }),
    ).toHaveAttribute("placeholder", LANDING_COPY.cardPlaceholder);
    expect(
      screen.getByRole("textbox", { name: FORM_LABELS.price }),
    ).toHaveAttribute("placeholder", LANDING_COPY.pricePlaceholder);
    expect(
      screen.getByRole("button", { name: FORM_LABELS.submit }),
    ).toBeDisabled();
    expect(screen.getByText(UI_COPY.submitHelper)).toBeInTheDocument();
    // The decorative glyphs stay; nothing else holds text.
    const known = [
      LANDING_COPY.wordmarkTop,
      LANDING_COPY.wordmarkBottom,
      LANDING_COPY.tagline,
      ["Should", "you buy", "it?"].join(""),
      LANDING_COPY.prompt.join(""),
      FORM_LABELS.submit,
      UI_COPY.submitHelper,
      "+",
      "◇",
      "+",
    ];
    let rest = container.textContent!;
    for (const text of known) rest = rest.replace(text, "");
    expect(rest.trim()).toBe("");
  });

  test("metadata: no title (the layout's default applies) and the copy module's description", () => {
    expect(metadata.title).toBeUndefined();
    expect(metadata.description).toBe(LANDING_COPY.description);
    const title = layoutMetadata.title as { default: string };
    expect(title.default).toBe("Mox Market — Should you buy it?");
  });
});
