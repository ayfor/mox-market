// T7 (AC-3, AC-15): /evaluate's submit navigates to the same resultHref as
// the landing form, from the same fixture table: router.push inside the
// form's transition (the button aria-busy until the push settles), with the
// marker written first; the rejected table gives the same inline errors and
// no push. T7's scan half lives in src/lib/result-href.test.ts.
import {
  ENTRY_SUBMISSIONS,
  REJECTED_ENTRIES,
} from "@/lib/__fixtures__/entry-submissions";
import { submitMarkerKey } from "@/lib/entry-submit";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EvaluatePageClient } from "./evaluate-client";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

let events: string[] = [];
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  events = [];
  router.push.mockReset();
  router.push.mockImplementation((href: string) => {
    events.push(`push ${href}`);
  });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.sessionStorage.clear();
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    events.push(`mark ${key}`);
    setItem.call(this, key, value);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const cardInput = () => screen.getByRole("combobox", { name: "Card" });
const priceInput = () => screen.getByRole("textbox", { name: "Your price" });
const submit = () => screen.getByRole("button", { name: "Evaluate" });
const fill = (card: string, price: string) => {
  fireEvent.change(cardInput(), { target: { value: card } });
  fireEvent.change(priceInput(), { target: { value: price } });
};
const send = () => fireEvent.submit(submit().closest("form")!);

describe("/evaluate submits to resultHref (T7, AC-3, AC-15)", () => {
  test.each(ENTRY_SUBMISSIONS.map((row) => [row.card, row]))(
    "%j → one push to its href, the marker first",
    (_card, row) => {
      render(<EvaluatePageClient />);
      fill(row.card, row.price);
      send();
      expect(router.push).toHaveBeenCalledExactlyOnceWith(row.href);
      expect(events).toEqual([
        `mark ${submitMarkerKey(row.href)}`,
        `push ${row.href}`,
      ]);
    },
  );

  test("the push runs inside the form's transition: aria-busy until it settles", async () => {
    let settle: () => void = () => {};
    router.push.mockImplementation(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );
    render(<EvaluatePageClient />);
    fill("Esper Sentinel", "74.99");
    await act(async () => {
      send();
    });
    expect(router.push).toHaveBeenCalledOnce();
    expect(submit()).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      settle();
    });
    expect(submit()).not.toHaveAttribute("aria-busy");
  });

  test.each(
    REJECTED_ENTRIES.filter((r) => r.status !== "empty").map((r) => [
      r.name,
      r,
    ]),
  )("%s → the same inline error as the landing form, no push", (_name, row) => {
    render(<EvaluatePageClient />);
    fill(row.card, row.price);
    send();
    const message =
      row.status === "bad_card"
        ? UI_COPY.cardNotFound
        : UI_COPY.validationError;
    expect(screen.getByText(message)).toHaveAttribute("role", "alert");
    expect(router.push).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  test.each(
    REJECTED_ENTRIES.filter((r) => r.status === "empty").map((r) => [
      r.name,
      r,
    ]),
  )("%s → submit disabled with the helper, no push", (_name, row) => {
    render(<EvaluatePageClient />);
    fill(row.card, row.price);
    expect(submit()).toBeDisabled();
    expect(submit()).toHaveAccessibleDescription(UI_COPY.submitHelper);
    send();
    expect(router.push).not.toHaveBeenCalled();
  });
});
