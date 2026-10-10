// T12's component half (AC-6, AC-7, AC-10, AC-15; S2.4d9): the miss state
// under the result page's form. The message is the locked string, tied to
// the card field; resubmitting navigates through resultHref and sets the
// marker; a pending resubmit swaps the message for the skeleton and drops
// the tie; a later ok result shows no message.
import { EntryForm } from "@/components/entry-form";
import { ResultNavigationProvider } from "@/components/result-navigation";
import { LOADING_LABEL } from "@/lib/copy/result-labels";
import { submitMarkerKey } from "@/lib/entry-submit";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { resultHref } from "@/lib/result-href";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { extractRules } from "../../../tests/helpers/site-footer-css";
import { LookupMiss, ResultField, type LookupMissStatus } from "./lookup-miss";
import { ResultSlot } from "./result-slot";
import { ResultView } from "./result-view";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  router.push.mockReset();
  window.sessionStorage.clear();
});

/** The result page's shape: the shared transition, the field, form and slot. */
function Page({
  card,
  price,
  children,
}: {
  card: string;
  price: string;
  children: ReactNode;
}) {
  return (
    <ResultNavigationProvider>
      <ResultField>
        <EntryForm initialCard={card} initialPrice={price} />
        <ResultSlot>{children}</ResultSlot>
      </ResultField>
    </ResultNavigationProvider>
  );
}

const cardInput = () => screen.getByRole("combobox", { name: "Card" });
const priceInput = () => screen.getByRole("textbox", { name: "Your price" });
const send = () =>
  fireEvent.submit(
    screen.getByRole("button", { name: "Evaluate" }).closest("form")!,
  );

const CASES: [LookupMissStatus, string, string][] = [
  ["ambiguous", "jace", UI_COPY.ambiguousCard],
  ["not_found", "asdfqwer", UI_COPY.cardNotFound],
];

describe("the miss state (T12, AC-6, AC-7)", () => {
  test.each(CASES)(
    "%s: one message equal to its constant, tied to the card field; nothing else in the slot",
    (status, card, message) => {
      const { container } = render(
        <Page card={card} price="5">
          <ResultView evaluation={{ status }} />
        </Page>,
      );
      expect(cardInput()).toHaveValue(card);
      expect(priceInput()).toHaveValue("5");
      const text = screen.getByText(message);
      expect(text.textContent).toBe(message);
      expect(cardInput()).toHaveAttribute("aria-describedby", text.id);
      expect(cardInput()).toHaveAccessibleDescription(message);
      const slot = container.querySelector(".mm-result-slot")!;
      expect(slot.textContent).toBe(message);
      expect(slot.querySelector(`[data-status="${status}"]`)).not.toBeNull();
      for (const selector of [
        ".mm-rec-panel",
        ".mm-rec-tile",
        ".mm-rec-disclaimer",
        ".mm-skeleton",
        '[aria-busy="true"]',
        '[data-status="error"]',
        "button.mm-retry-btn",
      ]) {
        expect(container.querySelector(selector), selector).toBeNull();
      }
    },
  );

  test("the two statuses show different strings (a swap fails here)", () => {
    render(<LookupMiss status="ambiguous" />);
    expect(screen.getByText(UI_COPY.ambiguousCard)).toBeInTheDocument();
    expect(screen.queryByText(UI_COPY.cardNotFound)).toBeNull();
  });

  test("outside the page's field it renders the message as a plain paragraph, never a throw", () => {
    const { container } = render(<LookupMiss status="not_found" />);
    expect(container.textContent).toBe(UI_COPY.cardNotFound);
    expect(container.querySelector("p")?.id).toBe("");
  });

  test("the field wrapper adds no layout box (display: contents)", () => {
    const { container } = render(
      <ResultField>
        <span />
      </ResultField>,
    );
    expect(container.firstElementChild).toHaveClass("mm-result-field");
    const css = readFileSync(path.resolve(__dirname, "result.css"), "utf8");
    const declarations = extractRules(css)
      .filter((r) => r.selector === ".mm-result-field")
      .flatMap((r) => r.declarations);
    expect(declarations).toEqual([{ property: "display", value: "contents" }]);
  });
});

describe("resubmitting from the miss state (T12, AC-6, AC-15)", () => {
  test.each(CASES)(
    "%s: a new card pushes resultHref once and sets the marker first",
    (status, card) => {
      const order: string[] = [];
      router.push.mockImplementation((href: string) => {
        order.push(
          window.sessionStorage.getItem(submitMarkerKey(href)) === null
            ? "push without marker"
            : "push after marker",
        );
      });
      render(
        <Page card={card} price="5">
          <ResultView evaluation={{ status }} />
        </Page>,
      );
      fireEvent.change(cardInput(), {
        target: { value: "Jace, the Mind Sculptor" },
      });
      send();
      const href = resultHref("Jace, the Mind Sculptor", "5");
      expect(router.push).toHaveBeenCalledExactlyOnceWith(href);
      expect(order).toEqual(["push after marker"]);
    },
  );

  test("a pending resubmit shows the skeleton; the message and its tie are gone", async () => {
    router.push.mockImplementation(() => new Promise(() => {}));
    render(
      <Page card="jace" price="5">
        <ResultView evaluation={{ status: "ambiguous" }} />
      </Page>,
    );
    expect(cardInput()).toHaveAttribute("aria-describedby");
    fireEvent.change(cardInput(), { target: { value: "Jace Beleren" } });
    await act(async () => {
      send();
    });
    expect(
      screen.getByRole("status", { name: LOADING_LABEL }),
    ).toBeInTheDocument();
    expect(screen.queryByText(UI_COPY.ambiguousCard)).toBeNull();
    expect(cardInput()).not.toHaveAttribute("aria-describedby");
  });

  test("a later ok result renders no miss message and no tie", () => {
    const { rerender } = render(
      <Page card="jace" price="5">
        <ResultView evaluation={{ status: "ambiguous" }} />
      </Page>,
    );
    rerender(
      <Page card="jace" price="5">
        <p className="mm-rec-panel">panel</p>
      </Page>,
    );
    expect(screen.queryByText(UI_COPY.ambiguousCard)).toBeNull();
    expect(cardInput()).not.toHaveAttribute("aria-describedby");
  });
});
