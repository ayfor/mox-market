// T17 (AC-12 c; S0.2d20, F0 Open Question 3): the basis sample. Seeded and
// deterministic, normal and foil only; a 404 or a missing Scryfall price is
// skipped and replaced from the reservoir; gap, medians and the 2% flag;
// requests go through src/lib/scryfall.ts (stubbed fetch, fake timers) at
// least 100 ms apart with the User-Agent and Accept headers, and Scryfall's
// price is F2's currentPriceCents source, priceCentsFor.
import type { ScryfallCard } from "@/types/scryfall";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  BASIS_FLAG_BP,
  BasisReservoir,
  gapBp,
  median,
  runBasisSample,
  seedFromDate,
  seededRandom,
} from "./basis";
import type { KeptSeries } from "./transform";

const sid = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const series = (
  n: number,
  cents = 1000,
  finish: KeptSeries["finish"] = "normal",
): KeptSeries => ({
  scryfallId: sid(n),
  finish,
  newestDate: "2026-10-10",
  newestCents: cents,
});
const card = (prices: Partial<ScryfallCard["prices"]>) =>
  ({
    prices: {
      usd: null,
      usd_foil: null,
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null,
      ...prices,
    },
  }) as ScryfallCard;

function reservoirOf(list: KeptSeries[], capacity = list.length, seed = 1) {
  const reservoir = new BasisReservoir(capacity, seed);
  for (const s of list) reservoir.offer(s);
  return reservoir;
}

describe("the reservoir (T17)", () => {
  test("is deterministic for a seed and varies with it", () => {
    const all = Array.from({ length: 500 }, (_, i) => series(i + 1));
    const ids = (seed: number) =>
      reservoirOf(all, 20, seed)
        .candidates()
        .map((s) => s.scryfallId);
    expect(ids(42)).toEqual(ids(42));
    expect(ids(42)).not.toEqual(ids(43));
    expect(new Set(ids(42)).size).toBe(20);
  });

  test("never holds an etched series", () => {
    const reservoir = reservoirOf(
      [series(1, 100, "etched"), series(2, 100, "foil"), series(3)],
      10,
    );
    expect(reservoir.candidates().map((s) => s.finish)).toEqual([
      "foil",
      "normal",
    ]);
    expect(reservoir.offered).toBe(2);
  });

  test("seededRandom is uniform-ish on [0, 1) and seedFromDate reads the date's digits", () => {
    const random = seededRandom(7);
    const draws = Array.from({ length: 1000 }, () => random());
    expect(draws.every((d) => d >= 0 && d < 1)).toBe(true);
    expect(median(draws)!).toBeGreaterThan(0.4);
    expect(median(draws)!).toBeLessThan(0.6);
    expect(seedFromDate("2026-10-10")).toBe(20261010);
    expect(seedFromDate(null)).toBe(1);
  });
});

describe("gap, medians and the flag (T17)", () => {
  test("gap = (MTGJson − Scryfall) ÷ Scryfall, in basis points", () => {
    expect(gapBp(1020, 1000)).toBe(200);
    expect(gapBp(980, 1000)).toBe(-200);
  });

  test("medians for odd and even samples", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  test.each([
    [10_200, false],
    [10_201, true],
  ])(
    "MTGJson %s cents against Scryfall 10,000: flagged %s (2.00%% is not, 2.01%% is)",
    async (mtgjson, flagged) => {
      const reservoir = reservoirOf([
        series(1, mtgjson),
        series(2, mtgjson),
        series(3, mtgjson),
      ]);
      const result = await runBasisSample(reservoir, 3, {
        today: "2026-10-11",
        fetchCard: async () => card({ usd: "100.00" }),
      });
      expect(result.flagged).toBe(flagged);
      expect(BASIS_FLAG_BP).toBe(200);
    },
  );

  test("median absolute and signed gaps over mixed signs", async () => {
    const prices: Record<string, string> = {
      [sid(1)]: "10.00", // MTGJson 10.50: +5%
      [sid(2)]: "10.00", // MTGJson 9.90: −1%
      [sid(3)]: "10.00", // MTGJson 10.20: +2%
      [sid(4)]: "10.00", // MTGJson 9.70: −3%
    };
    const reservoir = reservoirOf([
      series(1, 1050),
      series(2, 990),
      series(3, 1020),
      series(4, 970),
    ]);
    const result = await runBasisSample(reservoir, 4, {
      today: "2026-10-11",
      fetchCard: async (id) => card({ usd: prices[id] }),
    });
    expect(result.pairs.map((p) => p.gapBp)).toEqual([500, -100, 200, -300]);
    expect(result.medianAbsGapBp).toBe(250);
    expect(result.medianSignedGapBp).toBe(50);
    expect(result.flagged).toBe(true);
  });
});

describe("skips and replacements (T17)", () => {
  test("a 404, a null price and a failed request are skipped and replaced from the reservoir", async () => {
    const reservoir = reservoirOf([
      series(1),
      series(2),
      series(3),
      series(4),
      series(5),
    ]);
    const answers: Record<string, () => Promise<ScryfallCard | null>> = {
      [sid(1)]: async () => null,
      [sid(2)]: async () => card({ usd: null }),
      [sid(3)]: async () => {
        throw new Error("socket hang up");
      },
      [sid(4)]: async () => card({ usd: "10.00" }),
      [sid(5)]: async () => card({ usd: "10.00" }),
    };
    const result = await runBasisSample(reservoir, 2, {
      today: "2026-10-11",
      fetchCard: (id) => answers[id](),
    });
    expect(result.pairs.map((p) => p.scryfallId)).toEqual([sid(4), sid(5)]);
    expect([
      result.skippedNotFound,
      result.skippedNoPrice,
      result.skippedErrors,
    ]).toEqual([1, 1, 1]);
  });

  test("a foil series is compared with usd_foil, through priceCentsFor", async () => {
    const reservoir = reservoirOf([series(1, 500, "foil")]);
    const result = await runBasisSample(reservoir, 1, {
      today: "2026-10-11",
      fetchCard: async () => card({ usd: "1.00", usd_foil: "5.00" }),
    });
    expect(result.pairs[0]).toMatchObject({
      finish: "foil",
      scryfallCents: 500,
      gapBp: 0,
      scryfallDate: "2026-10-11",
    });
  });

  test("stops at the requested size", async () => {
    const fetchCard = vi.fn(async () => card({ usd: "10.00" }));
    const reservoir = reservoirOf(
      Array.from({ length: 8 }, (_, i) => series(i + 1)),
    );
    const result = await runBasisSample(reservoir, 3, {
      today: "2026-10-11",
      fetchCard,
    });
    expect(result.pairs).toHaveLength(3);
    expect(fetchCard).toHaveBeenCalledTimes(3);
  });
});

describe("requests go through src/lib/scryfall.ts (T17)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T06:00:00.000Z"));
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("api.scryfall.com/cards/<id> with the User-Agent and Accept headers, at least 100 ms apart", async () => {
    const calls: { url: string; at: number; headers: Headers }[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      calls.push({
        url: String(input),
        at: Date.now(),
        headers: new Headers(init?.headers),
      });
      return new Response(JSON.stringify(card({ usd: "10.00" })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const basis = await import("./basis");
    const reservoir = new basis.BasisReservoir(5, 1);
    for (let i = 1; i <= 5; i++) reservoir.offer(series(i));
    const run = basis.runBasisSample(reservoir, 5, { today: "2026-10-11" });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.pairs).toHaveLength(5);
    expect(calls.map((c) => c.url)).toEqual(
      Array.from(
        { length: 5 },
        (_, i) => `https://api.scryfall.com/cards/${sid(i + 1)}`,
      ),
    );
    for (const call of calls) {
      expect(call.headers.get("user-agent")).toBe("MoxMarket/0.1.0");
      expect(call.headers.get("accept")).toBe("application/json");
    }
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(100);
    }
  });

  test("a Scryfall 404 counts as not found", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            object: "error",
            code: "not_found",
            status: 404,
            details: "No card",
          }),
          {
            status: 404,
          },
        ),
    );
    const basis = await import("./basis");
    const reservoir = new basis.BasisReservoir(2, 1);
    reservoir.offer(series(1));
    const run = basis.runBasisSample(reservoir, 1, { today: "2026-10-11" });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.skippedNotFound).toBe(1);
    expect(result.pairs).toEqual([]);
    expect(result.medianAbsGapBp).toBeNull();
  });
});
