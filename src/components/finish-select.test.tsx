// T11 (AC-4, AC-9, AC-11): FinishSelect offers exactly the printing's
// offered finishes by FINISH_LABELS, never Etched; its value is the requested
// finish even when not offered; with nothing offered it is disabled; arrow
// keys never commit.
import {
  FINISH_LABELS,
  UI_COPY,
  type ShownFinish,
} from "@/lib/recommendation/ui-copy";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { FinishSelect } from "./finish-select";

function renderSelect(options: readonly ShownFinish[], value: ShownFinish) {
  const onCommit = vi.fn();
  render(<FinishSelect options={options} value={value} onCommit={onCommit} />);
  return onCommit;
}

const button = () =>
  screen.getByRole("button", { name: new RegExp(`^${UI_COPY.finishLabel}`) });
const key = (k: string) =>
  act(async () => {
    fireEvent.keyDown(document.activeElement!, { key: k });
  });
const optionTexts = async () => {
  button().focus();
  await key("ArrowDown");
  return screen.getAllByRole("option").map((o) => o.textContent);
};

describe("FinishSelect (T11, AC-4, AC-9, AC-11)", () => {
  test("a button named by the finish label, showing the value's name", () => {
    renderSelect(["normal", "foil"], "normal");
    // aria-labelledby is the label, then the button itself, so browsers
    // read "Finish Normal"; jsdom's name computation stops at the label.
    const label = screen.getByText(UI_COPY.finishLabel);
    expect(button().getAttribute("aria-labelledby")?.split(" ")).toEqual([
      label.id,
      button().id,
    ]);
    expect(button()).toHaveAccessibleName(
      new RegExp(`^${UI_COPY.finishLabel}`),
    );
    expect(button()).toHaveTextContent(FINISH_LABELS.normal);
  });

  test.each<[readonly ShownFinish[], string[]]>([
    [
      ["normal", "foil"],
      ["Normal", "Foil"],
    ],
    [["foil"], ["Foil"]],
    [["normal"], ["Normal"]],
  ])("offered %j → options %j, never Etched", async (offered, labels) => {
    renderSelect(offered, offered[0]);
    const texts = await optionTexts();
    expect(texts).toEqual(labels);
    expect(texts).not.toContain("Etched");
    expect(document.body).not.toHaveTextContent(/etched/i);
  });

  test("an etched entry forced in by a cast never renders", async () => {
    renderSelect(["normal", "etched" as ShownFinish, "foil"], "normal");
    expect(await optionTexts()).toEqual(["Normal", "Foil"]);
    expect(document.body).not.toHaveTextContent(/etched/i);
  });

  test("AC-9: value Normal on a foil-only printing; one option, Foil, none selected", async () => {
    renderSelect(["foil"], "normal");
    expect(button()).toHaveTextContent("Normal");
    expect(await optionTexts()).toEqual(["Foil"]);
    expect(screen.getByRole("option", { name: "Foil" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  test("with no offered finish the button is disabled", () => {
    const onCommit = renderSelect([], "normal");
    expect(button()).toBeDisabled();
    fireEvent.click(button());
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("three ArrowDown presses commit 0 times; Enter commits once", async () => {
    const onCommit = renderSelect(["normal", "foil"], "normal");
    button().focus();
    await key("ArrowDown");
    for (let i = 0; i < 3; i += 1) await key("ArrowDown");
    expect(onCommit).not.toHaveBeenCalled();
    await key("Enter");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("foil");
  });

  test("a click commits once", async () => {
    const onCommit = renderSelect(["normal", "foil"], "normal");
    await act(async () => {
      fireEvent.click(button());
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Foil" }));
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("foil");
  });
});
