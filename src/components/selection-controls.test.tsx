// T12 (AC-5, AC-6, AC-11, AC-12): SelectionControls' single change handler.
// A commit pushes one query-only href inside the shared transition (the slot
// shows the skeleton at once), keeps the URL's price, never re-defaults the
// other control, writes no submit marker, and returns focus to the control
// that changed when the selectors remount. Any other navigation or a refresh
// clears that request.
import { PanelSkeleton } from "@/app/[card]/panel-skeleton";
import { ResultSlot } from "@/app/[card]/result-slot";
import { RetryButton } from "@/app/[card]/retry-button";
import {
  MH2_12_ID,
  MH2_328_ID,
  PLST_ID,
  SLD_2123_ID,
} from "@/lib/__fixtures__/esper-sentinel-prints";
import { LOADING_LABEL } from "@/lib/copy/result-labels";
import { UI_COPY, type ShownFinish } from "@/lib/recommendation/ui-copy";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { EntryForm } from "./entry-form";
import { ResultNavigationProvider } from "./result-navigation";
import {
  SelectionControls,
  type SelectionControlsProps,
  type SelectionOption,
} from "./selection-controls";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));
const url = vi.hoisted(() => ({ search: "price=74.99" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(url.search),
}));

beforeEach(() => {
  for (const fn of Object.values(router)) fn.mockReset();
  url.search = "price=74.99";
  window.sessionStorage.clear();
});

const OPTIONS: readonly SelectionOption[] = [
  {
    id: SLD_2123_ID,
    label: "Secret Lair Drop (SLD) · #2123",
    finishes: ["foil"],
  },
  { id: PLST_ID, label: "The List (PLST) · #MH2-12", finishes: ["normal"] },
  {
    id: MH2_12_ID,
    label: "Modern Horizons 2 (MH2) · #12",
    finishes: ["normal", "foil"],
  },
  {
    id: MH2_328_ID,
    label: "Modern Horizons 2 (MH2) · #328",
    finishes: ["normal", "foil"],
  },
];

/** The controls as the server renders them for a printing and finish. */
function shown(
  printingId: string,
  finish: ShownFinish,
): SelectionControlsProps {
  const option = OPTIONS.find((o) => o.id === printingId)!;
  return {
    options: OPTIONS,
    printingId,
    printingLabel: option.label,
    finish,
    offeredFinishes: option.finishes,
  };
}

/** A navigation that stays pending until `settle` is called. */
function pendingNavigation() {
  let settle: () => void = () => {};
  const promise = new Promise<void>((resolve) => (settle = resolve));
  return { promise, settle: () => act(async () => settle()) };
}

/** page.tsx's shape: the form, then the slot with the keyed Suspense. */
function Page({
  paramsKey,
  controls,
  error = false,
}: {
  paramsKey: string;
  controls: SelectionControlsProps;
  error?: boolean;
}) {
  return (
    <ResultNavigationProvider>
      <EntryForm initialCard="Esper Sentinel" initialPrice="74.99" />
      <ResultSlot>
        <Suspense key={paramsKey} fallback={<PanelSkeleton />}>
          {error ? (
            <div role="alert">
              <RetryButton />
            </div>
          ) : (
            <SelectionControls {...controls} />
          )}
        </Suspense>
      </ResultSlot>
    </ResultNavigationProvider>
  );
}

const printingButton = () =>
  screen.getByRole("button", {
    name: new RegExp(`^${UI_COPY.printingLabel}`),
  });
const finishButton = () =>
  screen.getByRole("button", { name: new RegExp(`^${UI_COPY.finishLabel}`) });
const skeleton = () => screen.queryByRole("status", { name: LOADING_LABEL });

/** Opens a control's list and clicks the option with that name. */
async function choose(button: HTMLElement, name: string) {
  await act(async () => {
    fireEvent.click(button);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name }));
  });
}

describe("one push per commit (T12, AC-5, AC-6)", () => {
  test("from a default render at ?price=74.99, choosing Foil pushes the shown printing's id with foil", async () => {
    render(<Page paramsKey="k" controls={shown(MH2_12_ID, "normal")} />);
    await choose(finishButton(), "Foil");
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `?price=74.99&finish=foil&printing=${MH2_12_ID}`,
    );
  });

  test("from mh2 #12 / Normal, choosing sld #2123 (foil only) pushes foil", async () => {
    render(<Page paramsKey="k" controls={shown(MH2_12_ID, "normal")} />);
    await choose(printingButton(), "Secret Lair Drop (SLD) · #2123");
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `?price=74.99&finish=foil&printing=${SLD_2123_ID}`,
    );
  });

  test("choosing plst (normal only) from Foil pushes normal", async () => {
    render(<Page paramsKey="k" controls={shown(MH2_12_ID, "foil")} />);
    await choose(printingButton(), "The List (PLST) · #MH2-12");
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `?price=74.99&finish=normal&printing=${PLST_ID}`,
    );
  });

  test("the URL's price is kept verbatim; other params are dropped", async () => {
    url.search = `price=%2474.99&finish=normal&printing=${MH2_12_ID}&utm_source=x`;
    render(<Page paramsKey="k" controls={shown(MH2_12_ID, "normal")} />);
    await choose(printingButton(), "Modern Horizons 2 (MH2) · #328");
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `?price=%2474.99&finish=normal&printing=${MH2_328_ID}`,
    );
  });

  test("choosing the shown printing or the shown finish pushes nothing", async () => {
    render(<Page paramsKey="k" controls={shown(MH2_12_ID, "normal")} />);
    await choose(printingButton(), "Modern Horizons 2 (MH2) · #12");
    await choose(finishButton(), "Normal");
    expect(router.push).not.toHaveBeenCalled();
    expect(skeleton()).toBeNull();
  });

  test("three ArrowDown presses push nothing; Enter then pushes exactly once", async () => {
    render(<Page paramsKey="k" controls={shown(SLD_2123_ID, "foil")} />);
    printingButton().focus();
    const key = (k: string) =>
      act(async () => {
        fireEvent.keyDown(document.activeElement!, { key: k });
      });
    await key("ArrowDown");
    await key("ArrowDown");
    await key("ArrowDown");
    await key("ArrowDown");
    expect(router.push).not.toHaveBeenCalled();
    await key("Enter");
    // sld → plst → mh2 #12 → mh2 #328; foil kept, mh2 #328 offers it.
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `?price=74.99&finish=foil&printing=${MH2_328_ID}`,
    );
  });

  test("a switch writes no submit marker", async () => {
    render(<Page paramsKey="k" controls={shown(MH2_12_ID, "normal")} />);
    await choose(finishButton(), "Foil");
    expect(router.push).toHaveBeenCalledOnce();
    const keys = Array.from({ length: window.sessionStorage.length }, (_, i) =>
      window.sessionStorage.key(i),
    );
    expect(keys.filter((k) => k?.startsWith("mm:submit:"))).toEqual([]);
  });
});

describe("the shared transition and focus (T12, AC-5, AC-12)", () => {
  test("a switch shows the skeleton at once, with both selector slots; the previous controls are gone", async () => {
    const nav = pendingNavigation();
    router.push.mockImplementation(() => nav.promise);
    render(<Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />);
    await choose(finishButton(), "Foil");
    const shownSkeleton = skeleton();
    expect(shownSkeleton).not.toBeNull();
    expect(
      shownSkeleton!.querySelectorAll(
        '.mm-selector-row > [data-skeleton-part="selector"]',
      ),
    ).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Printing/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Finish/ })).toBeNull();
    await nav.settle();
  });

  // As in the app, the new route tree arrives inside the transition: the
  // page re-renders with the new key while the slot still shows the
  // skeleton, and the new controls mount only when the navigation settles.
  test("after a finish switch the remounted Finish button has focus, the Printing button does not", async () => {
    const nav = pendingNavigation();
    router.push.mockImplementation(() => nav.promise);
    const { rerender } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    const before = finishButton();
    await choose(before, "Foil");
    url.search = `price=74.99&finish=foil&printing=${MH2_12_ID}`;
    rerender(<Page paramsKey="b" controls={shown(MH2_12_ID, "foil")} />);
    expect(skeleton()).not.toBeNull();
    await nav.settle();
    expect(skeleton()).toBeNull();
    expect(finishButton()).not.toBe(before);
    expect(finishButton()).toHaveTextContent("Foil");
    expect(document.activeElement).toBe(finishButton());
    expect(document.activeElement).not.toBe(printingButton());
  });

  test("after a printing switch the remounted Printing button has focus", async () => {
    const nav = pendingNavigation();
    router.push.mockImplementation(() => nav.promise);
    const { rerender } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    await choose(printingButton(), "Secret Lair Drop (SLD) · #2123");
    rerender(<Page paramsKey="b" controls={shown(SLD_2123_ID, "foil")} />);
    await nav.settle();
    expect(document.activeElement).toBe(printingButton());
    expect(printingButton()).toHaveTextContent(
      "Secret Lair Drop (SLD) · #2123",
    );
    expect(document.activeElement).not.toBe(finishButton());
  });

  test("the request is taken once: a later remount takes no focus", async () => {
    const nav = pendingNavigation();
    router.push.mockImplementation(() => nav.promise);
    const { rerender } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    await choose(finishButton(), "Foil");
    rerender(<Page paramsKey="b" controls={shown(MH2_12_ID, "foil")} />);
    await nav.settle();
    expect(document.activeElement).toBe(finishButton());
    finishButton().blur();
    rerender(<Page paramsKey="c" controls={shown(MH2_12_ID, "foil")} />);
    expect(document.activeElement).toBe(document.body);
  });

  test("a form-initiated navigation clears the request, so a later mount takes no focus", async () => {
    const toError = pendingNavigation();
    const toResult = pendingNavigation();
    router.push
      .mockImplementationOnce(() => toError.promise)
      .mockImplementationOnce(() => toResult.promise);
    const { rerender, container } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    await choose(finishButton(), "Foil");
    // The switch lands on an error panel: no selectors take the request.
    rerender(<Page paramsKey="b" controls={shown(MH2_12_ID, "foil")} error />);
    await toError.settle();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Your price" }), {
      target: { value: "70" },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(router.push).toHaveBeenLastCalledWith("/Esper%20Sentinel?price=70");
    rerender(<Page paramsKey="c" controls={shown(MH2_12_ID, "normal")} />);
    await toResult.settle();
    expect(printingButton()).toBeInTheDocument();
    expect(document.activeElement).not.toBe(finishButton());
    expect(document.activeElement).not.toBe(printingButton());
  });

  test("without the form's navigation the same path does take focus (control for the test above)", async () => {
    const toError = pendingNavigation();
    router.push.mockImplementationOnce(() => toError.promise);
    const { rerender } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    await choose(finishButton(), "Foil");
    rerender(<Page paramsKey="b" controls={shown(MH2_12_ID, "foil")} error />);
    await toError.settle();
    rerender(<Page paramsKey="c" controls={shown(MH2_12_ID, "foil")} />);
    expect(document.activeElement).toBe(finishButton());
  });

  test("a refresh clears the request too", async () => {
    const toError = pendingNavigation();
    const refreshed = pendingNavigation();
    router.push.mockImplementationOnce(() => toError.promise);
    router.refresh.mockImplementationOnce(() => refreshed.promise);
    const { rerender } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    await choose(printingButton(), "The List (PLST) · #MH2-12");
    rerender(<Page paramsKey="b" controls={shown(PLST_ID, "normal")} error />);
    await toError.settle();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(router.refresh).toHaveBeenCalledOnce();
    rerender(<Page paramsKey="b2" controls={shown(PLST_ID, "normal")} />);
    await refreshed.settle();
    expect(printingButton()).toBeInTheDocument();
    expect(document.activeElement).not.toBe(printingButton());
    expect(document.activeElement).not.toBe(finishButton());
  });
});
