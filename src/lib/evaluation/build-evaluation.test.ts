// T9 (AC-1, AC-4, AC-13), T15 (AC-6, end to end) and T21 (AC-13):
// buildEvaluation with Scryfall and the reader mocked, through the real engine.
// S2.4 adds T10 (AC-6, AC-7: the two misses compute nothing), T11 (AC-8: a
// failure is never a miss) and T14's unit half (AC-9: a fuzzy hit). S2.3
// adds T6 (AC-1, AC-3: the default selection), T7 (AC-9: an explicit
// printing), T8 (AC-2: pagination) and T9 (AC-7, AC-8: never blended); its
// adversarial review adds the finishes-list fallback (ADV-3) and the option
// round trip (ADV-5).
import {
  ESPER_PRINTS_PAGE_1,
  ESPER_PRINTS_PAGE_2,
  ESPER_PRINTS_PAGE_2_URI,
  ESPER_PRINTS_URI,
  ESPER_SENTINEL_PRINTS,
  etchedOnlyPrinting,
  H2R_4_ID,
  J21_ID,
  MH2_12_ID,
  MH2_328_ID,
  PLST_ID,
  PMH2_12S_ID,
  scryfallCard,
  SLD_2123_ID,
  WC21_ID,
} from "@/lib/__fixtures__/esper-sentinel-prints";
import {
  historyKey,
  keyedHistoryReader,
} from "@/lib/__fixtures__/keyed-history";
import { offeredFinishes, selectablePrintings } from "@/lib/printings";
import * as engine from "@/lib/recommendation/engine";
import { dailyHistory } from "@/lib/recommendation/fixtures";
import type { RecommendationInput } from "@/lib/recommendation/types";
import {
  getAllPrintings,
  getCardByName,
  ScryfallApiError,
} from "@/lib/scryfall";
import { throttle, ThrottleBacklogError } from "@/lib/throttle";
import type { ScryfallCard } from "@/types/scryfall";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildEvaluation,
  defaultEvaluationDeps,
  type Evaluation,
  type EvaluationDeps,
  type EvaluationQuery,
} from "./build-evaluation";
import { SCRYFALL_TIMEOUT_MS } from "./consts";
import {
  defaultHistoryReader,
  emptyHistoryReader,
  type PriceHistoryReader,
} from "./history-reader";
import { parseResultParams } from "./result-params";
import { signalTiles } from "./tiles";

vi.mock("@/lib/recommendation/engine", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/recommendation/engine")>();
  return {
    ...actual,
    computeRecommendation: vi.fn(actual.computeRecommendation),
  };
});
vi.mock("@/lib/throttle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/throttle")>();
  return { ...actual, throttle: vi.fn(() => Promise.resolve()) };
});

const computeSpy = vi.mocked(engine.computeRecommendation);
const { computeRecommendation: realCompute } = await vi.importActual<
  typeof import("@/lib/recommendation/engine")
>("@/lib/recommendation/engine");
const ETCHED_ONLY = etchedOnlyPrinting();
const NOW = new Date("2026-10-10T12:00:00.000Z");
const AS_OF = "2026-10-10";
const FLAT_30 = dailyHistory(AS_OF, Array(30).fill(5917));

const NAMED = scryfallCard({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  set: "pmh2",
  set_type: "promo",
  promo: true,
  prices: {
    usd: "48.00",
    usd_foil: "52.00",
    usd_etched: null,
    eur: null,
    eur_foil: null,
    tix: null,
  },
});

function fixtureReader(history = FLAT_30) {
  return {
    getPriceHistory: vi.fn<PriceHistoryReader["getPriceHistory"]>(async () => ({
      history,
      latestSnapshotAt: new Date("2026-10-10T06:00:00.000Z"),
    })),
    getHistoryFreshness: vi.fn<PriceHistoryReader["getHistoryFreshness"]>(
      async () => ({
        lastSuccessAt: new Date("2026-10-10T06:00:00.000Z"),
        sourceDate: "2026-10-09",
      }),
    ),
  };
}

function depsWith(overrides: {
  getCardByName?: EvaluationDeps["scryfall"]["getCardByName"];
  getAllPrintings?: EvaluationDeps["scryfall"]["getAllPrintings"];
  reader?: PriceHistoryReader;
}) {
  const scryfall = {
    getCardByName: vi.fn(overrides.getCardByName ?? (async () => NAMED)),
    getAllPrintings: vi.fn(
      overrides.getAllPrintings ?? (async () => [...ESPER_SENTINEL_PRINTS]),
    ),
  };
  const reader = overrides.reader ?? fixtureReader();
  const log = vi.fn();
  const deps: EvaluationDeps = { scryfall, reader, now: () => NOW, log };
  return { deps, scryfall, reader, log };
}

const query = (
  askingPriceCents: number,
  finish: "normal" | "foil" = "normal",
): EvaluationQuery => ({ card: "Esper Sentinel", askingPriceCents, finish });

const ok = (e: Evaluation) => {
  if (e.status !== "ok") throw new Error(`expected ok, got ${e.status}`);
  return e;
};

beforeEach(() => {
  computeSpy.mockClear();
});

describe("Scryfall failures → the error panel, nothing computed (T9, AC-4)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const scryfallError = (status: number) =>
    new Response(
      JSON.stringify({ object: "error", code: "x", status, details: "x" }),
      { status, headers: { "Content-Type": "application/json" } },
    );

  test.each([
    ["rejects", () => Promise.reject(new TypeError("fetch failed"))],
    ["answers 503", () => Promise.resolve(scryfallError(503))],
    ["answers 429", () => Promise.resolve(scryfallError(429))],
    [
      "answers an HTML 502",
      () =>
        Promise.resolve(
          new Response("<html>bad gateway</html>", {
            status: 502,
            headers: { "Content-Type": "text/html" },
          }),
        ),
    ],
    // A 404 Scryfall did not send (a wrong path, a proxy): an outage, not a
    // miss (ADV-3).
    [
      "answers an HTML 404",
      () =>
        Promise.resolve(
          new Response("<html>Not Found</html>", {
            status: 404,
            headers: { "Content-Type": "text/html" },
          }),
        ),
    ],
    [
      "answers an empty 404",
      () => Promise.resolve(new Response("", { status: 404 })),
    ],
    [
      "answers a JSON-null 404",
      () => Promise.resolve(new Response("null", { status: 404 })),
    ],
    [
      "answers a 404 with a code other than not_found",
      () => Promise.resolve(scryfallError(404)),
    ],
  ])(
    "a named lookup that %s → error, never a miss; prints, reader and engine 0 calls (T11, AC-8)",
    async (_name, answer) => {
      fetchMock.mockImplementation(answer);
      const { deps, scryfall, reader, log } = depsWith({ getCardByName });
      const result = await buildEvaluation(query(7499), deps);
      expect(result).toEqual({ status: "error" });
      expect(scryfall.getAllPrintings).not.toHaveBeenCalled();
      expect(vi.mocked(reader.getPriceHistory)).not.toHaveBeenCalled();
      expect(vi.mocked(reader.getHistoryFreshness)).not.toHaveBeenCalled();
      expect(computeSpy).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith("scryfall_failed", expect.anything());
    },
  );

  test("a named lookup that times out → error", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const { deps, scryfall } = depsWith({ getCardByName });
    const pending = buildEvaluation(query(7499), deps);
    await vi.advanceTimersByTimeAsync(SCRYFALL_TIMEOUT_MS);
    expect(await pending).toEqual({ status: "error" });
    expect(scryfall.getAllPrintings).not.toHaveBeenCalled();
    expect(computeSpy).not.toHaveBeenCalled();
  });

  test("a named lookup that answers 404 ambiguous through fetch → ambiguous, not error", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "error",
          code: "not_found",
          status: 404,
          type: "ambiguous",
          details: "x",
        }),
        { status: 404 },
      ),
    );
    const { deps } = depsWith({ getCardByName });
    expect(await buildEvaluation(query(7499), deps)).toEqual({
      status: "ambiguous",
    });
  });

  test("a prints page failure → error, the reader at 0 calls", async () => {
    const { deps, reader } = depsWith({
      getAllPrintings: async () => {
        throw new Error("page 2 failed");
      },
    });
    expect(await buildEvaluation(query(7499), deps)).toEqual({
      status: "error",
    });
    expect(vi.mocked(reader.getPriceHistory)).not.toHaveBeenCalled();
    expect(computeSpy).not.toHaveBeenCalled();
  });
});

describe("lookup misses compute nothing (T10, AC-6, AC-7)", () => {
  const miss = (type?: string) => async () => {
    throw new ScryfallApiError(404, "not_found", "x", type);
  };

  test.each<[string, string | undefined, "ambiguous" | "not_found"]>([
    ["jace", "ambiguous", "ambiguous"],
    ["asdfqwer", undefined, "not_found"],
  ])(
    "%j: a 404 with type %s → %s; prints, reader and engine 0 calls, nothing logged",
    async (card, type, status) => {
      const { deps, scryfall, reader, log } = depsWith({
        getCardByName: miss(type),
      });
      const result = await buildEvaluation(
        { card, askingPriceCents: 500, finish: "normal" },
        deps,
      );
      expect(result).toEqual({ status });
      expect(scryfall.getCardByName).toHaveBeenCalledExactlyOnceWith(
        card,
        true,
      );
      expect(scryfall.getAllPrintings).not.toHaveBeenCalled();
      expect(vi.mocked(reader.getPriceHistory)).not.toHaveBeenCalled();
      expect(vi.mocked(reader.getHistoryFreshness)).not.toHaveBeenCalled();
      expect(computeSpy).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    },
  );

  test("the same misses through the real getCardByName with fetch mocked", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const body = (type?: string) =>
        new Response(
          JSON.stringify({
            object: "error",
            code: "not_found",
            status: 404,
            ...(type ? { type } : {}),
            details: "x",
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      fetchMock.mockResolvedValueOnce(body("ambiguous"));
      const ambiguous = depsWith({ getCardByName });
      expect(
        await buildEvaluation(
          { card: "jace", askingPriceCents: 500, finish: "normal" },
          ambiguous.deps,
        ),
      ).toEqual({ status: "ambiguous" });
      fetchMock.mockResolvedValueOnce(body());
      const unknown = depsWith({ getCardByName });
      expect(
        await buildEvaluation(
          { card: "asdfqwer", askingPriceCents: 500, finish: "normal" },
          unknown.deps,
        ),
      ).toEqual({ status: "not_found" });
      for (const { scryfall, log } of [ambiguous, unknown]) {
        expect(scryfall.getAllPrintings).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(computeSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("a failure is never a miss (T11, AC-8)", () => {
  test("a full throttle queue on the named lookup → error, logged once", async () => {
    vi.mocked(throttle).mockRejectedValueOnce(new ThrottleBacklogError(5000));
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { deps, scryfall, reader, log } = depsWith({ getCardByName });
      expect(await buildEvaluation(query(7499), deps)).toEqual({
        status: "error",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith(
        "scryfall_failed",
        expect.any(ThrottleBacklogError),
      );
      expect(scryfall.getAllPrintings).not.toHaveBeenCalled();
      expect(vi.mocked(reader.getPriceHistory)).not.toHaveBeenCalled();
      expect(computeSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test.each([
    ["404 ambiguous", new ScryfallApiError(404, "not_found", "x", "ambiguous")],
    ["404", new ScryfallApiError(404, "not_found", "x")],
    ["503", new ScryfallApiError(503, "x", "x")],
  ])(
    "getAllPrintings throwing a %s ScryfallApiError → error, never a miss",
    async (_name, error) => {
      const { deps, reader, log } = depsWith({
        getAllPrintings: async () => {
          throw error;
        },
      });
      expect(await buildEvaluation(query(7499), deps)).toEqual({
        status: "error",
      });
      expect(log).toHaveBeenCalledExactlyOnceWith("scryfall_failed", error);
      expect(vi.mocked(reader.getPriceHistory)).not.toHaveBeenCalled();
      expect(computeSpy).not.toHaveBeenCalled();
    },
  );

  test.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["a string", "Esper Sentinel"],
    ["a number", 5],
  ])(
    "a lookup resolving %s → error (scryfall_malformed), nothing else called",
    async (_name, value) => {
      const { deps, scryfall, reader, log } = depsWith({
        getCardByName: async () => value as ScryfallCard,
      });
      expect(await buildEvaluation(query(7499), deps)).toEqual({
        status: "error",
      });
      expect(log).toHaveBeenCalledExactlyOnceWith(
        "scryfall_malformed",
        expect.any(TypeError),
      );
      expect(scryfall.getAllPrintings).not.toHaveBeenCalled();
      expect(vi.mocked(reader.getPriceHistory)).not.toHaveBeenCalled();
      expect(computeSpy).not.toHaveBeenCalled();
    },
  );

  test.each<[string, unknown]>([
    ["a TypeError", new TypeError("fetch failed")],
    ["a 429", new ScryfallApiError(429, "x", "x")],
    ["a string", "boom"],
    ["undefined", undefined],
  ])(
    "a lookup throwing %s → error, logged once as scryfall_failed",
    async (_name, thrown) => {
      const { deps, log } = depsWith({
        getCardByName: async () => {
          throw thrown;
        },
      });
      expect(await buildEvaluation(query(7499), deps)).toEqual({
        status: "error",
      });
      expect(log).toHaveBeenCalledExactlyOnceWith("scryfall_failed", thrown);
    },
  );
});

describe("lookup outcomes (T9)", () => {
  test("a fuzzy hit evaluates the resolved card (T14, AC-9)", async () => {
    const resolved = scryfallCard({ id: MH2_12_ID, name: "Esper Sentinel" });
    const { deps, scryfall } = depsWith({
      getCardByName: async () => resolved,
    });
    const result = ok(
      await buildEvaluation(
        { card: "esper sentinal", askingPriceCents: 7499, finish: "normal" },
        deps,
      ),
    );
    expect(scryfall.getCardByName).toHaveBeenCalledExactlyOnceWith(
      "esper sentinal",
      true,
    );
    expect(result.printing.name).toBe("Esper Sentinel");
    expect(scryfall.getAllPrintings).toHaveBeenCalledExactlyOnceWith(resolved);
  });

  test.each([
    [5400, "buy", "9% below market."],
    [5900, "fair", "At market price."],
    [6500, "wait", "10% above market."],
  ])(
    "asking %i against 30 flat rows at 5917 → %s through the real engine",
    async (cents, kind, reason) => {
      const { deps, scryfall } = depsWith({});
      const result = ok(await buildEvaluation(query(cents), deps));
      expect(result.recommendation.kind).toBe(kind);
      expect(result.recommendation.reason).toBe(reason);
      expect(result.recommendation.confidence).toBe("high");
      expect(result.printing.id).toBe(MH2_12_ID);
      expect(scryfall.getAllPrintings).toHaveBeenCalledExactlyOnceWith(NAMED);
      expect(computeSpy).toHaveBeenCalledOnce();
      const args = computeSpy.mock.calls[0];
      expect(args).toHaveLength(2);
      expect(args[0]).toEqual<RecommendationInput>({
        askingPriceCents: cents,
        cardId: MH2_12_ID,
        finish: "normal",
      });
      expect(args[1].history).toBe(FLAT_30);
      expect(args[1].currentPriceCents).toBe(5917);
    },
  );

  // S0.1d9: the empty reader by name; since S0.1 the default reaches Postgres.
  test("the empty reader → insufficient_data, no history, syncStale", async () => {
    const { deps } = depsWith({ reader: emptyHistoryReader });
    const result = ok(await buildEvaluation(query(7499), deps));
    expect(result.recommendation.kind).toBe("insufficient_data");
    expect(result.latestSnapshotAt).toBeNull();
    expect(result.historyUnavailable).toBe(false);
    expect(result.syncStale).toBe(true);
  });

  test("InvalidRecommendationInputError (cents 0 forced past the parser) → invalid, never a throw", async () => {
    const { deps } = depsWith({});
    await expect(buildEvaluation(query(0), deps)).resolves.toEqual({
      status: "invalid",
    });
    await expect(buildEvaluation(query(10_000_001), deps)).resolves.toEqual({
      status: "invalid",
    });
  });

  test("an unexpected engine throw → error, logged, never a throw", async () => {
    computeSpy.mockImplementationOnce(() => {
      throw new RangeError("boom");
    });
    const { deps, log } = depsWith({});
    await expect(buildEvaluation(query(7499), deps)).resolves.toEqual({
      status: "error",
    });
    expect(log).toHaveBeenCalledWith("engine_failed", expect.any(RangeError));
  });

  test("no default printing → the named-lookup card with the C1.21 fallback", async () => {
    const { deps, reader } = depsWith({ getAllPrintings: async () => [] });
    const result = ok(await buildEvaluation(query(7499, "foil"), deps));
    expect(result.printing.id).toBe(NAMED.id);
    expect(result.appliedFinish).toBe("foil");
    expect(vi.mocked(reader.getPriceHistory)).toHaveBeenCalledWith(
      NAMED.id,
      "foil",
      AS_OF,
    );
  });

  test("the default deps use the default (F0) reader and the real Scryfall client", () => {
    expect(defaultEvaluationDeps.reader).toBe(defaultHistoryReader);
    expect(defaultEvaluationDeps.scryfall.getCardByName).toBe(getCardByName);
  });
});

describe("the foil fallback end to end (T15, AC-6)", () => {
  test("foil requested, usd_foil null everywhere, 30 normal rows → fallbackNotice, normal applied", async () => {
    const unpricedFoil = (p: ScryfallCard): ScryfallCard => ({
      ...p,
      prices: { ...p.prices, usd_foil: null },
    });
    const named = unpricedFoil(
      scryfallCard({
        id: MH2_12_ID,
        prices: { ...NAMED.prices, usd: "59.17" },
      }),
    );
    const { deps, reader } = depsWith({
      getCardByName: async () => named,
      getAllPrintings: async () => ESPER_SENTINEL_PRINTS.map(unpricedFoil),
    });
    const result = ok(await buildEvaluation(query(5400, "foil"), deps));
    expect(result.appliedFinish).toBe("normal");
    expect(result.requestedFinish).toBe("foil");
    expect(result.recommendation.kind).toBe("buy");
    expect(result.recommendation.signals.fallbackNotice).toBe(true);
    expect(vi.mocked(reader.getPriceHistory)).toHaveBeenCalledExactlyOnceWith(
      MH2_12_ID,
      "normal",
      AS_OF,
    );
  });
});

describe("the reader is the only history source (T21, AC-13)", () => {
  test("one getPriceHistory(printingId, appliedFinish, asOf) and one getHistoryFreshness() per evaluation", async () => {
    const { deps, reader } = depsWith({});
    await buildEvaluation(query(7499, "foil"), deps);
    expect(vi.mocked(reader.getPriceHistory)).toHaveBeenCalledExactlyOnceWith(
      MH2_12_ID,
      "foil",
      AS_OF,
    );
    expect(
      vi.mocked(reader.getHistoryFreshness),
    ).toHaveBeenCalledExactlyOnceWith();
    await buildEvaluation(query(7499, "normal"), deps);
    expect(vi.mocked(reader.getPriceHistory)).toHaveBeenLastCalledWith(
      MH2_12_ID,
      "normal",
      AS_OF,
    );
    expect(vi.mocked(reader.getHistoryFreshness)).toHaveBeenCalledTimes(2);
  });
});

describe("never throws on malformed Scryfall data (ADV-4)", () => {
  test("a printings payload holding null → error, logged once, nothing computed", async () => {
    const { deps, reader, log } = depsWith({
      getAllPrintings: async () => [null] as unknown as ScryfallCard[],
    });
    await expect(buildEvaluation(query(7499), deps)).resolves.toEqual({
      status: "error",
    });
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("scryfall_failed", expect.any(TypeError));
    expect(vi.mocked(reader.getPriceHistory)).not.toHaveBeenCalled();
    expect(computeSpy).not.toHaveBeenCalled();
  });

  test("a printings payload that is not an array → error", async () => {
    const { deps } = depsWith({
      getAllPrintings: async () => ({ data: [] }) as unknown as ScryfallCard[],
    });
    await expect(buildEvaluation(query(7499), deps)).resolves.toEqual({
      status: "error",
    });
  });

  test("a throw past the lookup (a printing whose prices getter throws) → error, logged", async () => {
    const hostile = Object.defineProperty(
      { ...ESPER_SENTINEL_PRINTS[5] },
      "prices",
      {
        get() {
          throw new TypeError("boom");
        },
      },
    );
    const { deps, log } = depsWith({ getAllPrintings: async () => [hostile] });
    await expect(buildEvaluation(query(7499), deps)).resolves.toEqual({
      status: "error",
    });
    expect(log).toHaveBeenCalledWith(
      "evaluation_failed",
      expect.any(TypeError),
    );
  });

  test("a clock that throws → error, never a rejection", async () => {
    const { deps } = depsWith({});
    const throwing: EvaluationDeps = {
      ...deps,
      now: () => {
        throw new RangeError("clock");
      },
    };
    await expect(buildEvaluation(query(7499), throwing)).resolves.toEqual({
      status: "error",
    });
  });

  test("an evaluated card without the fields the header renders → error", async () => {
    const bare = { ...NAMED, set_name: undefined } as unknown as ScryfallCard;
    const { deps, log } = depsWith({
      getCardByName: async () => bare,
      getAllPrintings: async () => [],
    });
    await expect(buildEvaluation(query(7499), deps)).resolves.toEqual({
      status: "error",
    });
    expect(log).toHaveBeenCalledWith(
      "scryfall_malformed",
      expect.any(TypeError),
    );
    expect(computeSpy).not.toHaveBeenCalled();
  });
});

describe("foil with no foil-priced candidate → the default normal printing (ADV-5, S2.1d23)", () => {
  const unpricedFoil = (p: ScryfallCard): ScryfallCard => ({
    ...p,
    prices: { ...p.prices, usd_foil: null },
  });
  const SLD = ESPER_SENTINEL_PRINTS.find((p) => p.set === "sld")!;

  test("named is the Secret Lair (foil-only, no usd): mh2 #12 is evaluated at 5917 with the fallback notice", async () => {
    expect(SLD.prices.usd).toBeNull();
    const { deps, reader } = depsWith({
      getCardByName: async () => unpricedFoil(SLD),
      getAllPrintings: async () => ESPER_SENTINEL_PRINTS.map(unpricedFoil),
    });
    const result = ok(await buildEvaluation(query(5400, "foil"), deps));
    expect(result.printing.id).toBe(MH2_12_ID);
    expect(result.appliedFinish).toBe("normal");
    expect(computeSpy.mock.calls[0][1].currentPriceCents).toBe(5917);
    expect(result.recommendation.kind).toBe("buy");
    expect(result.recommendation.signals.fallbackNotice).toBe(true);
    expect(vi.mocked(reader.getPriceHistory)).toHaveBeenCalledExactlyOnceWith(
      MH2_12_ID,
      "normal",
      AS_OF,
    );
  });

  test("normal requested never looks at foil candidates", async () => {
    const onlyFoil = ESPER_SENTINEL_PRINTS.map((p) => ({
      ...p,
      prices: { ...p.prices, usd: null },
    }));
    const { deps } = depsWith({ getAllPrintings: async () => onlyFoil });
    const result = ok(await buildEvaluation(query(5400, "normal"), deps));
    expect(result.printing.id).toBe(NAMED.id);
  });
});

// --- S2.3: the selection ---------------------------------------------------
/** A fetch mock answering Scryfall URLs from a table; anything else rejects. */
function scryfallFetch(
  routes: Record<string, () => Response | Promise<Response>>,
) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const answer = routes[url];
    if (answer === undefined) throw new TypeError(`unexpected fetch ${url}`);
    return answer();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const NAMED_URL = (card: string) =>
  `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(card)}`;

const onePage = (data: readonly ScryfallCard[]) => () =>
  Response.json({
    object: "list",
    total_cards: data.length,
    has_more: false,
    data,
  });

const fetchedUrls = (fetchMock: ReturnType<typeof scryfallFetch>) =>
  fetchMock.mock.calls.map(([url]) => String(url));

describe("the default selection (T6, AC-1, AC-3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("no printing → mh2 #12 / normal; options are selectablePrintings in order; one prints fetch", async () => {
    const { deps, scryfall } = depsWith({});
    const result = ok(await buildEvaluation(query(7499), deps));
    expect(result.printing.id).toBe(MH2_12_ID);
    expect(result.requestedFinish).toBe("normal");
    expect(result.selection.printingId).toBe(MH2_12_ID);
    expect(result.selection.offeredFinishes).toEqual(["normal", "foil"]);
    expect(result.selection.options).toEqual(
      selectablePrintings(ESPER_SENTINEL_PRINTS).map((p) => ({
        id: p.id,
        set: p.set,
        set_name: p.set_name,
        collector_number: p.collector_number,
        finishes: offeredFinishes(p),
      })),
    );
    expect(result.selection.options.map((o) => o.id)).toEqual([
      SLD_2123_ID,
      PLST_ID,
      WC21_ID,
      H2R_4_ID,
      MH2_12_ID,
      PMH2_12S_ID,
      MH2_328_ID,
    ]);
    expect(scryfall.getAllPrintings).toHaveBeenCalledOnce();
  });

  test("finish foil → mh2 #12 / foil", async () => {
    const { deps, scryfall, reader } = depsWith({});
    const result = ok(await buildEvaluation(query(7499, "foil"), deps));
    expect(result.selection.printingId).toBe(MH2_12_ID);
    expect(result.requestedFinish).toBe("foil");
    expect(result.appliedFinish).toBe("foil");
    expect(scryfall.getAllPrintings).toHaveBeenCalledOnce();
    expect(vi.mocked(reader.getPriceHistory)).toHaveBeenCalledExactlyOnceWith(
      MH2_12_ID,
      "foil",
      AS_OF,
    );
  });

  test("through the real client: the prints URL is fetched exactly once, serving the default and the selector", async () => {
    const named = scryfallCard({ id: MH2_12_ID });
    const fetchMock = scryfallFetch({
      [NAMED_URL("Esper Sentinel")]: () => Response.json(named),
      [ESPER_PRINTS_URI]: onePage(ESPER_SENTINEL_PRINTS),
    });
    const { deps } = depsWith({ getCardByName, getAllPrintings });
    const result = ok(await buildEvaluation(query(7499), deps));
    expect(result.selection.options).toHaveLength(7);
    expect(result.printing.id).toBe(MH2_12_ID);
    expect(fetchedUrls(fetchMock)).toEqual([
      NAMED_URL("Esper Sentinel"),
      ESPER_PRINTS_URI,
    ]);
  });
});

describe("an explicit printing (T7, AC-9)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const withPrinting = (
    printing: string,
    finish: "normal" | "foil" = "normal",
  ): EvaluationQuery => ({ ...query(7499, finish), printing });

  test("mh2 #328 → mh2 #328 evaluated; the reader called once with its key", async () => {
    const { deps, reader } = depsWith({});
    const result = ok(await buildEvaluation(withPrinting(MH2_328_ID), deps));
    expect(result.printing.id).toBe(MH2_328_ID);
    expect(result.selection.printingId).toBe(MH2_328_ID);
    expect(result.printing.collector_number).toBe("328");
    expect(vi.mocked(reader.getPriceHistory)).toHaveBeenCalledExactlyOnceWith(
      MH2_328_ID,
      "normal",
      AS_OF,
    );
    expect(computeSpy.mock.calls[0][0].cardId).toBe(MH2_328_ID);
    expect(computeSpy.mock.calls[0][1].currentPriceCents).toBe(7120);
  });

  test("the sld id with finish normal → sld #2123, offered foil only, insufficient_data; read for (sld, normal)", async () => {
    const { deps, reader } = depsWith({});
    const result = ok(await buildEvaluation(withPrinting(SLD_2123_ID), deps));
    expect(result.printing.id).toBe(SLD_2123_ID);
    expect(result.selection.offeredFinishes).toEqual(["foil"]);
    expect(result.requestedFinish).toBe("normal");
    expect(result.appliedFinish).toBe("normal");
    expect(result.recommendation.kind).toBe("insufficient_data");
    expect(vi.mocked(reader.getPriceHistory)).toHaveBeenCalledExactlyOnceWith(
      SLD_2123_ID,
      "normal",
      AS_OF,
    );
  });

  test("a promo printing is evaluated when chosen, though never the default", async () => {
    const { deps } = depsWith({});
    const result = ok(await buildEvaluation(withPrinting(PMH2_12S_ID), deps));
    expect(result.printing.id).toBe(PMH2_12S_ID);
  });

  test.each([
    [
      "a well-formed id of another card",
      "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d",
    ],
    ["j21's id (digital)", J21_ID],
    ["an etched-only printing's id", ETCHED_ONLY.id],
  ])(
    "%s → the default mh2 #12; the reader only for mh2 #12; no /cards/<id> fetch",
    async (_name, id) => {
      const named = scryfallCard({ id: MH2_12_ID });
      const fetchMock = scryfallFetch({
        [NAMED_URL("Esper Sentinel")]: () => Response.json(named),
        [ESPER_PRINTS_URI]: onePage([...ESPER_SENTINEL_PRINTS, ETCHED_ONLY]),
      });
      const { deps, reader } = depsWith({ getCardByName, getAllPrintings });
      const result = ok(await buildEvaluation(withPrinting(id), deps));
      expect(result.printing.id).toBe(MH2_12_ID);
      expect(result.selection.printingId).toBe(MH2_12_ID);
      expect(result.selection.options.map((o) => o.id)).not.toContain(id);
      expect(
        vi.mocked(reader.getPriceHistory).mock.calls.map(([cardId]) => cardId),
      ).toEqual([MH2_12_ID]);
      expect(fetchedUrls(fetchMock)).toEqual([
        NAMED_URL("Esper Sentinel"),
        ESPER_PRINTS_URI,
      ]);
      expect(fetchedUrls(fetchMock).some((u) => u.includes(id))).toBe(false);
    },
  );

  test("an unknown id with foil → the foil default, as with no printing", async () => {
    const { deps } = depsWith({});
    const result = ok(
      await buildEvaluation(
        withPrinting("0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d", "foil"),
        deps,
      ),
    );
    expect(result.printing.id).toBe(MH2_12_ID);
    expect(result.appliedFinish).toBe("foil");
  });

  test("a printing the list holds twice is evaluated from its first copy", async () => {
    const first = ESPER_SENTINEL_PRINTS.find((p) => p.id === MH2_328_ID)!;
    const copy = { ...first, collector_number: "999" };
    const { deps } = depsWith({
      getAllPrintings: async () => [...ESPER_SENTINEL_PRINTS, copy],
    });
    const result = ok(await buildEvaluation(withPrinting(MH2_328_ID), deps));
    expect(result.printing.collector_number).toBe("328");
    expect(
      result.selection.options.filter((o) => o.id === MH2_328_ID),
    ).toHaveLength(1);
  });

  test("the named-card fallback (no candidate) keeps its offered finishes; it may sit outside the options", async () => {
    const digitalNamed = scryfallCard({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      digital: true,
      finishes: ["nonfoil"],
    });
    const { deps } = depsWith({
      getCardByName: async () => digitalNamed,
      getAllPrintings: async () => [digitalNamed],
    });
    const result = ok(await buildEvaluation(query(7499), deps));
    expect(result.printing.id).toBe(digitalNamed.id);
    expect(result.selection.printingId).toBe(digitalNamed.id);
    expect(result.selection.options).toEqual([]);
    expect(result.selection.offeredFinishes).toEqual(["normal"]);
  });
});

describe("pagination and page failures (T8, AC-2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const named = scryfallCard({ id: MH2_12_ID });
  const page1 = () => Response.json(ESPER_PRINTS_PAGE_1);
  const page2 = () => Response.json(ESPER_PRINTS_PAGE_2);

  test("page 1 has_more with next_page, page 2 the last → options from both pages in T3's order", async () => {
    expect(ESPER_PRINTS_PAGE_1.data.length).toBeGreaterThan(0);
    expect(ESPER_PRINTS_PAGE_2.data.length).toBeGreaterThan(0);
    const fetchMock = scryfallFetch({
      [NAMED_URL("Esper Sentinel")]: () => Response.json(named),
      [ESPER_PRINTS_URI]: page1,
      [ESPER_PRINTS_PAGE_2_URI]: page2,
    });
    const { deps, log } = depsWith({ getCardByName, getAllPrintings });
    const result = ok(await buildEvaluation(query(7499), deps));
    expect(result.selection.options.map((o) => o.id)).toEqual(
      selectablePrintings(ESPER_SENTINEL_PRINTS).map((p) => p.id),
    );
    // Both pages contribute: sld from page 1, mh2 #12 from page 2.
    const pageOf = (id: string) =>
      ESPER_PRINTS_PAGE_1.data.some((p) => p.id === id) ? 1 : 2;
    expect(new Set(result.selection.options.map((o) => pageOf(o.id)))).toEqual(
      new Set([1, 2]),
    );
    expect(fetchedUrls(fetchMock)).toEqual([
      NAMED_URL("Esper Sentinel"),
      ESPER_PRINTS_URI,
      ESPER_PRINTS_PAGE_2_URI,
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  const scryfall503 = () =>
    new Response(JSON.stringify({ object: "error", code: "x", details: "x" }), {
      status: 503,
    });

  test.each<[string, Record<string, () => Response | Promise<Response>>]>([
    [
      "page 2 answering 503",
      { [ESPER_PRINTS_URI]: page1, [ESPER_PRINTS_PAGE_2_URI]: scryfall503 },
    ],
    [
      "page 2 answering an HTML 502",
      {
        [ESPER_PRINTS_URI]: page1,
        [ESPER_PRINTS_PAGE_2_URI]: () =>
          new Response("<html>bad gateway</html>", { status: 502 }),
      },
    ],
    [
      "page 2's fetch rejecting",
      {
        [ESPER_PRINTS_URI]: page1,
        [ESPER_PRINTS_PAGE_2_URI]: () =>
          Promise.reject(new TypeError("fetch failed")),
      },
    ],
    [
      "page 1 with has_more and no next_page",
      {
        [ESPER_PRINTS_URI]: () =>
          Response.json({ ...ESPER_PRINTS_PAGE_1, next_page: undefined }),
      },
    ],
    [
      "page 1 with a next_page off api.scryfall.com",
      {
        [ESPER_PRINTS_URI]: () =>
          Response.json({
            ...ESPER_PRINTS_PAGE_1,
            next_page: "https://evil.example/cards/search?page=2",
          }),
      },
    ],
    ["page 1 answering 503", { [ESPER_PRINTS_URI]: scryfall503 }],
  ])(
    "%s → error, one scryfall_failed log, no reader or engine call, no selection",
    async (_name, routes) => {
      scryfallFetch({
        [NAMED_URL("Esper Sentinel")]: () => Response.json(named),
        ...routes,
      });
      const { deps, reader, log } = depsWith({
        getCardByName,
        getAllPrintings,
      });
      const result = await buildEvaluation(query(7499), deps);
      expect(result).toEqual({ status: "error" });
      expect(result).not.toHaveProperty("selection");
      expect(log).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith("scryfall_failed", expect.anything());
      expect(vi.mocked(reader.getPriceHistory)).not.toHaveBeenCalled();
      expect(vi.mocked(reader.getHistoryFreshness)).not.toHaveBeenCalled();
      expect(computeSpy).not.toHaveBeenCalled();
    },
  );
});

describe("history is never blended (T9, AC-7, AC-8)", () => {
  const A = MH2_12_ID;
  const B = MH2_328_ID;
  const SERIES = {
    // (A, normal): 30 flat days at A's normal price.
    [historyKey(A, "normal")]: dailyHistory(AS_OF, Array(30).fill(5917)),
    // (A, foil): a 20-day rising ramp.
    [historyKey(A, "foil")]: dailyHistory(
      AS_OF,
      Array.from({ length: 20 }, (_, i) => 6800 + i * 45),
    ),
    // (B, normal): 14 days with a wide range.
    [historyKey(B, "normal")]: dailyHistory(
      AS_OF,
      Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? 5200 : 8900)),
    ),
  };

  type Key = [string, "normal" | "foil"];
  const KEYS: Key[] = [
    [A, "normal"],
    [A, "foil"],
    [B, "normal"],
  ];

  async function evaluateKey([printing, finish]: Key) {
    const reader = keyedHistoryReader(SERIES, NOW);
    const { deps } = depsWith({ reader });
    computeSpy.mockClear();
    const result = ok(
      await buildEvaluation({ ...query(7499, finish), printing }, deps),
    );
    return { result, reader, market: computeSpy.mock.calls[0][1] };
  }

  test.each(KEYS)(
    "(%s, %s): one read with exactly that key; signals and the trend tile equal the engine on that series alone",
    async (printing, finish) => {
      const { result, reader, market } = await evaluateKey([printing, finish]);
      expect(reader.calls).toEqual([[printing, finish, AS_OF]]);
      const own = SERIES[historyKey(printing, finish)];
      expect(market.history).toEqual(own);
      const expected = realCompute(
        { askingPriceCents: 7499, cardId: printing, finish },
        { ...market, history: [...own] },
      );
      const { signals } = result.recommendation;
      expect(signals.snapshotCount30d).toBe(own.length);
      expect(signals.snapshotCount30d).toBe(expected.signals.snapshotCount30d);
      expect(signals.range30dCents).toEqual(expected.signals.range30dCents);
      expect(signals.slope30dPct).toBe(expected.signals.slope30dPct);
      expect(signals.trendDirection).toBe(expected.signals.trendDirection);
      const trend = (s: typeof signals) =>
        signalTiles(s).find((t) => t.id === "trend")!.value;
      expect(trend(signals)).toBe(trend(expected.signals));
    },
  );

  test("each key's count, range and trend differ from the other two keys'", async () => {
    const seen = await Promise.all(KEYS.map(evaluateKey));
    const signals = seen.map(({ result }) => result.recommendation.signals);
    const counts = signals.map((s) => s.snapshotCount30d);
    expect(new Set(counts).size).toBe(3);
    const ranges = signals.map((s) => JSON.stringify(s.range30dCents));
    expect(new Set(ranges).size).toBe(3);
    const trends = signals.map(
      (s) => signalTiles(s).find((t) => t.id === "trend")!.value,
    );
    expect(new Set(trends).size).toBe(3);
  });

  test("fallback: printing A with usd_foil null and foil requested → read for (A, normal) only, fallbackNotice", async () => {
    const reader = keyedHistoryReader(SERIES, NOW);
    const noFoilPrice = ESPER_SENTINEL_PRINTS.map((p) =>
      p.id === A ? { ...p, prices: { ...p.prices, usd_foil: null } } : p,
    );
    const { deps } = depsWith({
      reader,
      getAllPrintings: async () => noFoilPrice,
    });
    const result = ok(
      await buildEvaluation({ ...query(5400, "foil"), printing: A }, deps),
    );
    expect(reader.calls).toEqual([[A, "normal", AS_OF]]);
    expect(result.printing.id).toBe(A);
    expect(result.appliedFinish).toBe("normal");
    expect(result.requestedFinish).toBe("foil");
    expect(result.recommendation.kind).not.toBe("insufficient_data");
    expect(result.recommendation.signals.fallbackNotice).toBe(true);
    expect(result.recommendation.signals.snapshotCount30d).toBe(30);
  });
});

describe("the fallback follows the finishes list (ADV-3, AC-9)", () => {
  const PLST = ESPER_SENTINEL_PRINTS.find((p) => p.id === PLST_ID)!;
  const SLD = ESPER_SENTINEL_PRINTS.find((p) => p.id === SLD_2123_ID)!;
  const SERIES = {
    [historyKey(PLST_ID, "normal")]: dailyHistory(AS_OF, Array(30).fill(6450)),
    [historyKey(PLST_ID, "foil")]: dailyHistory(AS_OF, Array(30).fill(5000)),
  };
  const withPrints = (prints: readonly ScryfallCard[]) => {
    const reader = keyedHistoryReader(SERIES, NOW);
    const { deps } = depsWith({
      reader,
      getAllPrintings: async () => [...prints],
    });
    return { deps, reader };
  };

  test("plst (normal only) with foil requested: normal applied, read for (plst, normal) only, the fallback notice", async () => {
    expect(offeredFinishes(PLST)).toEqual(["normal"]);
    const { deps, reader } = withPrints(ESPER_SENTINEL_PRINTS);
    const result = ok(
      await buildEvaluation(
        { ...query(5500, "foil"), printing: PLST_ID },
        deps,
      ),
    );
    expect(result.printing.id).toBe(PLST_ID);
    expect(result.requestedFinish).toBe("foil");
    expect(result.appliedFinish).toBe("normal");
    expect(result.selection.offeredFinishes).toEqual(["normal"]);
    expect(reader.calls).toEqual([[PLST_ID, "normal", AS_OF]]);
    expect(computeSpy.mock.calls[0][1].currentPriceCents).toBe(6450);
    expect(result.recommendation.kind).not.toBe("insufficient_data");
    expect(result.recommendation.signals.fallbackNotice).toBe(true);
  });

  test("a usd_foil on a printing whose finishes omit foil is not used: normal applied, never read as foil", async () => {
    const foilPriced = {
      ...PLST,
      prices: { ...PLST.prices, usd_foil: "50.00" },
    };
    const prints = ESPER_SENTINEL_PRINTS.map((p) =>
      p.id === PLST_ID ? foilPriced : p,
    );
    const { deps, reader } = withPrints(prints);
    const result = ok(
      await buildEvaluation(
        { ...query(5500, "foil"), printing: PLST_ID },
        deps,
      ),
    );
    expect(result.appliedFinish).toBe("normal");
    expect(reader.calls).toEqual([[PLST_ID, "normal", AS_OF]]);
    expect(reader.calls.some(([, finish]) => finish === "foil")).toBe(false);
    expect(computeSpy.mock.calls[0][1].currentPriceCents).toBe(6450);
    expect(result.recommendation.signals.fallbackNotice).toBe(true);
  });

  test("a usd on a foil-only printing is not used: normal requested is insufficient_data", async () => {
    const normalPriced = { ...SLD, prices: { ...SLD.prices, usd: "5.00" } };
    const prints = ESPER_SENTINEL_PRINTS.map((p) =>
      p.id === SLD_2123_ID ? normalPriced : p,
    );
    const { deps, reader } = withPrints(prints);
    const result = ok(
      await buildEvaluation({ ...query(500), printing: SLD_2123_ID }, deps),
    );
    expect(result.appliedFinish).toBe("normal");
    expect(computeSpy.mock.calls[0][1].currentPriceCents).toBeNull();
    expect(result.recommendation.kind).toBe("insufficient_data");
    expect(reader.calls).toEqual([[SLD_2123_ID, "normal", AS_OF]]);
  });

  test("a printing offering both finishes keeps its foil price", async () => {
    const { deps } = depsWith({});
    const result = ok(
      await buildEvaluation(
        { ...query(7499, "foil"), printing: MH2_12_ID },
        deps,
      ),
    );
    expect(result.appliedFinish).toBe("foil");
    expect(computeSpy.mock.calls[0][1].currentPriceCents).toBe(7647);
  });
});

describe("every offered option round-trips through the URL to itself (ADV-5)", () => {
  const MALFORMED = [
    {
      ...scryfallCard({
        id: "cccccccc-0000-4000-8000-000000000001",
        released_at: "2026-01-01",
      }),
      name: undefined,
    } as unknown as ScryfallCard,
    scryfallCard({
      id: "CCCCCCCC-0000-4000-8000-000000000002",
      released_at: "2026-01-01",
    }),
    scryfallCard({ id: "abc", released_at: "2026-01-01" }),
  ];
  const PRINTS = [...ESPER_SENTINEL_PRINTS, ...MALFORMED];

  test("the three malformed entries are not offered", () => {
    const ids = selectablePrintings(PRINTS).map((p) => p.id);
    for (const bad of MALFORMED) expect(ids).not.toContain(bad.id);
    expect(ids).toEqual(
      selectablePrintings(ESPER_SENTINEL_PRINTS).map((p) => p.id),
    );
  });

  test("each option's id parses as the printing param and evaluates that printing", async () => {
    const { deps } = depsWith({ getAllPrintings: async () => [...PRINTS] });
    const offered = ok(await buildEvaluation(query(7499), deps)).selection
      .options;
    expect(offered.length).toBe(7);
    for (const option of offered) {
      const parsed = parseResultParams("Esper%20Sentinel", {
        price: "74.99",
        finish: option.finishes[0],
        printing: option.id,
      });
      expect(parsed.kind, option.id).toBe("ok");
      if (parsed.kind !== "ok") continue;
      expect(parsed.printing).toBe(option.id);
      const result = ok(
        await buildEvaluation(
          {
            card: parsed.card,
            askingPriceCents: parsed.askingPriceCents,
            finish: parsed.finish,
            printing: parsed.printing,
          },
          deps,
        ),
      );
      expect(result.printing.id, option.id).toBe(option.id);
      expect(result.selection.printingId).toBe(option.id);
    }
  });
});
