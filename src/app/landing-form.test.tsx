// T5 (AC-2, AC-15; S2.4d4): the landing form navigates through resultHref,
// one push per submit, with the marker set first; empty fields disable submit
// with the helper; a rejected card or price shows its message and never
// navigates. The shared fixture table also drives T7 (/evaluate), so the two
// forms are proven to produce the same URLs.
import {
  ENTRY_SUBMISSIONS,
  REJECTED_ENTRIES,
} from "@/lib/__fixtures__/entry-submissions";
import { submitMarkerKey } from "@/lib/entry-submit";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LandingForm } from "./landing-form";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/** What happened, in order: marker writes and pushes. */
let events: string[] = [];

beforeEach(() => {
  events = [];
  router.push.mockReset();
  router.push.mockImplementation((href: string) => {
    events.push(`push ${href}`);
  });
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
});

const cardInput = () => screen.getByRole("textbox", { name: "Card" });
const priceInput = () => screen.getByRole("textbox", { name: "Your price" });
const submit = () => screen.getByRole("button", { name: "Evaluate" });
const form = () => submit().closest("form")!;
const fill = (card: string, price: string) => {
  fireEvent.change(cardInput(), { target: { value: card } });
  fireEvent.change(priceInput(), { target: { value: price } });
};
const send = () => fireEvent.submit(form());

describe("the landing form's shape (T5, AC-2)", () => {
  test("inputs named card and price; no action or method; the labels and placeholders", () => {
    render(<LandingForm />);
    expect(cardInput()).toHaveAttribute("name", "card");
    expect(priceInput()).toHaveAttribute("name", "price");
    expect(form()).not.toHaveAttribute("action");
    expect(form()).not.toHaveAttribute("method");
    expect(cardInput()).toHaveAttribute("placeholder", "Card name...");
    expect(priceInput()).toHaveAttribute("placeholder", "$ Price");
    expect(priceInput()).toHaveAttribute("inputmode", "decimal");
  });
});

describe("valid submits (T5, AC-2, AC-15)", () => {
  test.each(ENTRY_SUBMISSIONS.map((row) => [row.card, row]))(
    "%j → exactly one push to its href, the marker written first",
    (_card, row) => {
      render(<LandingForm />);
      fill(row.card, row.price);
      send();
      expect(router.push).toHaveBeenCalledExactlyOnceWith(row.href);
      expect(events).toEqual([
        `mark ${submitMarkerKey(row.href)}`,
        `push ${row.href}`,
      ]);
      expect(window.sessionStorage.getItem(submitMarkerKey(row.href))).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    },
  );

  test("blocked storage skips the marker, and the push still happens", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<LandingForm />);
    fill("Esper Sentinel", "74.99");
    send();
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      "/Esper%20Sentinel?price=74.99",
    );
  });

  test("Enter adds no submit of its own: the browser's implicit submit pushes once", () => {
    render(<LandingForm />);
    fill("Esper Sentinel", "74.99");
    fireEvent.keyDown(priceInput(), { key: "Enter" });
    expect(router.push).not.toHaveBeenCalled();
    act(() => {
      form().requestSubmit();
    });
    expect(router.push).toHaveBeenCalledOnce();
  });

  test("the same query again while pending pushes nothing; a different one pushes", async () => {
    router.push.mockImplementation(() => new Promise(() => {}));
    render(<LandingForm />);
    fill("Esper Sentinel", "74.99");
    await act(async () => {
      send();
    });
    expect(submit()).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      send();
    });
    expect(router.push).toHaveBeenCalledOnce();
    const markers = () => events.filter((e) => e.startsWith("mark ")).length;
    expect(markers()).toBe(1);
    fireEvent.change(priceInput(), { target: { value: "75" } });
    await act(async () => {
      send();
    });
    expect(router.push).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenLastCalledWith("/Esper%20Sentinel?price=75");
    expect(markers()).toBe(2);
  });

  test("not busy before a submit", () => {
    render(<LandingForm />);
    expect(submit()).not.toHaveAttribute("aria-busy");
  });
});

describe("rejected input (T5, AC-2)", () => {
  const rows = REJECTED_ENTRIES;

  test.each(rows.filter((r) => r.status === "empty").map((r) => [r.name, r]))(
    "%s → submit disabled, the helper is its description, no push",
    (_name, row) => {
      render(<LandingForm />);
      fill(row.card, row.price);
      expect(submit()).toBeDisabled();
      const helper = screen.getByText(UI_COPY.submitHelper);
      expect(helper.textContent).toBe(UI_COPY.submitHelper);
      expect(submit()).toHaveAttribute("aria-describedby", helper.id);
      expect(submit()).toHaveAccessibleDescription(UI_COPY.submitHelper);
      send();
      expect(router.push).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    },
  );

  test.each(
    rows.filter((r) => r.status === "bad_price").map((r) => [r.name, r]),
  )(
    "%s → the validation error inline, aria-invalid, no push, no marker",
    (_name, row) => {
      render(<LandingForm />);
      fill(row.card, row.price);
      send();
      const error = screen.getByText(UI_COPY.validationError);
      expect(error).toHaveAttribute("role", "alert");
      expect(priceInput()).toHaveAttribute("aria-invalid", "true");
      expect(priceInput()).toHaveAccessibleDescription(UI_COPY.validationError);
      expect(router.push).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    },
  );

  test.each(
    rows.filter((r) => r.status === "bad_card").map((r) => [r.name, r]),
  )("%s → couldn't find that card inline, no push", (_name, row) => {
    render(<LandingForm />);
    fill(row.card, row.price);
    send();
    const error = screen.getByText(UI_COPY.cardNotFound);
    expect(error).toHaveAttribute("role", "alert");
    expect(cardInput()).toHaveAttribute("aria-invalid", "true");
    expect(cardInput()).toHaveAccessibleDescription(UI_COPY.cardNotFound);
    expect(router.push).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  test("editing a field clears its error", () => {
    render(<LandingForm />);
    fill("Esper Sentinel", "74.999");
    send();
    expect(screen.getByText(UI_COPY.validationError)).toBeInTheDocument();
    fireEvent.change(priceInput(), { target: { value: "74.99" } });
    expect(screen.queryByText(UI_COPY.validationError)).toBeNull();
    expect(priceInput()).not.toHaveAttribute("aria-invalid");
    fill("..", "5");
    send();
    expect(screen.getByText(UI_COPY.cardNotFound)).toBeInTheDocument();
    fireEvent.change(cardInput(), { target: { value: "..." } });
    expect(screen.queryByText(UI_COPY.cardNotFound)).toBeNull();
    send();
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/...?price=5");
  });
});
