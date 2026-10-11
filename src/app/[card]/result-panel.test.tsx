// T22 (AC-14; C1.32): with the reader rejecting, or answering after 501 ms,
// and freshness failing the same way, ResultPanel still resolves (so the
// streamed page stays 200) and renders the insufficient panel with the
// unavailable note and the banner, never the error panel. S2.4 adds T13's
// panel half (AC-8: every lookup failure resolves to the error panel) and
// T18 (AC-13: the demo link renders a panel whatever kind the market gives).
import {
  ESPER_SENTINEL_PRINTS,
  MH2_12_ID,
  scryfallCard,
} from "@/lib/__fixtures__/esper-sentinel-prints";
import type { EvaluationDeps } from "@/lib/evaluation/build-evaluation";
import {
  defaultHistoryReader,
  type PriceHistoryReader,
} from "@/lib/evaluation/history-reader";
import { parseResultParams } from "@/lib/evaluation/result-params";
import { dailyHistory } from "@/lib/recommendation/fixtures";
import { UI_COPY } from "@/lib/recommendation/ui-copy";
import { DEMO_RESULT_HREF } from "@/lib/result-href";
import { getAllPrintings, getCardByName } from "@/lib/scryfall";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ResultPanel } from "./result-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/throttle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/throttle")>();
  return { ...actual, throttle: () => Promise.resolve() };
});

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

describe("rows without a usable latestSnapshotAt (ADV-7)", () => {
  test.each<[string, unknown]>([
    ["a string", "2026-10-09"],
    ["null", null],
  ])(
    "latestSnapshotAt %s with 30 rows → buy, and the footer never says no history",
    async (_name, latestSnapshotAt) => {
      vi.useRealTimers();
      const { deps } = depsWith({
        getPriceHistory: async () =>
          ({ history: ROWS, latestSnapshotAt }) as unknown as Awaited<
            ReturnType<PriceHistoryReader["getPriceHistory"]>
          >,
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
      const footer = container.querySelector(".mm-data-footer")!;
      expect(footer).not.toHaveTextContent(UI_COPY.noHistory);
      expect(footer.querySelector(".mm-data-history")?.textContent).toBe(
        // The newest row is 2026-10-09, read as UTC midnight.
        "Price history: 30 snapshots, newest 36 hours ago",
      );
    },
  );
});

describe("every lookup failure resolves to the error panel (T13, AC-8)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.useRealTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.each<[string, () => Promise<Response>]>([
    [
      "503",
      async () => Response.json({ code: "x", details: "x" }, { status: 503 }),
    ],
    [
      "429",
      async () => Response.json({ code: "x", details: "x" }, { status: 429 }),
    ],
    [
      "an HTML 502",
      async () => new Response("<html>bad gateway</html>", { status: 502 }),
    ],
    ["a rejected fetch", () => Promise.reject(new TypeError("fetch failed"))],
  ])(
    "a named lookup answering %s: ResultPanel resolves (never throws) to the error panel, never a miss",
    async (_name, answer) => {
      fetchMock.mockImplementation(answer);
      const log = vi.fn();
      const element = await ResultPanel({
        query: { card: "jace", askingPriceCents: 500, finish: "normal" },
        deps: {
          scryfall: { getCardByName, getAllPrintings },
          reader: defaultHistoryReader,
          now: () => NOW,
          log,
        },
      });
      const { container } = render(element);
      expect(container.textContent).toContain(UI_COPY.errorPanel);
      expect(container.querySelector('[data-status="error"]')).not.toBeNull();
      expect(container).not.toHaveTextContent(UI_COPY.ambiguousCard);
      expect(container).not.toHaveTextContent(UI_COPY.cardNotFound);
      expect(container.querySelector(".mm-lookup-miss")).toBeNull();
      expect(log).toHaveBeenCalledWith("scryfall_failed", expect.anything());
    },
  );
});

describe("the demo link serves a panel, whatever the market says (T18, AC-13; C1.13 = C)", () => {
  /** One default printing at `usd`, and history flat at the same price. */
  const market = (usd: string) => ({
    prints: [
      scryfallCard({
        id: MH2_12_ID,
        prices: {
          usd,
          usd_foil: null,
          usd_etched: null,
          eur: null,
          eur_foil: null,
          tix: null,
        },
      }),
    ],
    reader: {
      getPriceHistory: async () => ({
        history: dailyHistory(
          "2026-10-10",
          Array(30).fill(Math.round(Number(usd) * 100)),
        ),
        latestSnapshotAt: NOW,
      }),
      getHistoryFreshness: async () => ({
        lastSuccessAt: NOW,
        sourceDate: "2026-10-09",
      }),
    } satisfies PriceHistoryReader,
  });

  const SCENARIOS: [string, ReturnType<typeof market> | "empty"][] = [
    ["a market well above the ask", market("90.00")],
    ["a market at the ask", market("74.99")],
    ["a market well below the ask", market("60.00")],
    ["no history (the empty reader, today's demo)", "empty"],
  ];

  test("the demo query is Esper Sentinel at 7499 cents, normal", () => {
    const [, segment, price] = /^\/([^?]+)\?price=(.+)$/.exec(
      DEMO_RESULT_HREF,
    )!;
    expect(parseResultParams(segment, { price })).toMatchObject({
      kind: "ok",
      card: "Esper Sentinel",
      askingPriceCents: 7499,
      finish: "normal",
    });
  });

  const kindsSeen = new Set<string>();

  test.each(SCENARIOS)("%s → a panel with a kind", async (_name, scenario) => {
    vi.useRealTimers();
    const deps: EvaluationDeps = {
      scryfall: {
        getCardByName: async () => scryfallCard(),
        getAllPrintings: async () =>
          scenario === "empty" ? [...ESPER_SENTINEL_PRINTS] : scenario.prints,
      },
      reader: scenario === "empty" ? defaultHistoryReader : scenario.reader,
      now: () => NOW,
      log: vi.fn(),
    };
    const element = await ResultPanel({
      query: {
        card: "Esper Sentinel",
        askingPriceCents: 7499,
        finish: "normal",
      },
      deps,
    });
    const { container } = render(element);
    const panel = container.querySelector(".mm-rec-panel");
    expect(panel).not.toBeNull();
    const kind = panel!.getAttribute("data-kind");
    expect(["buy", "fair", "wait", "insufficient_data"]).toContain(kind);
    expect(container.querySelector(".mm-card-name")?.textContent).toBe(
      "Esper Sentinel",
    );
    kindsSeen.add(kind!);
  });

  test("the scenarios between them reach every kind (the demo pins none)", () => {
    expect([...kindsSeen].sort()).toEqual([
      "buy",
      "fair",
      "insufficient_data",
      "wait",
    ]);
  });
});
