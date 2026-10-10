// T18 (AC-9; C1.52), T17's form half (AC-8) and T28's form half (AC-20):
// the entry form validates before any navigation and pushes once.
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EntryForm } from "./entry-form";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  router.push.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
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

describe("empty fields (T18, AC-9)", () => {
  test.each([
    ["both empty", "", ""],
    ["an empty card", "", "74.99"],
    ["an empty price", "Esper Sentinel", ""],
    ["a whitespace-only card", "   ", "74.99"],
    ["a whitespace-only price", "Esper Sentinel", "  "],
  ])("%s → submit disabled, the helper tied to it", (_name, card, price) => {
    render(<EntryForm />);
    fill(card, price);
    expect(submit()).toBeDisabled();
    const helper = screen.getByText(UI_COPY.submitHelper);
    expect(submit()).toHaveAttribute("aria-describedby", helper.id);
    expect(submit()).toHaveAccessibleDescription(UI_COPY.submitHelper);
    send();
    expect(router.push).not.toHaveBeenCalled();
  });

  test("both filled → submit enabled, no helper", () => {
    render(<EntryForm />);
    fill("Esper Sentinel", "74.99");
    expect(submit()).toBeEnabled();
    expect(screen.queryByText(UI_COPY.submitHelper)).toBeNull();
    expect(submit()).not.toHaveAttribute("aria-describedby");
  });
});

describe("invalid prices (T18, AC-9)", () => {
  test.each(["100000.01", "74.999", "1e3", "0", "abc", "-5"])(
    "%j → the inline validation error with aria-invalid, no navigation",
    (price) => {
      render(<EntryForm />);
      fill("Esper Sentinel", price);
      send();
      const error = screen.getByText(UI_COPY.validationError);
      expect(error).toHaveAttribute("role", "alert");
      expect(priceInput()).toHaveAttribute("aria-invalid", "true");
      expect(priceInput()).toHaveAccessibleDescription(UI_COPY.validationError);
      expect(router.push).toHaveBeenCalledTimes(0);
    },
  );

  test("editing the price clears the error", () => {
    render(<EntryForm />);
    fill("Esper Sentinel", "74.999");
    send();
    expect(screen.getByText(UI_COPY.validationError)).toBeInTheDocument();
    fireEvent.change(priceInput(), { target: { value: "74.99" } });
    expect(screen.queryByText(UI_COPY.validationError)).toBeNull();
    expect(priceInput()).toHaveAttribute("aria-invalid", "false");
  });

  test("a server-side error (initialError) shows prefilled until the price is edited", () => {
    render(
      <EntryForm
        initialCard="Esper Sentinel"
        initialPrice="74.999"
        initialError
      />,
    );
    expect(cardInput()).toHaveValue("Esper Sentinel");
    expect(priceInput()).toHaveValue("74.999");
    expect(screen.getByText(UI_COPY.validationError)).toBeInTheDocument();
    fireEvent.change(priceInput(), { target: { value: "74.99" } });
    expect(screen.queryByText(UI_COPY.validationError)).toBeNull();
  });
});

describe("a valid submit (T18, AC-9)", () => {
  test('"$74.99" with "Esper Sentinel" → exactly one push to /Esper%20Sentinel?price=74.99', () => {
    render(<EntryForm />);
    fill("Esper Sentinel", "$74.99");
    send();
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      "/Esper%20Sentinel?price=74.99",
    );
    expect(screen.queryByText(UI_COPY.validationError)).toBeNull();
  });

  test("the card is trimmed and encoded; the price normalised", () => {
    render(<EntryForm />);
    fill("  Fire // Ice ", " 1,234.50 ");
    send();
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      "/Fire%20%2F%2F%20Ice?price=1234.50",
    );
  });

  test("the same query again while pending pushes nothing", async () => {
    router.push.mockImplementation(() => new Promise(() => {}));
    render(<EntryForm />);
    fill("Esper Sentinel", "74.99");
    await act(async () => {
      send();
    });
    await act(async () => {
      send();
    });
    expect(router.push).toHaveBeenCalledOnce();
  });

  test("the card input has maxLength 141", () => {
    render(<EntryForm />);
    expect(cardInput()).toHaveAttribute("maxLength", "141");
  });
});

describe("autocomplete down (T28, AC-20)", () => {
  test("on a 502 the typed text stays and free-text submit pushes it", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "upstream" }), {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      }),
    );
    render(<EntryForm />);
    fill("esper sentinel", "74.99");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(cardInput()).toHaveValue("esper sentinel");
    send();
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      "/esper%20sentinel?price=74.99",
    );
  });
});

describe("decimal commas (ADV-3)", () => {
  test.each(["74,99", "0,50", "1,5"])(
    "%j → the validation error, no navigation",
    (price) => {
      render(<EntryForm />);
      fill("Esper Sentinel", price);
      send();
      expect(screen.getByText(UI_COPY.validationError)).toBeInTheDocument();
      expect(router.push).toHaveBeenCalledTimes(0);
    },
  );

  test('"1,000" is a thousands separator → /…?price=1000', () => {
    render(<EntryForm />);
    fill("Esper Sentinel", "1,000");
    send();
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      "/Esper%20Sentinel?price=1000",
    );
  });
});

describe("the server's card guard runs before navigating (ADV-6)", () => {
  test.each([
    ["..", ".."],
    [".", "."],
    ["a padded dot segment", " .. "],
    ["a tab", "Esper\tSentinel"],
    ["NEL (U+0085)", "Esper\u0085Sentinel"],
  ])("%s → the inline card error, no navigation", (_name, card) => {
    render(<EntryForm />);
    fill(card, "5");
    send();
    const error = screen.getByText(UI_COPY.cardNotFound);
    expect(error).toHaveAttribute("role", "alert");
    expect(cardInput()).toHaveAttribute("aria-invalid", "true");
    expect(cardInput()).toHaveAttribute("aria-errormessage", error.id);
    expect(router.push).toHaveBeenCalledTimes(0);
  });

  test("editing the card clears its error; three dots are a name, not a segment", () => {
    render(<EntryForm />);
    fill("..", "5");
    send();
    expect(screen.getByText(UI_COPY.cardNotFound)).toBeInTheDocument();
    fireEvent.change(cardInput(), { target: { value: "..." } });
    expect(screen.queryByText(UI_COPY.cardNotFound)).toBeNull();
    expect(cardInput()).not.toHaveAttribute("aria-invalid");
    send();
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/...?price=5");
  });
});

describe("keyboard free text through the form (ADV-2, AC-20)", () => {
  // While the list is open Headless UI marks the rest of the form
  // aria-hidden, the field label included, so the input is found by role.
  const combobox = () => screen.getByRole("combobox");
  const typeCard = async (text: string) => {
    fireEvent.change(combobox(), { target: { value: text } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  const withSuggestions = async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(
      Response.json({ data: ["Bolt Bend", "Lightning Bolt"] }),
    );
    render(<EntryForm />);
    fireEvent.change(priceInput(), { target: { value: "1" } });
    await typeCard("Bolt");
    expect(screen.getAllByRole("option")[0]).toHaveTextContent(/^Bolt$/);
  };

  test("with suggestions, Tab keeps the typed card", async () => {
    await withSuggestions();
    fireEvent.keyDown(combobox(), { key: "Tab" });
    expect(combobox()).toHaveValue("Bolt");
    expect(router.push).not.toHaveBeenCalled();
  });

  test("with suggestions, Enter keeps the typed card and pushes it once", async () => {
    await withSuggestions();
    await act(async () => {
      fireEvent.keyDown(combobox(), { key: "Enter" });
    });
    expect(combobox()).toHaveValue("Bolt");
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/Bolt?price=1");
  });

  test("with the route down (502), the first Enter pushes the typed card", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "upstream" }), { status: 502 }),
    );
    render(<EntryForm />);
    fireEvent.change(priceInput(), { target: { value: "74.99" } });
    await typeCard("esper sentinel");
    await act(async () => {
      fireEvent.keyDown(combobox(), { key: "Enter" });
    });
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      "/esper%20sentinel?price=74.99",
    );
  });
});
