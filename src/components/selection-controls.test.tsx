// T12 (AC-5, AC-6, AC-11, AC-12): SelectionControls' single change handler.
// A commit pushes one query-only href inside the shared transition (the slot
// shows the skeleton at once), keeps the URL's price, never re-defaults the
// other control, writes no submit marker, and returns focus to the control
// that changed when the selectors remount on the switch's page. Any other
// navigation or a refresh clears that request; a switch that lands on the
// error panel focuses Retry, and selectors on another page take no focus
// (ADV-2). A switch resets the form's unsubmitted edits (ADV-6).
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
import {
  ResultNavigationProvider,
  useResultNavigation,
} from "./result-navigation";
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

/**
 * A settled panel without selectors or Retry (a lookup miss or the invalid
 * view stands in), with a probe that refreshes inside the shared transition.
 */
function NoControlsPanel() {
  const { refresh } = useResultNavigation();
  return (
    <div role="note">
      <button type="button" onClick={() => refresh()}>
        probe refresh
      </button>
    </div>
  );
}

/** page.tsx's shape: the form, then the slot with the keyed Suspense. */
function Page({
  paramsKey,
  controls,
  error = false,
  panel = error ? "error" : "controls",
  initialPrinting,
}: {
  paramsKey: string;
  controls: SelectionControlsProps;
  error?: boolean;
  panel?: "controls" | "error" | "none";
  initialPrinting?: string;
}) {
  return (
    <ResultNavigationProvider>
      <EntryForm
        initialCard="Esper Sentinel"
        initialPrice="74.99"
        initialPrinting={initialPrinting}
      />
      <ResultSlot>
        <Suspense key={paramsKey} fallback={<PanelSkeleton />}>
          {panel === "error" ? (
            <div role="alert">
              <RetryButton />
            </div>
          ) : panel === "none" ? (
            <NoControlsPanel />
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
/** A switch keeps the scroll position (S2.3 Deviation 3). */
const KEEP_SCROLL = { scroll: false };

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
      KEEP_SCROLL,
    );
  });

  test("from mh2 #12 / Normal, choosing sld #2123 (foil only) pushes foil", async () => {
    render(<Page paramsKey="k" controls={shown(MH2_12_ID, "normal")} />);
    await choose(printingButton(), "Secret Lair Drop (SLD) · #2123");
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `?price=74.99&finish=foil&printing=${SLD_2123_ID}`,
      KEEP_SCROLL,
    );
  });

  test("choosing plst (normal only) from Foil pushes normal", async () => {
    render(<Page paramsKey="k" controls={shown(MH2_12_ID, "foil")} />);
    await choose(printingButton(), "The List (PLST) · #MH2-12");
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `?price=74.99&finish=normal&printing=${PLST_ID}`,
      KEEP_SCROLL,
    );
  });

  test("the URL's price is kept verbatim; other params are dropped", async () => {
    url.search = `price=%2474.99&finish=normal&printing=${MH2_12_ID}&utm_source=x`;
    render(<Page paramsKey="k" controls={shown(MH2_12_ID, "normal")} />);
    await choose(printingButton(), "Modern Horizons 2 (MH2) · #328");
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `?price=%2474.99&finish=normal&printing=${MH2_328_ID}`,
      KEEP_SCROLL,
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
      KEEP_SCROLL,
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

  test("a switch that lands on the error panel focuses Retry and spends the request: a later Back or Forward takes no focus (ADV-2)", async () => {
    const toError = pendingNavigation();
    router.push.mockImplementationOnce(() => toError.promise);
    const { rerender } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    await choose(finishButton(), "Foil");
    url.search = `price=74.99&finish=foil&printing=${MH2_12_ID}`;
    rerender(<Page paramsKey="b" controls={shown(MH2_12_ID, "foil")} error />);
    await toError.settle();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Retry" }),
    );
    // Forward to the switch's own selection, then Back to the one before.
    rerender(<Page paramsKey="b2" controls={shown(MH2_12_ID, "foil")} />);
    expect(document.activeElement).not.toBe(printingButton());
    expect(document.activeElement).not.toBe(finishButton());
    url.search = "price=74.99";
    rerender(<Page paramsKey="a2" controls={shown(MH2_12_ID, "normal")} />);
    expect(document.activeElement).not.toBe(printingButton());
    expect(document.activeElement).not.toBe(finishButton());
  });

  test("Retry takes no focus on an error panel no switch led to", async () => {
    render(<Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} error />);
    expect(document.activeElement).toBe(document.body);
  });

  test("selectors focus only on the page the switch pushed: a Back to another selection takes no focus and spends the request (ADV-2)", async () => {
    const toPanel = pendingNavigation();
    router.push.mockImplementationOnce(() => toPanel.promise);
    const { rerender } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    await choose(finishButton(), "Foil");
    // The switch lands on a panel with no selectors and no Retry.
    rerender(
      <Page paramsKey="b" controls={shown(MH2_12_ID, "foil")} panel="none" />,
    );
    await toPanel.settle();
    expect(document.activeElement).toBe(document.body);
    // Back (popstate, outside the shared transition) to mh2 #12 / Normal.
    rerender(<Page paramsKey="a2" controls={shown(MH2_12_ID, "normal")} />);
    expect(document.activeElement).toBe(document.body);
    // Forward to the switch's page: the request is already spent.
    rerender(<Page paramsKey="b2" controls={shown(MH2_12_ID, "foil")} />);
    expect(document.activeElement).toBe(document.body);
  });

  test("a request no panel took focuses the selectors that show the switch's selection (control for the two tests below)", async () => {
    const toPanel = pendingNavigation();
    router.push.mockImplementationOnce(() => toPanel.promise);
    const { rerender } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    await choose(finishButton(), "Foil");
    rerender(
      <Page paramsKey="b" controls={shown(MH2_12_ID, "foil")} panel="none" />,
    );
    await toPanel.settle();
    rerender(<Page paramsKey="b2" controls={shown(MH2_12_ID, "foil")} />);
    expect(document.activeElement).toBe(finishButton());
  });

  test("a form-initiated navigation clears the request, so a later mount takes no focus", async () => {
    const toPanel = pendingNavigation();
    const toResult = pendingNavigation();
    router.push
      .mockImplementationOnce(() => toPanel.promise)
      .mockImplementationOnce(() => toResult.promise);
    const { rerender, container } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    await choose(finishButton(), "Foil");
    rerender(
      <Page paramsKey="b" controls={shown(MH2_12_ID, "foil")} panel="none" />,
    );
    await toPanel.settle();
    fireEvent.change(screen.getByRole("textbox", { name: "Your price" }), {
      target: { value: "70" },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(router.push).toHaveBeenLastCalledWith("/Esper%20Sentinel?price=70");
    // Selectors showing the switch's selection, which would take a live request.
    rerender(<Page paramsKey="c" controls={shown(MH2_12_ID, "foil")} />);
    await toResult.settle();
    expect(printingButton()).toBeInTheDocument();
    expect(document.activeElement).not.toBe(finishButton());
    expect(document.activeElement).not.toBe(printingButton());
  });

  test("a refresh clears the request too", async () => {
    const toPanel = pendingNavigation();
    const refreshed = pendingNavigation();
    router.push.mockImplementationOnce(() => toPanel.promise);
    router.refresh.mockImplementationOnce(() => refreshed.promise);
    const { rerender } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    await choose(printingButton(), "The List (PLST) · #MH2-12");
    rerender(
      <Page paramsKey="b" controls={shown(PLST_ID, "normal")} panel="none" />,
    );
    await toPanel.settle();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "probe refresh" }));
    });
    expect(router.refresh).toHaveBeenCalledOnce();
    rerender(<Page paramsKey="b2" controls={shown(PLST_ID, "normal")} />);
    await refreshed.settle();
    expect(printingButton()).toBeInTheDocument();
    expect(document.activeElement).not.toBe(printingButton());
    expect(document.activeElement).not.toBe(finishButton());
  });
});

describe("unsubmitted form edits on a switch (ADV-6, S2.3d13)", () => {
  const priceField = () => screen.getByRole("textbox", { name: "Your price" });
  const cardField = () => screen.getByRole("combobox", { name: "Card" });

  test("a price typed but not submitted: the switch pushes the URL's price and the field shows it again", async () => {
    const nav = pendingNavigation();
    router.push.mockImplementation(() => nav.promise);
    const { rerender } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    fireEvent.change(priceField(), { target: { value: "70" } });
    fireEvent.change(cardField(), { target: { value: "Esper Charm" } });
    await choose(finishButton(), "Foil");
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `?price=74.99&finish=foil&printing=${MH2_12_ID}`,
      KEEP_SCROLL,
    );
    expect(priceField()).toHaveValue("74.99");
    expect(cardField()).toHaveValue("Esper Sentinel");
    url.search = `price=74.99&finish=foil&printing=${MH2_12_ID}`;
    rerender(<Page paramsKey="b" controls={shown(MH2_12_ID, "foil")} />);
    await nav.settle();
    expect(priceField()).toHaveValue("74.99");
    expect(cardField()).toHaveValue("Esper Sentinel");
  });

  test("an edit typed while the switch loads survives the landing (S2.4 ADV-8)", async () => {
    const nav = pendingNavigation();
    router.push.mockImplementation(() => nav.promise);
    const { rerender } = render(
      <Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />,
    );
    await choose(finishButton(), "Foil");
    fireEvent.change(priceField(), { target: { value: "80" } });
    rerender(<Page paramsKey="b" controls={shown(MH2_12_ID, "foil")} />);
    await nav.settle();
    expect(priceField()).toHaveValue("80");
  });
});

describe("the form's Set picker follows the URL's printing (UI patch review UI-4)", () => {
  const priceField = () => screen.getByRole("textbox", { name: "Your price" });
  const setButton = () => screen.getByRole("button", { name: /^Set/ });
  const send = () => fireEvent.submit(priceField().closest("form")!);

  beforeEach(() => {
    // The Set picker's mount lookup: the route answers no printings here.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [] })),
    );
    return () => vi.unstubAllGlobals();
  });

  test("a printing switch moves the set to the new URL printing, never to Any set, so a price-only resubmit keeps the shown printing", async () => {
    const nav = pendingNavigation();
    router.push.mockImplementation(() => nav.promise);
    const { rerender } = render(
      <Page
        paramsKey="a"
        controls={shown(MH2_12_ID, "normal")}
        initialPrinting={MH2_12_ID}
      />,
    );
    await choose(printingButton(), "Modern Horizons 2 (MH2) · #328");
    url.search = `price=74.99&finish=normal&printing=${MH2_328_ID}`;
    rerender(
      <Page
        paramsKey="b"
        controls={shown(MH2_328_ID, "normal")}
        initialPrinting={MH2_328_ID}
      />,
    );
    await nav.settle();
    router.push.mockReset();
    fireEvent.change(priceField(), { target: { value: "70" } });
    send();
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `/Esper%20Sentinel?price=70&printing=${MH2_328_ID}`,
    );
    expect(setButton()).toBeInTheDocument();
  });

  test("with no printing in the URL the set reads Any set and a resubmit adds none", async () => {
    render(<Page paramsKey="a" controls={shown(MH2_12_ID, "normal")} />);
    await vi.waitFor(() => expect(setButton()).toHaveTextContent("Any set"));
    fireEvent.change(priceField(), { target: { value: "70" } });
    send();
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      "/Esper%20Sentinel?price=70",
    );
  });
});
