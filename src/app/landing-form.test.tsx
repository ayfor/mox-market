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

/**
 * A push that stays pending until the test ends. React 19 entangles every
 * transition with an unsettled async action, so a promise left hanging would
 * keep later tests' transitions pending; afterEach settles them all.
 */
const hanging: Array<() => void> = [];
const hang = () => new Promise<void>((resolve) => hanging.push(resolve));
afterEach(async () => {
  await act(async () => {
    for (const settle of hanging.splice(0)) settle();
  });
});

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

const cardInput = () => screen.getByRole("combobox", { name: "Card" });
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
    router.push.mockImplementation(hang);
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

  test("a submit that supersedes a pending one removes its marker: only the newest key is left (ADV-5)", async () => {
    router.push.mockImplementation(hang);
    render(<LandingForm />);
    fill("Esper Sentinel", "74.99");
    await act(async () => {
      send();
    });
    fireEvent.change(cardInput(), { target: { value: "Esper Charm" } });
    await act(async () => {
      send();
    });
    const a = "/Esper%20Sentinel?price=74.99";
    const b = "/Esper%20Charm?price=74.99";
    expect(router.push.mock.calls.map(([href]) => href)).toEqual([a, b]);
    expect(Object.keys(window.sessionStorage)).toEqual([submitMarkerKey(b)]);
    // Back to A while B is pending: B's marker goes, A's is fresh.
    fireEvent.change(cardInput(), { target: { value: "Esper Sentinel" } });
    await act(async () => {
      send();
    });
    expect(Object.keys(window.sessionStorage)).toEqual([submitMarkerKey(a)]);
  });

  test("a removeItem that throws never blocks the newer push (ADV-5)", async () => {
    router.push.mockImplementation(hang);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<LandingForm />);
    fill("Esper Sentinel", "74.99");
    await act(async () => {
      send();
    });
    fireEvent.change(priceInput(), { target: { value: "75" } });
    await act(async () => {
      send();
    });
    expect(router.push).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenLastCalledWith("/Esper%20Sentinel?price=75");
  });

  test("a submit after the previous push settled removes nothing", async () => {
    render(<LandingForm />);
    fill("Esper Sentinel", "74.99");
    await act(async () => {
      send();
    });
    fireEvent.change(priceInput(), { target: { value: "75" } });
    await act(async () => {
      send();
    });
    expect(Object.keys(window.sessionStorage).sort()).toEqual(
      [
        submitMarkerKey("/Esper%20Sentinel?price=74.99"),
        submitMarkerKey("/Esper%20Sentinel?price=75"),
      ].sort(),
    );
  });

  test("not busy before a submit", () => {
    render(<LandingForm />);
    expect(submit()).not.toHaveAttribute("aria-busy");
  });
});

describe("ill-formed text never breaks the form (ADV-2)", () => {
  test("a lone surrogate in the card with a valid price: the form stays rendered and a submit shows the card message", () => {
    render(<LandingForm />);
    fill("Esper\uD800", "5");
    expect(form()).toBeInTheDocument();
    expect(submit()).toBeEnabled();
    send();
    expect(screen.getByText(UI_COPY.cardNotFound)).toHaveAttribute(
      "role",
      "alert",
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(window.sessionStorage.length).toBe(0);
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
    // The combobox names its error the entry form's way (UI patch).
    expect(cardInput()).toHaveAttribute("aria-errormessage", error.id);
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

describe("autocomplete and the optional Set picker (UI patch 2026-10-30)", () => {
  const MH2 = {
    id: "f3537373-ef54-4578-9d05-6216420ee349",
    setName: "Modern Horizons 2",
    setCode: "MH2",
    collectorNumber: "12",
    label: "Modern Horizons 2 (MH2) · #12",
  };
  const fetchMock = vi.fn<typeof fetch>();
  // While the card's list is open Headless UI hides the rest of the form.
  const setButton = () =>
    screen.getByRole("button", { name: /^Set/, hidden: true });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url) =>
      String(url).startsWith("/api/cards/printings")
        ? Response.json({ data: [MH2] })
        : Response.json({ data: ["Esper Sentinel", "Esper Charm"] }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("the card field is the combobox: typing lists suggestions that open upward", async () => {
    render(<LandingForm />);
    fireEvent.change(cardInput(), { target: { value: "esper" } });
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toHaveClass(
      "mm-combobox-options",
      "mm-combobox-options--above",
    );
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "esper",
      "Esper Sentinel",
      "Esper Charm",
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/cards/autocomplete?q=esper",
    );
    expect(cardInput()).toHaveClass("landing-form-input");
  });

  test("the Set picker starts disabled at Any set with a visible label", () => {
    render(<LandingForm />);
    expect(screen.getByText("Set")).toBeVisible();
    expect(setButton()).toBeDisabled();
    expect(setButton()).toHaveTextContent("Any set");
  });

  test("picking a suggestion looks its sets up; a chosen set adds printing= to the push", async () => {
    render(<LandingForm />);
    fireEvent.change(priceInput(), { target: { value: "74.99" } });
    fireEvent.change(cardInput(), { target: { value: "esper" } });
    await screen.findByRole("listbox");
    const suggestion = screen.getByRole("option", { name: "Esper Sentinel" });
    await act(async () => {
      // Headless UI selects an option on mousedown.
      fireEvent.mouseDown(suggestion);
      fireEvent.click(suggestion);
    });
    expect(cardInput()).toHaveValue("Esper Sentinel");
    await vi.waitFor(() => expect(setButton()).toBeEnabled());
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      "/api/cards/printings?name=Esper%20Sentinel",
    );
    setButton().focus();
    await act(async () => {
      fireEvent.keyDown(setButton(), { key: "ArrowDown" });
    });
    const list = screen.getByRole("listbox");
    expect(list).toHaveClass("mm-set-options--above");
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: MH2.label }));
    });
    expect(setButton()).toHaveTextContent(MH2.label);
    send();
    const href = `/Esper%20Sentinel?price=74.99&printing=${MH2.id}`;
    expect(router.push).toHaveBeenCalledExactlyOnceWith(href);
    expect(events).toEqual([`mark ${submitMarkerKey(href)}`, `push ${href}`]);
  });

  test("changing the card text resets the set to Any set", async () => {
    // No suggestions, so no open list hides the rest of the form.
    fetchMock.mockImplementation(async (url) =>
      String(url).startsWith("/api/cards/printings")
        ? Response.json({ data: [MH2] })
        : Response.json({ data: [] }),
    );
    render(<LandingForm />);
    fill("Esper Sentinel", "74.99");
    fireEvent.blur(cardInput());
    await vi.waitFor(() => expect(setButton()).toBeEnabled());
    setButton().focus();
    await act(async () => {
      fireEvent.keyDown(setButton(), { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: MH2.label }));
    });
    fireEvent.change(cardInput(), { target: { value: "Esper Charm" } });
    expect(setButton()).toHaveTextContent("Any set");
    expect(setButton()).toBeDisabled();
    send();
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      "/Esper%20Charm?price=74.99",
    );
  });
});
