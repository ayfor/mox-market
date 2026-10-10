// T17 (AC-8; S2.1d10): submitting above a result swaps the previous panel
// for the skeleton in the same render, and the new panel replaces it when
// the navigation settles. The retry button shares the transition.
import { EntryForm } from "@/components/entry-form";
import { ResultNavigationProvider } from "@/components/result-navigation";
import { LOADING_LABEL } from "@/lib/copy/result-labels";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PanelSkeleton } from "./panel-skeleton";
import { ResultSlot } from "./result-slot";
import { RetryButton } from "./retry-button";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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
    router.push.mockImplementation(() => new Promise(() => {}));
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
