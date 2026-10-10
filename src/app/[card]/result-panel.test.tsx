// T22 (AC-14; C1.32): with the reader rejecting, or answering after 501 ms,
// and freshness failing the same way, ResultPanel still resolves (so the
// streamed page stays 200) and renders the insufficient panel with the
// unavailable note and the banner, never the error panel.
import {
  ESPER_SENTINEL_PRINTS,
  scryfallCard,
} from "@/lib/__fixtures__/esper-sentinel-prints";
import type { EvaluationDeps } from "@/lib/evaluation/build-evaluation";
import type { PriceHistoryReader } from "@/lib/evaluation/history-reader";
import { dailyHistory } from "@/lib/recommendation/fixtures";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ResultPanel } from "./result-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const NOW = new Date("2026-10-10T12:00:00.000Z");
const ROWS = dailyHistory("2026-10-10", Array(30).fill(5917));

function depsWith(reader: PriceHistoryReader) {
  const log = vi.fn();
  const deps: EvaluationDeps = {
    scryfall: {
      getCardByName: async () => scryfallCard(),
      getAllPrintings: async () => [...ESPER_SENTINEL_PRINTS],
    },
    reader,
    now: () => NOW,
    log,
  };
  return { deps, log };
}

const later = <T,>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const fixtures: [string, PriceHistoryReader][] = [
  [
    "rejects",
    {
      getPriceHistory: () => Promise.reject(new Error("connection refused")),
      getHistoryFreshness: () =>
        Promise.reject(new Error("connection refused")),
    },
  ],
  [
    "answers after 501 ms",
    {
      getPriceHistory: () =>
        later(501, { history: ROWS, latestSnapshotAt: NOW }),
      getHistoryFreshness: () =>
        later(501, { lastSuccessAt: NOW, sourceDate: "2026-10-09" }),
    },
  ],
];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ResultPanel under a failing reader (T22, AC-14)", () => {
  test.each(fixtures)(
    "a reader that %s: resolves to the degraded panel, two failures logged",
    async (_name, reader) => {
      const { deps, log } = depsWith(reader);
      const pending = ResultPanel({
        query: {
          card: "Esper Sentinel",
          askingPriceCents: 7499,
          finish: "normal",
        },
        deps,
      });
      await vi.advanceTimersByTimeAsync(501);
      const element = await pending;
      const { container } = render(element);
      const panel = container.querySelector(".mm-rec-panel")!;
      expect(panel).toHaveAttribute("data-kind", "insufficient_data");
      expect(panel.querySelector(".mm-rec-reason")?.textContent).toBe(
        UI_COPY.historyUnavailable,
      );
      expect(container.querySelector(".mm-stale-banner")?.textContent).toBe(
        UI_COPY.staleBanner,
      );
      expect(container).not.toHaveTextContent(UI_COPY.errorPanel);
      expect(container.querySelector('[data-status="error"]')).toBeNull();
      expect(log.mock.calls.map(([event]) => event).sort()).toEqual([
        "freshness_read_failed",
        "history_read_failed",
      ]);
    },
  );

  test("a healthy reader renders the computed recommendation", async () => {
    vi.useRealTimers();
    const { deps, log } = depsWith({
      getPriceHistory: async () => ({ history: ROWS, latestSnapshotAt: NOW }),
      getHistoryFreshness: async () => ({
        lastSuccessAt: NOW,
        sourceDate: "2026-10-09",
      }),
    });
    const element = await ResultPanel({
      query: {
        card: "Esper Sentinel",
        askingPriceCents: 5400,
        finish: "normal",
      },
      deps,
    });
    const { container } = render(element);
    expect(container.querySelector(".mm-rec-panel")).toHaveAttribute(
      "data-kind",
      "buy",
    );
    expect(container.querySelector(".mm-stale-banner")).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });
});
