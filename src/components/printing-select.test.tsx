// T10 (AC-1, AC-11; C2-B.12): PrintingSelect is a Headless UI Listbox named
// by its label. Arrow keys move the active option and never commit; Enter or
// a click commits once; Escape commits nothing. A shown printing outside the
// options still shows its label with no option selected.
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { PrintingSelect } from "./printing-select";

const OPTIONS = [
  { id: "sld", label: "Secret Lair Drop (SLD) · #2123" },
  { id: "plst", label: "The List (PLST) · #MH2-12" },
  { id: "h2r", label: "Modern Horizons 2 Timeshifts (H2R) · #4" },
  { id: "mh2-12", label: "Modern Horizons 2 (MH2) · #12" },
  { id: "mh2-328", label: "Modern Horizons 2 (MH2) · #328" },
];

function renderSelect(
  value = "mh2-12",
  valueLabel = "Modern Horizons 2 (MH2) · #12",
) {
  const onCommit = vi.fn();
  render(
    <PrintingSelect
      options={OPTIONS}
      value={value}
      valueLabel={valueLabel}
      onCommit={onCommit}
    />,
  );
  return { onCommit, button: button() };
}

const button = () =>
  screen.getByRole("button", {
    name: new RegExp(`^${UI_COPY.printingLabel}`),
  });
const key = (k: string) =>
  act(async () => {
    fireEvent.keyDown(document.activeElement!, { key: k });
  });
const open = async () => {
  button().focus();
  await key("ArrowDown");
  return screen.getByRole("listbox");
};

describe("PrintingSelect (T10, AC-1, AC-11)", () => {
  test("a button named by the printing label, showing the shown option's label", () => {
    renderSelect();
    expect(button()).toHaveTextContent("Modern Horizons 2 (MH2) · #12");
    // aria-labelledby is the label, then the button itself, so browsers
    // read "Printing Modern Horizons 2 (MH2) · #12".
    const label = screen.getByText(UI_COPY.printingLabel);
    expect(label).toBeVisible();
    expect(button().getAttribute("aria-labelledby")?.split(" ")).toEqual([
      label.id,
      button().id,
    ]);
    expect(button()).toHaveAccessibleName(
      new RegExp(`^${UI_COPY.printingLabel}`),
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("opening lists exactly the given labels in order, the shown one selected", async () => {
    renderSelect();
    const listbox = await open();
    expect(listbox).toHaveAccessibleName(
      new RegExp(`^${UI_COPY.printingLabel}`),
    );
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(
      OPTIONS.map((o) => o.label),
    );
    expect(
      options.filter((o) => o.getAttribute("aria-selected") === "true"),
    ).toEqual([options[3]]);
  });

  test("a shown printing not among the options shows its label and selects no option", async () => {
    renderSelect("named", "Modern Horizons 2 Promos (PMH2) · #12s");
    expect(button()).toHaveTextContent(
      "Modern Horizons 2 Promos (PMH2) · #12s",
    );
    await open();
    const selected = screen
      .getAllByRole("option")
      .filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected).toEqual([]);
  });

  test("three ArrowDown presses commit 0 times; Enter then commits once with the active option's id", async () => {
    const { onCommit } = renderSelect("sld", OPTIONS[0].label);
    await open();
    for (let i = 0; i < 3; i += 1) await key("ArrowDown");
    expect(onCommit).not.toHaveBeenCalled();
    await key("Enter");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("mh2-12");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  test("ArrowUp moves too, and never commits", async () => {
    const { onCommit } = renderSelect();
    await open();
    await key("ArrowUp");
    await key("ArrowUp");
    expect(onCommit).not.toHaveBeenCalled();
    await key("Enter");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("plst");
  });

  test("a click on an option commits once", async () => {
    const { onCommit } = renderSelect();
    await act(async () => {
      fireEvent.click(button());
    });
    const target = screen.getByRole("option", {
      name: "Modern Horizons 2 (MH2) · #328",
    });
    await act(async () => {
      fireEvent.click(target);
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("mh2-328");
  });

  test("Escape closes the list and commits nothing", async () => {
    const { onCommit } = renderSelect();
    await open();
    await key("ArrowDown");
    await key("Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("with no options the button is disabled", () => {
    const onCommit = vi.fn();
    render(
      <PrintingSelect
        options={[]}
        value="named"
        valueLabel="Modern Horizons 2 (MH2) · #12"
        onCommit={onCommit}
      />,
    );
    expect(button()).toBeDisabled();
  });
});
