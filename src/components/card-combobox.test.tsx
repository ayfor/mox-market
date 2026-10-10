// T26 (AC-18, C1.30) and T28 (AC-20): the combobox debounces, needs 2
// trimmed characters, aborts superseded requests, and on a failed route
// shows nothing and keeps the typed text.
import { AUTOCOMPLETE_DEBOUNCE_MS } from "@/lib/evaluation/consts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CardCombobox } from "./card-combobox";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ok = (names: string[]) =>
  new Response(JSON.stringify({ data: names }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const failed = (status: number) =>
  new Response(JSON.stringify({ error: "upstream" }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

function Harness({ onValue }: { onValue?: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="card">Card name</label>
      <CardCombobox
        id="card"
        value={value}
        onChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const input = () => screen.getByRole("combobox");
const type = (text: string) =>
  fireEvent.change(input(), { target: { value: text } });
const requestedQueries = () =>
  fetchMock.mock.calls.map(([url]) =>
    new URL(String(url), "http://localhost").searchParams.get("q"),
  );
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

describe("debounce and minimum length (T26, AC-18)", () => {
  test("AUTOCOMPLETE_DEBOUNCE_MS is 150", () => {
    expect(AUTOCOMPLETE_DEBOUNCE_MS).toBe(150);
  });

  test('"j" → 0 requests', async () => {
    render(<Harness />);
    type("j");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('"ja" → 0 at 149 ms and 1 at 150 ms', async () => {
    fetchMock.mockResolvedValue(ok([]));
    render(<Harness />);
    type("ja");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(149);
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedQueries()).toEqual(["ja"]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/cards/autocomplete?q=ja",
    );
  });

  test('"ja" then "jac" within 150 ms → one request, for "jac"', async () => {
    fetchMock.mockResolvedValue(ok([]));
    render(<Harness />);
    type("ja");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    type("jac");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(requestedQueries()).toEqual(["jac"]);
  });

  test('"  j " → 0 requests (trimmed)', async () => {
    render(<Harness />);
    type("  j ");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a trimmed query is sent, encoded", async () => {
    fetchMock.mockResolvedValue(ok([]));
    render(<Harness />);
    type("  fire // ice ");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(requestedQueries()).toEqual(["fire // ice"]);
  });
});

describe("suggestions (T26)", () => {
  test("shows the typed text, then the names; picking one fills the input", async () => {
    fetchMock.mockResolvedValue(ok(["Esper Sentinel", "Esper Charm"]));
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    type("esper");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await flush();
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "esper",
      "Esper Sentinel",
      "Esper Charm",
    ]);
    // Headless UI selects an option on mousedown.
    fireEvent.mouseDown(options[1]);
    fireEvent.click(options[1]);
    await flush();
    expect(screen.getByTestId("value")).toHaveTextContent("Esper Sentinel");
    expect(onValue).toHaveBeenLastCalledWith("Esper Sentinel");
    expect(input()).toHaveValue("Esper Sentinel");
  });

  test("a superseded request is aborted and its late response ignored", async () => {
    let resolveFirst: (r: Response) => void = () => {};
    fetchMock
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValueOnce(ok(["Jace, the Mind Sculptor"]));
    render(<Harness />);
    type("ja");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    const firstSignal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;
    type("jac");
    expect(firstSignal.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await flush();
    resolveFirst(ok(["Jabba"]));
    await flush();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "jac",
      "Jace, the Mind Sculptor",
    ]);
  });

  test("the input caps at 141 characters", () => {
    render(<Harness />);
    expect(input()).toHaveAttribute("maxLength", "141");
  });
});

describe("a failed route (T28, AC-20)", () => {
  test.each([
    ["502", () => Promise.resolve(failed(502))],
    ["400", () => Promise.resolve(failed(400))],
    ["a network error", () => Promise.reject(new TypeError("offline"))],
    [
      "a 200 with a malformed body",
      () => Promise.resolve(new Response("not json", { status: 200 })),
    ],
  ])("%s → no options, the typed text kept", async (_name, answer) => {
    fetchMock.mockImplementation(answer);
    render(<Harness />);
    type("esper sent");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(input()).toHaveValue("esper sent");
    expect(screen.getByTestId("value")).toHaveTextContent("esper sent");
  });

  test("an earlier success is cleared when a later request fails", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(["Esper Sentinel"]))
      .mockResolvedValueOnce(failed(502));
    render(<Harness />);
    type("esper");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await flush();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    type("esper s");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await flush();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(input()).toHaveValue("esper s");
  });
});

describe("free text stays free under the keyboard (ADV-2, AC-20)", () => {
  /** The combobox in a form, so Enter can submit it. */
  function FormHarness({ onSubmit }: { onSubmit: (card: string) => void }) {
    const [value, setValue] = useState("");
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <label htmlFor="card">Card</label>
        <CardCombobox id="card" value={value} onChange={setValue} />
        <output data-testid="value">{value}</output>
      </form>
    );
  }

  const suggest = async (typed: string) => {
    type(typed);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await flush();
  };

  test("the typed text is the first, active option; an exact suggestion is not repeated", async () => {
    fetchMock.mockResolvedValue(ok(["Bolt Bend", "Bolt", "Lightning Bolt"]));
    render(<FormHarness onSubmit={vi.fn()} />);
    await suggest("Bolt");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Bolt",
      "Bolt Bend",
      "Lightning Bolt",
    ]);
    expect(input()).toHaveAttribute("aria-activedescendant", options[0].id);
  });

  test("Tab keeps the typed text", async () => {
    fetchMock.mockResolvedValue(ok(["Bolt Bend", "Lightning Bolt"]));
    render(<FormHarness onSubmit={vi.fn()} />);
    await suggest("Bolt");
    fireEvent.keyDown(input(), { key: "Tab" });
    await flush();
    expect(screen.getByTestId("value")).toHaveTextContent(/^Bolt$/);
    expect(input()).toHaveValue("Bolt");
  });

  test("Enter keeps the typed text and submits the form once", async () => {
    fetchMock.mockResolvedValue(ok(["Bolt Bend", "Lightning Bolt"]));
    const onSubmit = vi.fn();
    render(<FormHarness onSubmit={onSubmit} />);
    await suggest("Bolt");
    fireEvent.keyDown(input(), { key: "Enter" });
    await flush();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Bolt");
    expect(input()).toHaveValue("Bolt");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  test("Enter on a suggestion the user moved to fills it, without submitting", async () => {
    fetchMock.mockResolvedValue(ok(["Bolt Bend", "Lightning Bolt"]));
    const onSubmit = vi.fn();
    render(<FormHarness onSubmit={onSubmit} />);
    await suggest("Bolt");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    await flush();
    fireEvent.keyDown(input(), { key: "Enter" });
    await flush();
    expect(screen.getByTestId("value")).toHaveTextContent("Bolt Bend");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("with no suggestions (a 502), the first Enter submits the typed text", async () => {
    fetchMock.mockResolvedValue(failed(502));
    const onSubmit = vi.fn();
    render(<FormHarness onSubmit={onSubmit} />);
    await suggest("esper sentinel");
    expect(input()).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(input(), { key: "Enter" });
    await flush();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("esper sentinel");
    expect(input()).toHaveAttribute("aria-expanded", "false");
  });

  test("Enter while composing (IME) does nothing", async () => {
    fetchMock.mockResolvedValue(failed(502));
    const onSubmit = vi.fn();
    render(<FormHarness onSubmit={onSubmit} />);
    await suggest("esper sentinel");
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
