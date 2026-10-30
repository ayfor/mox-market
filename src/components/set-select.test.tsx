// The optional Set picker (UI patch 2026-10-30): a Listbox named by its
// visible "Set" label, disabled with "Any set" until the field's name
// resolves; useCardPrintings fetches the printings route after a debounce,
// once per name, aborting a stale request, and only the newest answers.
import { SET_PICKER_LABELS } from "@/lib/copy/result-labels";
import { PRINTINGS_LOOKUP_DEBOUNCE_MS } from "@/lib/evaluation/consts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  chosenPrinting,
  SetSelect,
  useCardPrintings,
  type PrintingChoice,
} from "./set-select";

const MH2: PrintingChoice = {
  id: "f3537373-ef54-4578-9d05-6216420ee349",
  setName: "Modern Horizons 2",
  setCode: "MH2",
  collectorNumber: "12",
  label: "Modern Horizons 2 (MH2) · #12",
};
const SLD: PrintingChoice = {
  id: "f8b6c532-b837-42b6-9ed2-0231d0779626",
  setName: "Secret Lair Drop",
  setCode: "SLD",
  collectorNumber: "2123",
  label: "Secret Lair Drop (SLD) · #2123",
};

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A card text field and the picker, wired as the forms wire them. */
function Harness({ onChoose }: { onChoose?: (id: string) => void }) {
  const [card, setCard] = useState("");
  const [choice, setChoice] = useState({ card: "", printing: "" });
  const printings = useCardPrintings();
  const printing = chosenPrinting(choice, card);
  return (
    <>
      <input
        aria-label="Card"
        value={card}
        onChange={(event) => {
          setCard(event.target.value);
          setChoice({ card: "", printing: "" });
        }}
        onBlur={(event) => printings.request(event.currentTarget.value)}
      />
      <SetSelect
        id="set"
        card={card}
        lookup={printings.lookup}
        value={printing}
        onChange={(next) => {
          setChoice({ card, printing: next });
          onChoose?.(next);
        }}
        className="mm-field mm-field--set"
        labelClassName="mm-field-label"
      />
      <output data-testid="printing">{printing}</output>
    </>
  );
}

const cardField = () => screen.getByRole("textbox", { name: "Card" });
const setButton = () =>
  screen.getByRole("button", {
    name: new RegExp(`^${SET_PICKER_LABELS.label}`),
  });
const settle = (card: string) => {
  fireEvent.change(cardField(), { target: { value: card } });
  fireEvent.blur(cardField());
};
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(PRINTINGS_LOOKUP_DEBOUNCE_MS);
  });

describe("the Set picker", () => {
  test("a button named by its visible Set label, disabled, showing Any set", () => {
    render(<Harness />);
    const label = screen.getByText(SET_PICKER_LABELS.label);
    expect(label).toBeVisible();
    expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.any);
    expect(setButton()).toBeDisabled();
    expect(setButton()).toHaveClass("mm-selector-button", "mm-set-button");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("leaving the card field fetches its printings once, after the debounce; the list is Any set, then the route's labels in order", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json({ data: [SLD, MH2] }));
    render(<Harness />);
    settle("  Esper Sentinel ");
    expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.loading);
    expect(setButton()).toHaveAttribute("aria-busy", "true");
    expect(fetchMock).not.toHaveBeenCalled();
    await tick();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/cards/printings?name=Esper%20Sentinel",
    );
    expect(setButton()).toBeEnabled();
    expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.any);
    // The same name again fetches nothing.
    fireEvent.blur(cardField());
    await tick();
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.useRealTimers();
    setButton().focus();
    await act(async () => {
      fireEvent.keyDown(setButton(), { key: "ArrowDown" });
    });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      SET_PICKER_LABELS.any,
      SLD.label,
      MH2.label,
    ]);
  });

  test("choosing a set shows it; editing the card text resets to Any set", async () => {
    fetchMock.mockResolvedValue(json({ data: [SLD, MH2] }));
    const onChoose = vi.fn();
    render(<Harness onChoose={onChoose} />);
    settle("Esper Sentinel");
    await vi.waitFor(() => expect(setButton()).toBeEnabled());
    setButton().focus();
    await act(async () => {
      fireEvent.keyDown(setButton(), { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: MH2.label }));
    });
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(MH2.id);
    expect(setButton()).toHaveTextContent(MH2.label);
    expect(screen.getByTestId("printing")).toHaveTextContent(MH2.id);
    fireEvent.change(cardField(), { target: { value: "Esper Sentinel!" } });
    expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.any);
    expect(setButton()).toBeDisabled();
    expect(screen.getByTestId("printing")).toBeEmptyDOMElement();
    // Back to the resolved name: its sets return, but the choice stays reset.
    fireEvent.change(cardField(), { target: { value: "Esper Sentinel" } });
    expect(setButton()).toBeEnabled();
    expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.any);
    expect(screen.getByTestId("printing")).toBeEmptyDOMElement();
  });

  test("a newer name aborts the older request, and only the newest answers", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const answers: Array<(res: Response) => void> = [];
    fetchMock.mockImplementation((_url, init) => {
      signals.push(init!.signal!);
      return new Promise<Response>((resolve) => answers.push(resolve));
    });
    render(<Harness />);
    settle("Esper Sentinel");
    await tick();
    settle("Esper Charm");
    expect(signals[0].aborted).toBe(true);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      answers[0](json({ data: [SLD] }));
      answers[1](json({ data: [MH2] }));
    });
    vi.useRealTimers();
    setButton().focus();
    await act(async () => {
      fireEvent.keyDown(setButton(), { key: "ArrowDown" });
    });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      SET_PICKER_LABELS.any,
      MH2.label,
    ]);
  });

  test("a name changed within the debounce never reaches the route", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json({ data: [MH2] }));
    render(<Harness />);
    settle("Esper");
    settle("Esper Sentinel");
    await tick();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("Esper%20Sentinel");
  });

  test.each([
    ["a 404", () => Promise.resolve(json({ error: "not_found" }, 404)), "any"],
    [
      "a 400",
      () => Promise.resolve(json({ error: "invalid_name" }, 400)),
      "any",
    ],
    [
      "a 502",
      () => Promise.resolve(json({ error: "upstream" }, 502)),
      "unavailable",
    ],
    [
      "a rejected fetch",
      () => Promise.reject(new TypeError("fetch failed")),
      "unavailable",
    ],
    [
      "a body that is not a choice array",
      () => Promise.resolve(json({ data: [{ id: 1 }] })),
      "unavailable",
    ],
  ] as const)(
    "%s → disabled, showing %s's text",
    async (_name, answer, text) => {
      fetchMock.mockImplementation(answer);
      render(<Harness />);
      settle("Esper Sentinel");
      await vi.waitFor(() =>
        expect(setButton()).not.toHaveAttribute("aria-busy"),
      );
      expect(setButton()).toBeDisabled();
      expect(setButton()).toHaveTextContent(SET_PICKER_LABELS[text]);
    },
  );

  test("after an error, leaving the field again retries", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json({ data: [MH2] }));
    render(<Harness />);
    settle("Esper Sentinel");
    await vi.waitFor(() =>
      expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.unavailable),
    );
    fireEvent.blur(cardField());
    await vi.waitFor(() => expect(setButton()).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("a blank field fetches nothing", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    settle("   ");
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
