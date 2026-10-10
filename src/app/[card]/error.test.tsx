// ADV-4: the result route's error boundary. A render that throws after the
// streamed 200 shows the same error panel and Retry as ResultView's error
// state, never Next's generic crash.
import { FORM_LABELS } from "@/lib/copy/result-labels";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import ResultError from "./error";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/Esper%20Sentinel",
}));

beforeEach(() => {
  router.refresh.mockReset();
});

/** A stand-in for Next's boundary: renders error.tsx when a child throws. */
class Boundary extends Component<
  { children: ReactNode; reset: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <ResultError reset={this.props.reset} />
    ) : (
      this.props.children
    );
  }
}

function ThrowingPanel(): ReactNode {
  throw new TypeError(
    "Cannot read properties of undefined (reading 'toUpperCase')",
  );
}

describe("the result route's error boundary (ADV-4)", () => {
  test("a panel that throws renders the error panel with Retry, nothing partial", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Boundary reset={vi.fn()}>
        <ThrowingPanel />
      </Boundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(UI_COPY.errorPanel);
    expect(alert).toHaveAttribute("data-status", "error");
    expect(
      screen.getByRole("button", { name: FORM_LABELS.retry }),
    ).toBeEnabled();
    expect(document.querySelector(".mm-rec-panel")).toBeNull();
    expect(document.querySelector(".mm-rec-disclaimer")).toBeNull();
  });

  test("Retry refreshes the route and resets the boundary once", async () => {
    const reset = vi.fn();
    render(<ResultError reset={reset} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: FORM_LABELS.retry }));
    });
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
  });
});
