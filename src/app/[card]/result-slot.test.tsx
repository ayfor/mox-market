// T17 (AC-8; S2.1d10): submitting above a result swaps the previous panel
// for the skeleton in the same render, and the new panel replaces it when
// the navigation settles. The retry button shares the transition. S2.3's
// T15 (AC-12, AC-5): a selector switch does the same, and the skeleton keeps
// both selector slots in the selector row, and the stale banner the last
// panel showed (ADV-1).
import { EntryForm } from "@/components/entry-form";
import { ResultNavigationProvider } from "@/components/result-navigation";
import { SelectionControls } from "@/components/selection-controls";
import {
  MH2_12_ID,
  MH2_328_ID,
  scryfallCard,
} from "@/lib/__fixtures__/esper-sentinel-prints";
import { LOADING_LABEL } from "@/lib/copy/result-labels";
import type { Evaluation } from "@/lib/evaluation/build-evaluation";
import {
  computeTieredRecommendation,
  servedRecommendation,
} from "@/lib/recommendation/engine";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Suspense, use } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PanelSkeleton } from "./panel-skeleton";
import { ResultSlot, SlotSkeleton } from "./result-slot";
import { ResultView } from "./result-view";
import { RetryButton } from "./retry-button";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams("price=54.00"),
}));

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});

/** A navigation that stays pending until `settle` is called. */
function pendingNavigation() {
  let settle: () => void = () => {};
  const promise = new Promise<void>((resolve) => (settle = resolve));
  return { promise, settle: () => act(async () => settle()) };
}

/** A buy panel stand-in, as ResultView renders it. */
const BuyPanel = ({ reason }: { reason: string }) => (
  <section className="mm-rec-panel" data-kind="buy">
    <span className="mm-rec-badge mm-rec-badge--buy">Buy</span>
    <p className="mm-rec-reason">{reason}</p>
    <ul className="mm-rec-tiles">
      <li className="mm-rec-tile" />
    </ul>
  </section>
);

function Page({ paramsKey, reason }: { paramsKey: string; reason: string }) {
  return (
    <ResultNavigationProvider>
      <EntryForm initialCard="Esper Sentinel" initialPrice="54.00" />
      <ResultSlot>
        <Suspense key={paramsKey} fallback={<PanelSkeleton />}>
          <BuyPanel reason={reason} />
        </Suspense>
      </ResultSlot>
    </ResultNavigationProvider>
  );
}

const skeleton = () => screen.queryByRole("status", { name: LOADING_LABEL });

describe("pending state (T17, AC-8)", () => {
  test("submit swaps the previous panel for the skeleton in the same render", async () => {
    const nav = pendingNavigation();
    router.push.mockImplementation(() => nav.promise);
    const { container, rerender } = render(
      <Page paramsKey="Esper Sentinel|5400|normal" reason="9% below market." />,
    );
    expect(screen.getByText("9% below market.")).toBeInTheDocument();
    expect(skeleton()).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Your price" }), {
      target: { value: "65.00" },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });

    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      "/Esper%20Sentinel?price=65.00",
    );
    const shown = skeleton();
    expect(shown).not.toBeNull();
    expect(shown).toHaveAttribute("aria-busy", "true");
    expect(
      shown!.querySelectorAll('[data-skeleton-part="badge"]'),
    ).toHaveLength(1);
    expect(shown!.querySelectorAll('[data-skeleton-part="tile"]')).toHaveLength(
      4,
    );
    expect(
      shown!.querySelectorAll('[data-skeleton-part="selector"]'),
    ).toHaveLength(2);
    expect(screen.queryByText("9% below market.")).toBeNull();
    expect(container.querySelector(".mm-rec-badge")).toBeNull();
    expect(
      container.querySelector(".mm-rec-tile:not(.mm-skeleton-tile)"),
    ).toBeNull();

    await nav.settle();
    rerender(
      <Page
        paramsKey="Esper Sentinel|6500|normal"
        reason="10% above market."
      />,
    );
    expect(skeleton()).toBeNull();
    expect(screen.getByText("10% above market.")).toBeInTheDocument();
    expect(screen.queryByText("9% below market.")).toBeNull();
  });

  test("retry refreshes once inside the shared transition, showing the skeleton", async () => {
    const nav = pendingNavigation();
    router.refresh.mockImplementation(() => nav.promise);
    render(
      <ResultNavigationProvider>
        <ResultSlot>
          <div role="alert">
            <RetryButton />
          </div>
        </ResultSlot>
      </ResultNavigationProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(skeleton()).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    await nav.settle();
    expect(skeleton()).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  test("the skeleton has the panel's frame: image, heading, selector row, panel and tiles", () => {
    const { container } = render(<PanelSkeleton />);
    for (const selector of [
      ".mm-result-grid",
      ".mm-card-art",
      ".mm-card-heading",
      ".mm-selector-row",
      ".mm-rec-panel",
      ".mm-rec-tiles",
    ]) {
      expect(container.querySelector(selector), selector).not.toBeNull();
    }
  });
});

describe("submits while a result loads (ADV-8)", () => {
  /** page.tsx's shape: the form is not keyed, its initial values follow the URL. */
  function UrlPage({ price, paramsKey }: { price: string; paramsKey: string }) {
    return (
      <ResultNavigationProvider>
        <EntryForm initialCard="Esper Sentinel" initialPrice={price} />
        <ResultSlot>
          <Suspense key={paramsKey} fallback={<PanelSkeleton />}>
            <BuyPanel reason={paramsKey} />
          </Suspense>
        </ResultSlot>
      </ResultNavigationProvider>
    );
  }

  const priceField = () => screen.getByRole("textbox", { name: "Your price" });
  const evaluate = () => screen.getByRole("button", { name: "Evaluate" });
  const setPrice = (value: string) =>
    fireEvent.change(priceField(), { target: { value } });
  const submitForm = (container: HTMLElement) =>
    act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });

  test("a different query while pending supersedes it; Evaluate is aria-busy meanwhile", async () => {
    // Settled at the end: React 19 entangles every async transition with a
    // pending one, so a push left unresolved would keep later tests pending.
    const navs: ReturnType<typeof pendingNavigation>[] = [];
    router.push.mockImplementation(() => {
      const nav = pendingNavigation();
      navs.push(nav);
      return nav.promise;
    });
    const { container } = render(<UrlPage price="54.00" paramsKey="a" />);
    expect(evaluate()).not.toHaveAttribute("aria-busy");
    setPrice("65.00");
    await submitForm(container);
    expect(evaluate()).toHaveAttribute("aria-busy", "true");
    setPrice("70.00");
    await submitForm(container);
    expect(router.push.mock.calls.map(([href]) => href)).toEqual([
      "/Esper%20Sentinel?price=65.00",
      "/Esper%20Sentinel?price=70.00",
    ]);
    for (const nav of navs) await nav.settle();
  });

  test("an edit typed while the result loads survives the navigation landing", async () => {
    const nav = pendingNavigation();
    router.push.mockImplementation(() => nav.promise);
    const { container, rerender } = render(
      <UrlPage price="54.00" paramsKey="a" />,
    );
    setPrice("65.00");
    await submitForm(container);
    setPrice("70.00");
    await nav.settle();
    rerender(<UrlPage price="65.00" paramsKey="b" />);
    expect(priceField()).toHaveValue("70.00");
    expect(router.push).toHaveBeenCalledOnce();
  });

  test("unedited fields follow the URL: the submitted query, then back", async () => {
    const nav = pendingNavigation();
    router.push.mockImplementation(() => nav.promise);
    const { container, rerender } = render(
      <UrlPage price="54.00" paramsKey="a" />,
    );
    setPrice("$65");
    await submitForm(container);
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      "/Esper%20Sentinel?price=65",
    );
    await nav.settle();
    rerender(<UrlPage price="65" paramsKey="b" />);
    expect(priceField()).toHaveValue("65");
    rerender(<UrlPage price="54.00" paramsKey="a" />);
    expect(priceField()).toHaveValue("54.00");
  });
});

describe("a selector switch (T15, AC-5, AC-12)", () => {
  test("a pending switch shows the skeleton at once, two selector slots in .mm-selector-row; the previous panel and selectors are gone", async () => {
    const nav = pendingNavigation();
    router.push.mockImplementation(() => nav.promise);
    const { container } = render(
      <ResultNavigationProvider>
        <ResultSlot>
          <Suspense key="a" fallback={<PanelSkeleton />}>
            <div className="mm-result">
              <SelectionControls
                options={[
                  { id: "x", label: "Set X (X) · #1", finishes: ["normal"] },
                  { id: "y", label: "Set Y (Y) · #2", finishes: ["foil"] },
                ]}
                printingId="x"
                printingLabel="Set X (X) · #1"
                finish="normal"
                offeredFinishes={["normal"]}
              />
              <BuyPanel reason="9% below market." />
            </div>
          </Suspense>
        </ResultSlot>
      </ResultNavigationProvider>,
    );
    expect(container.querySelectorAll(".mm-selector")).toHaveLength(2);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Printing/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Set Y (Y) · #2" }));
    });
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      "?price=54.00&finish=foil&printing=y",
      { scroll: false },
    );
    const shown = skeleton();
    expect(shown).not.toBeNull();
    const row = shown!.querySelector(".mm-selector-row")!;
    expect(
      row.querySelectorAll('[data-skeleton-part="selector"]'),
    ).toHaveLength(2);
    expect(row.children).toHaveLength(2);
    expect(screen.queryByText("9% below market.")).toBeNull();
    expect(container.querySelector(".mm-selector")).toBeNull();
    expect(container.querySelector('[aria-haspopup="listbox"]')).toBeNull();
    await nav.settle();
  });

  test("the skeleton's selector slots are the row's only children, each a .mm-skeleton-selector", () => {
    const { container } = render(<PanelSkeleton />);
    const rows = container.querySelectorAll(".mm-selector-row");
    expect(rows).toHaveLength(1);
    const slots = [...rows[0].children];
    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      expect(slot).toHaveClass("mm-skeleton-block", "mm-skeleton-selector");
      expect(slot).toHaveAttribute("data-skeleton-part", "selector");
    }
  });
});

// --- S2.3 ADV-1: the stale banner survives a switch ------------------------
const NOW = new Date("2026-10-10T12:00:00.000Z");
const MH2_12 = scryfallCard({ id: MH2_12_ID });
const MH2_328 = scryfallCard({ id: MH2_328_ID, collector_number: "328" });

/** An ok insufficient_data evaluation of mh2 #12, as buildEvaluation returns it. */
function okEvaluation(
  syncStale: boolean,
): Extract<Evaluation, { status: "ok" }> {
  const tiers = computeTieredRecommendation(
    { askingPriceCents: 5400, cardId: MH2_12_ID, finish: "normal" },
    {
      appliedFinish: "normal",
      currentPriceCents: 5917,
      history: [],
      asOf: "2026-10-10",
      source: "scryfall",
      latestSnapshotAt: null,
    },
  );
  const recommendation = servedRecommendation(tiers);
  const option = (p: typeof MH2_12) => ({
    id: p.id,
    set: p.set,
    set_name: p.set_name,
    collector_number: p.collector_number,
    finishes: ["normal", "foil"] as const,
  });
  return {
    status: "ok",
    printing: MH2_12,
    selection: {
      options: [option(MH2_12), option(MH2_328)],
      printingId: MH2_12_ID,
      offeredFinishes: ["normal", "foil"],
    },
    requestedFinish: "normal",
    appliedFinish: "normal",
    recommendation,
    tiers,
    latestSnapshotAt: null,
    historyUnavailable: false,
    syncStale,
    now: NOW,
  };
}

/** A panel that never resolves, so the keyed Suspense shows its fallback. */
const NEVER = new Promise<never>(() => {});
function Streaming(): null {
  use(NEVER);
  return null;
}

/** page.tsx's slot: the real ResultView in a keyed Suspense whose fallback is SlotSkeleton. */
function SlotPage({
  paramsKey,
  evaluation,
  streaming = false,
}: {
  paramsKey: string;
  evaluation?: Evaluation;
  streaming?: boolean;
}) {
  return (
    <ResultNavigationProvider>
      <ResultSlot>
        <Suspense key={paramsKey} fallback={<SlotSkeleton />}>
          {streaming ? <Streaming /> : <ResultView evaluation={evaluation!} />}
        </Suspense>
      </ResultSlot>
    </ResultNavigationProvider>
  );
}

/** The class names of what sits above the result grid, in order. */
const aboveGrid = (root: Element) => {
  const grid = root.querySelector(":scope > .mm-result-grid");
  expect(grid).not.toBeNull();
  const above: string[] = [];
  for (
    let el = grid!.previousElementSibling;
    el;
    el = el.previousElementSibling
  )
    above.unshift(el.className);
  return above;
};

/** Commits Finish → Foil on the settled panel. */
async function switchToFoil() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Finish/ }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name: "Foil" }));
  });
}

describe("the stale banner across a switch (ADV-1, AC-12)", () => {
  test("PanelSkeleton keeps the banner only when asked, the same element and text, aria-hidden, before the grid", () => {
    const { container, rerender } = render(<PanelSkeleton />);
    expect(container.querySelector(".mm-stale-banner")).toBeNull();
    rerender(<PanelSkeleton staleBanner />);
    const root = container.querySelector(".mm-skeleton")!;
    expect(aboveGrid(root)).toEqual(["mm-stale-banner"]);
    const banner = root.querySelector(":scope > .mm-stale-banner")!;
    expect(banner.tagName).toBe("P");
    expect(banner).toHaveTextContent(UI_COPY.staleBanner);
    expect(banner).toHaveAttribute("aria-hidden", "true");
    expect(banner).not.toHaveAttribute("role");
  });

  // As in T12, the new route tree arrives inside the transition: the page
  // re-renders with the new key while the slot still shows its skeleton,
  // and the panel shows when the navigation settles. A Back or Forward
  // (popstate) is no transition of ours, so the keyed Suspense shows its
  // fallback, SlotSkeleton, while the panel streams.
  test("a switch from a panel with the banner: the pending skeleton holds it above the grid, as the panel the switch lands on does", async () => {
    const nav = pendingNavigation();
    router.push.mockImplementation(() => nav.promise);
    const { container, rerender } = render(
      <SlotPage paramsKey="a" evaluation={okEvaluation(true)} />,
    );
    const okPanel = () =>
      container.querySelector('.mm-result[data-status="ok"]');
    const settledAbove = aboveGrid(okPanel()!);
    expect(settledAbove).toEqual(["mm-stale-banner"]);

    await switchToFoil();
    expect(router.push).toHaveBeenCalledOnce();
    const pending = skeleton()!;
    expect(pending).not.toBeNull();
    expect(okPanel()).toBeNull();
    expect(aboveGrid(pending)).toEqual(settledAbove);
    expect(pending.querySelector(".mm-selector-row")).not.toBeNull();

    rerender(<SlotPage paramsKey="b" evaluation={okEvaluation(true)} />);
    expect(skeleton()).not.toBeNull();
    await nav.settle();
    expect(skeleton()).toBeNull();
    expect(aboveGrid(okPanel()!)).toEqual(settledAbove);
  });

  test("a Back or Forward while the panel streams: the Suspense fallback holds the banner too", () => {
    const { rerender } = render(
      <SlotPage paramsKey="a" evaluation={okEvaluation(true)} />,
    );
    rerender(<SlotPage paramsKey="c" streaming />);
    const fallback = skeleton()!;
    expect(fallback).not.toBeNull();
    expect(aboveGrid(fallback)).toEqual(["mm-stale-banner"]);
  });

  test("a switch from a panel without the banner reserves nothing, and the slot follows the latest panel", async () => {
    const first = pendingNavigation();
    router.push.mockImplementation(() => first.promise);
    const { rerender } = render(
      <SlotPage paramsKey="a" evaluation={okEvaluation(false)} />,
    );
    await switchToFoil();
    expect(aboveGrid(skeleton()!)).toEqual([]);

    // The switch lands on a panel with the banner; the next switch keeps it.
    rerender(<SlotPage paramsKey="b" evaluation={okEvaluation(true)} />);
    await first.settle();
    expect(skeleton()).toBeNull();
    const second = pendingNavigation();
    router.push.mockImplementation(() => second.promise);
    await switchToFoil();
    expect(aboveGrid(skeleton()!)).toEqual(["mm-stale-banner"]);
    rerender(<SlotPage paramsKey="c" evaluation={okEvaluation(false)} />);
    await second.settle();

    // And a fresh panel drops it again, for the pending skeleton and the fallback.
    const third = pendingNavigation();
    router.push.mockImplementation(() => third.promise);
    await switchToFoil();
    expect(aboveGrid(skeleton()!)).toEqual([]);
    await third.settle();
    rerender(<SlotPage paramsKey="d" streaming />);
    expect(aboveGrid(skeleton()!)).toEqual([]);
  });

  test("the first load's fallback has no banner: nothing has reported one yet", () => {
    render(<SlotPage paramsKey="a" streaming />);
    expect(aboveGrid(skeleton()!)).toEqual([]);
  });
});
