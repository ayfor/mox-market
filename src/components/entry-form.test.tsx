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

  test("a second submit while pending pushes nothing", async () => {
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
