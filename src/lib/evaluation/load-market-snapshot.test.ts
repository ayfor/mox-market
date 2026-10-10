// T7 (AC-12, AC-13; C1.21) and T8 (AC-14; C1.32): the applied finish, the
// reader's call arguments, the UTC asOf, and every degraded read.
import { scryfallCard } from "@/lib/__fixtures__/esper-sentinel-prints";
import { dailyHistory } from "@/lib/recommendation/fixtures";
import type { Finish, PriceSnapshot } from "@/lib/recommendation/types";
import type { ScryfallCard } from "@/types/scryfall";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  HistoryFreshness,
  PriceHistoryReader,
  PriceHistoryResult,
} from "./history-reader";
import { loadMarketSnapshot, utcDate } from "./load-market-snapshot";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const AS_OF = "2026-10-10";
const PRINTING_ID = "f3537373-ef54-4578-9d05-6216420ee349";

const priced = (usd: string | null, usd_foil: string | null): ScryfallCard =>
  scryfallCard({
    id: PRINTING_ID,
    prices: {
      usd,
      usd_foil,
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null,
    },
  });

const FRESH: HistoryFreshness = {
  lastSuccessAt: new Date("2026-10-10T06:00:00.000Z"),
  sourceDate: "2026-10-09",
};

/** A reader whose answers are given; both methods are spies. */
function readerOf(
  history: () => Promise<PriceHistoryResult>,
  freshness: () => Promise<HistoryFreshness> = async () => FRESH,
) {
  return {
    getPriceHistory: vi.fn<PriceHistoryReader["getPriceHistory"]>(history),
    getHistoryFreshness:
      vi.fn<PriceHistoryReader["getHistoryFreshness"]>(freshness),
  };
}

const rows = dailyHistory(AS_OF, Array(30).fill(5917));
const okHistory = async (): Promise<PriceHistoryResult> => ({
  history: rows,
  latestSnapshotAt: new Date("2026-10-10T06:00:00.000Z"),
});

const load = (
  printing: ScryfallCard,
  requestedFinish: "normal" | "foil",
  reader: PriceHistoryReader,
  log = vi.fn(),
  now = NOW,
) => loadMarketSnapshot({ printing, requestedFinish, reader, now, log });

describe("applied finish and reader calls (T7)", () => {
  test("foil requested, usd_foil null → normal applied, usd price, normal history read", async () => {
    const reader = readerOf(okHistory);
    const { market } = await load(priced("59.17", null), "foil", reader);
    expect(market.appliedFinish).toBe("normal");
    expect(market.currentPriceCents).toBe(5917);
    expect(reader.getPriceHistory).toHaveBeenCalledExactlyOnceWith(
      PRINTING_ID,
      "normal",
      AS_OF,
    );
  });

  test("foil requested and priced → foil applied, foil price, foil history read", async () => {
    const reader = readerOf(okHistory);
    const { market } = await load(priced("59.17", "76.47"), "foil", reader);
    expect(market.appliedFinish).toBe("foil");
    expect(market.currentPriceCents).toBe(7647);
    expect(reader.getPriceHistory).toHaveBeenCalledExactlyOnceWith(
      PRINTING_ID,
      "foil",
      AS_OF,
    );
  });

  test("normal requested, usd null, usd_foil set → normal applied, null price (no reverse fallback)", async () => {
    const reader = readerOf(okHistory);
    const { market } = await load(priced(null, "76.47"), "normal", reader);
    expect(market.appliedFinish).toBe("normal");
    expect(market.currentPriceCents).toBeNull();
    expect(reader.getPriceHistory.mock.calls[0][1]).toBe<Finish>("normal");
  });

  test("getHistoryFreshness is called once with no arguments", async () => {
    const reader = readerOf(okHistory);
    await load(priced("59.17", null), "normal", reader);
    expect(reader.getHistoryFreshness).toHaveBeenCalledExactlyOnceWith();
  });

  test("the reader's history reaches the snapshot unchanged, with source and asOf", async () => {
    const result: PriceHistoryResult = {
      history: rows,
      latestSnapshotAt: new Date("2026-10-09T06:00:00.000Z"),
    };
    const reader = readerOf(async () => result);
    const loaded = await load(priced("59.17", null), "normal", reader);
    expect(loaded.market.history).toBe(rows);
    expect(loaded.market).toEqual({
      appliedFinish: "normal",
      currentPriceCents: 5917,
      history: rows,
      asOf: AS_OF,
      source: "scryfall",
      latestSnapshotAt: result.latestSnapshotAt,
    });
    expect(loaded.historyUnavailable).toBe(false);
    expect(loaded.syncStale).toBe(false);
  });

  describe("asOf is the UTC date", () => {
    const original = process.env.TZ;
    beforeEach(() => {
      process.env.TZ = "America/Toronto";
    });
    afterEach(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });

    test("TZ=America/Toronto at 2026-10-10 23:30 local → 2026-10-11", async () => {
      const lateEvening = new Date(2026, 9, 10, 23, 30);
      expect(lateEvening.getDate()).toBe(10);
      expect(utcDate(lateEvening)).toBe("2026-10-11");
      const reader = readerOf(okHistory);
      const { market } = await load(
        priced("59.17", null),
        "normal",
        reader,
        vi.fn(),
        lateEvening,
      );
      expect(market.asOf).toBe("2026-10-11");
      expect(reader.getPriceHistory.mock.calls[0][2]).toBe("2026-10-11");
    });
  });
});

describe("degraded reads (T8)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const never = <T>() => new Promise<T>(() => {});
  const after = <T>(ms: number, value: T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

  test.each([
    ["a rejected history read", () => Promise.reject(new Error("db down"))],
    [
      "a history read answering at 501 ms",
      () => after(501, { history: rows, latestSnapshotAt: null }),
    ],
  ])(
    "%s → empty history, null latestSnapshotAt, historyUnavailable, one log entry",
    async (_name, history) => {
      const log = vi.fn();
      const reader = readerOf(history as () => Promise<PriceHistoryResult>);
      const pending = load(priced("59.17", null), "normal", reader, log);
      await vi.advanceTimersByTimeAsync(501);
      const loaded = await pending;
      expect(loaded.market.history).toEqual([]);
      expect(loaded.market.latestSnapshotAt).toBeNull();
      expect(loaded.historyUnavailable).toBe(true);
      expect(loaded.syncStale).toBe(false);
      expect(log).toHaveBeenCalledOnce();
      expect(log.mock.calls[0][0]).toBe("history_read_failed");
    },
  );

  test.each([
    ["a rejected freshness read", () => Promise.reject(new Error("db down"))],
    ["a freshness read never answering", () => never<HistoryFreshness>()],
  ])("%s → syncStale and its own log entry", async (_name, freshness) => {
    const log = vi.fn();
    const reader = readerOf(okHistory, freshness);
    const pending = load(priced("59.17", null), "normal", reader, log);
    await vi.advanceTimersByTimeAsync(500);
    const loaded = await pending;
    expect(loaded.syncStale).toBe(true);
    expect(loaded.historyUnavailable).toBe(false);
    expect(loaded.market.history).toBe(rows);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toBe("freshness_read_failed");
  });

  test("both reads start together: two 400 ms reads finish at 400 ms", async () => {
    const reader = readerOf(
      () => after(400, { history: rows, latestSnapshotAt: null }),
      () => after(400, FRESH),
    );
    let done = false;
    const pending = load(priced("59.17", null), "normal", reader).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(399);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    const loaded = await pending;
    expect(loaded.historyUnavailable).toBe(false);
    expect(loaded.syncStale).toBe(false);
  });

  test("both failing: the page still gets a snapshot, two log entries", async () => {
    const log = vi.fn();
    const reader = readerOf(
      () => Promise.reject(new Error("a")),
      () => never<HistoryFreshness>(),
    );
    const pending = load(priced("59.17", null), "normal", reader, log);
    await vi.advanceTimersByTimeAsync(500);
    const loaded = await pending;
    expect(loaded.historyUnavailable).toBe(true);
    expect(loaded.syncStale).toBe(true);
    expect(log.mock.calls.map(([event]) => event).sort()).toEqual([
      "freshness_read_failed",
      "history_read_failed",
    ]);
  });

  test.each<[string, unknown]>([
    ["history not an array", { history: "rows", latestSnapshotAt: null }],
    ["null", null],
    ["a string", "rows"],
  ])(
    "a malformed result (%s) counts as a failed read",
    async (_name, value) => {
      const log = vi.fn();
      const reader = readerOf(async () => value as PriceHistoryResult);
      const loaded = await load(priced("59.17", null), "normal", reader, log);
      expect(loaded.historyUnavailable).toBe(true);
      expect(loaded.market.history).toEqual([]);
      expect(log).toHaveBeenCalledOnce();
    },
  );

  test("a latestSnapshotAt that is not a valid Date becomes null", async () => {
    for (const latest of [new Date("nope"), "2026-10-09", 12345]) {
      const reader = readerOf(
        async () =>
          ({
            history: rows,
            latestSnapshotAt: latest,
          }) as unknown as PriceHistoryResult,
      );
      const loaded = await load(priced("59.17", null), "normal", reader);
      expect(loaded.market.latestSnapshotAt).toBeNull();
      expect(loaded.historyUnavailable).toBe(false);
    }
  });

  test("a lastSuccessAt that is not a valid Date, or null, counts as stale", async () => {
    for (const lastSuccessAt of [
      new Date("nope"),
      "2026-10-09T06:00:00Z",
      null,
    ]) {
      const reader = readerOf(
        okHistory,
        async () =>
          ({ lastSuccessAt, sourceDate: null }) as unknown as HistoryFreshness,
      );
      const loaded = await load(priced("59.17", null), "normal", reader);
      expect(loaded.syncStale).toBe(true);
    }
  });

  test("a sync over 48 h old is stale; a recent one is not", async () => {
    const at = (iso: string) =>
      readerOf(okHistory, async () => ({
        lastSuccessAt: new Date(iso),
        sourceDate: null,
      }));
    expect(
      (
        await load(
          priced("1.00", null),
          "normal",
          at("2026-10-08T11:59:59.999Z"),
        )
      ).syncStale,
    ).toBe(true);
    expect(
      (
        await load(
          priced("1.00", null),
          "normal",
          at("2026-10-08T12:00:00.000Z"),
        )
      ).syncStale,
    ).toBe(false);
  });

  test("log entries carry an event name and the error, never a URL", async () => {
    const log = vi.fn();
    const reader = readerOf(() => Promise.reject(new Error("x")));
    await load(priced("59.17", null), "normal", reader, log);
    const [event] = log.mock.calls[0];
    expect(event).toMatch(/^[a-z_]+$/);
  });
});

describe("history rows are passed untouched (C1.22)", () => {
  test("rows out of order or duplicated reach the engine as the reader sent them", async () => {
    const odd: PriceSnapshot[] = [
      { date: "2026-10-09", priceCents: 100 },
      { date: "2026-10-08", priceCents: 200 },
      { date: "2026-10-09", priceCents: 300 },
    ];
    const reader = readerOf(async () => ({
      history: odd,
      latestSnapshotAt: null,
    }));
    const { market } = await load(priced("1.00", null), "normal", reader);
    expect(market.history).toBe(odd);
    expect(market.history).toEqual([
      { date: "2026-10-09", priceCents: 100 },
      { date: "2026-10-08", priceCents: 200 },
      { date: "2026-10-09", priceCents: 300 },
    ]);
  });
});
