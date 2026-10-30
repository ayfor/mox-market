// The optional Set picker (UI patch 2026-10-30, and its review): a Listbox
// named by its visible "Set" label, aria-disabled (still focusable) with
// "Any set" until the field's name resolves; useCardPrintings fetches the
// printings route after a debounce, once per name, aborting a stale request,
// only the newest answering, never for a name the card guard rejects.
import { SET_PICKER_LABELS } from "@/lib/copy/result-labels";
import { PRINTINGS_LOOKUP_DEBOUNCE_MS } from "@/lib/evaluation/consts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ANY_SET,
  chosenPrinting,
  setChoiceFor,
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
  const [choice, setChoice] = useState(ANY_SET);
  const printings = useCardPrintings();
  const printing = chosenPrinting(choice, card);
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <input
        aria-label="Card"
        value={card}
        onChange={(event) => {
          const next = event.target.value;
          setCard(next);
          if (next.trim() !== card.trim()) setChoice(ANY_SET);
        }}
        onBlur={(event) => printings.request(event.currentTarget.value)}
      />
      <SetSelect
        card={card}
        lookup={printings.lookup}
        value={printing}
        onChange={(next) => {
          setChoice(setChoiceFor(card, next));
          onChoose?.(next);
        }}
        onRequest={() => printings.request(card)}
        className="mm-field mm-field--set"
        labelClassName="mm-field-label"
      />
      <output data-testid="printing">{printing}</output>
    </form>
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
const tick = (ms = PRINTINGS_LOOKUP_DEBOUNCE_MS) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const openList = async () => {
  setButton().focus();
  await act(async () => {
    fireEvent.keyDown(setButton(), { key: "ArrowDown" });
  });
};
const optionTexts = () =>
  screen.getAllByRole("option").map((o) => o.textContent);

describe("chosenPrinting and setChoiceFor (UI-8)", () => {
  test("the choice is keyed by trimmed card text", () => {
    const choice = setChoiceFor("Esper Sentinel ", MH2.id);
    expect(choice).toEqual({ card: "Esper Sentinel", printing: MH2.id });
    expect(chosenPrinting(choice, "Esper Sentinel")).toBe(MH2.id);
    expect(chosenPrinting(choice, "  Esper Sentinel  ")).toBe(MH2.id);
    expect(
      chosenPrinting(
        { card: "Esper Sentinel", printing: MH2.id },
        "Esper Sentinel ",
      ),
    ).toBe(MH2.id);
    expect(chosenPrinting(choice, "Esper Charm")).toBe("");
    expect(chosenPrinting(ANY_SET, "Esper Sentinel")).toBe("");
  });
});

describe("the Set picker", () => {
  test("a button named by its visible Set label, aria-disabled but focusable, showing Any set", () => {
    render(<Harness />);
    const label = screen.getByText(SET_PICKER_LABELS.label);
    expect(label).toBeVisible();
    expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.any);
    expect(setButton()).toHaveAttribute("aria-disabled", "true");
    expect(setButton()).not.toBeDisabled();
    expect(setButton()).not.toHaveAttribute("aria-busy");
    expect(setButton()).toHaveClass("mm-selector-button", "mm-set-button");
    setButton().focus();
    expect(setButton()).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the label's for= reaches the button, so clicking Set focuses it (UI-6)", async () => {
    fetchMock.mockResolvedValue(json({ data: [MH2] }));
    render(<Harness />);
    const label = screen.getByText(SET_PICKER_LABELS.label);
    expect(label.getAttribute("for")).toBe(setButton().id);
    expect(document.getElementById(label.getAttribute("for")!)).toBe(
      setButton(),
    );
    settle("Esper Sentinel");
    await vi.waitFor(() =>
      expect(setButton()).not.toHaveAttribute("aria-disabled"),
    );
    fireEvent.click(label);
    expect(setButton()).toHaveFocus();
  });

  test("while unavailable, keys and clicks never open it", async () => {
    render(<Harness />);
    setButton().focus();
    for (const key of ["ArrowDown", "Enter", " "]) {
      await act(async () => {
        fireEvent.keyDown(setButton(), { key });
      });
    }
    fireEvent.click(setButton());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("the debounce is pinned: nothing at DEBOUNCE - 1 ms, one fetch at DEBOUNCE (T7)", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json({ data: [SLD, MH2] }));
    render(<Harness />);
    settle("  Esper Sentinel ");
    expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.loading);
    await tick(PRINTINGS_LOOKUP_DEBOUNCE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await tick(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/cards/printings?name=Esper%20Sentinel",
    );
    expect(setButton()).not.toHaveAttribute("aria-disabled");
    expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.any);
    // The same name again fetches nothing.
    fireEvent.blur(cardField());
    await tick();
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.useRealTimers();
    await openList();
    expect(optionTexts()).toEqual([
      SET_PICKER_LABELS.any,
      SLD.label,
      MH2.label,
    ]);
  });

  test("unmounting aborts the in-flight request (T7)", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const { unmount } = render(<Harness />);
    settle("Esper Sentinel");
    await tick();
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  test("unmounting inside the debounce fetches nothing (T7)", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<Harness />);
    settle("Esper Sentinel");
    unmount();
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("focusing the picker looks the card up, as leaving the field does (UI-3)", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json({ data: [MH2] }));
    render(<Harness />);
    fireEvent.change(cardField(), { target: { value: "Esper Sentinel" } });
    fireEvent.focus(setButton());
    expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.loading);
    // The state is in the button's name (aria-labelledby is the label, then
    // the button itself), so a screen reader announces "Set Loading sets".
    const label = screen.getByText(SET_PICKER_LABELS.label);
    expect(setButton().getAttribute("aria-labelledby")?.split(" ")).toEqual([
      label.id,
      setButton().id,
    ]);
    await tick();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(setButton()).not.toHaveAttribute("aria-disabled");
  });

  test("Enter on the closed button opens the list and never submits the form (UI-7)", async () => {
    fetchMock.mockResolvedValue(json({ data: [MH2] }));
    const submitted = vi.fn();
    render(<Harness />);
    setButton().closest("form")!.addEventListener("submit", submitted);
    settle("Esper Sentinel");
    await vi.waitFor(() =>
      expect(setButton()).not.toHaveAttribute("aria-disabled"),
    );
    setButton().focus();
    await act(async () => {
      fireEvent.keyDown(setButton(), { key: "Enter" });
    });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(optionTexts()).toEqual([SET_PICKER_LABELS.any, MH2.label]);
    expect(submitted).not.toHaveBeenCalled();
  });

  test("choosing a set shows it; editing the card text resets to Any set, and back again stays reset", async () => {
    fetchMock.mockResolvedValue(json({ data: [SLD, MH2] }));
    const onChoose = vi.fn();
    render(<Harness onChoose={onChoose} />);
    settle("Esper Sentinel");
    await vi.waitFor(() =>
      expect(setButton()).not.toHaveAttribute("aria-disabled"),
    );
    await openList();
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: MH2.label }));
    });
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(MH2.id);
    expect(setButton()).toHaveTextContent(MH2.label);
    expect(screen.getByTestId("printing")).toHaveTextContent(MH2.id);
    // A trailing space is the same card: the choice stays (UI-8).
    fireEvent.change(cardField(), { target: { value: "Esper Sentinel " } });
    expect(screen.getByTestId("printing")).toHaveTextContent(MH2.id);
    fireEvent.change(cardField(), { target: { value: "Esper Sentinel!" } });
    expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.any);
    expect(setButton()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("printing")).toBeEmptyDOMElement();
    // Back to the resolved name: its sets return, but the choice stays reset.
    fireEvent.change(cardField(), { target: { value: "Esper Sentinel" } });
    expect(setButton()).not.toHaveAttribute("aria-disabled");
    expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.any);
    expect(screen.getByTestId("printing")).toBeEmptyDOMElement();
  });

  test("a newer name aborts the older request; the newer answers first and the stale late answer is ignored (T2)", async () => {
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
    // The newer answers first, then the stale one lands late.
    await act(async () => {
      answers[1](json({ data: [MH2] }));
    });
    expect(setButton()).not.toHaveAttribute("aria-disabled");
    await act(async () => {
      answers[0](json({ data: [SLD] }));
    });
    expect(setButton()).not.toHaveAttribute("aria-disabled");
    vi.useRealTimers();
    await openList();
    expect(optionTexts()).toEqual([SET_PICKER_LABELS.any, MH2.label]);
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
    ["a lone high surrogate", "Esper\uD800"],
    ["a control character", "Esper\u0007"],
  ])(
    "%s is never sent and never sits on Loading sets (PS-2)",
    async (_name, card) => {
      vi.useFakeTimers();
      render(<Harness />);
      settle(card);
      expect(setButton()).not.toHaveTextContent(SET_PICKER_LABELS.loading);
      await tick();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(setButton()).toHaveTextContent(SET_PICKER_LABELS.any);
      expect(setButton()).toHaveAttribute("aria-disabled", "true");
    },
  );

  test.each([
    {
      name: "a 404",
      answer: () => Promise.resolve(json({ error: "not_found" }, 404)),
      text: SET_PICKER_LABELS.any,
    },
    {
      name: "a 400",
      answer: () => Promise.resolve(json({ error: "invalid_name" }, 400)),
      text: SET_PICKER_LABELS.any,
    },
    {
      name: "a 502",
      answer: () => Promise.resolve(json({ error: "upstream" }, 502)),
      text: SET_PICKER_LABELS.unavailable,
    },
    {
      name: "a rejected fetch",
      answer: () => Promise.reject(new TypeError("fetch failed")),
      text: SET_PICKER_LABELS.unavailable,
    },
    {
      name: "a fetch that throws synchronously",
      answer: () => {
        throw new TypeError("bad URL");
      },
      text: SET_PICKER_LABELS.unavailable,
    },
    {
      name: "a body that is not a choice array",
      answer: () => Promise.resolve(json({ data: [{ id: 1 }] })),
      text: SET_PICKER_LABELS.unavailable,
    },
  ])("$name → aria-disabled, showing $text", async ({ answer, text }) => {
    fetchMock.mockImplementation(answer);
    render(<Harness />);
    settle("Esper Sentinel");
    await vi.waitFor(() =>
      expect(setButton()).not.toHaveTextContent(SET_PICKER_LABELS.loading),
    );
    expect(setButton()).toHaveAttribute("aria-disabled", "true");
    expect(setButton()).toHaveTextContent(text);
  });

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
    await vi.waitFor(() =>
      expect(setButton()).not.toHaveAttribute("aria-disabled"),
    );
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
