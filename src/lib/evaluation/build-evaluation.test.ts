// T9 (AC-1, AC-4, AC-13), T15 (AC-6, end to end) and T21 (AC-13):
// buildEvaluation with Scryfall and the reader mocked, through the real engine.
import {
  ESPER_SENTINEL_PRINTS,
  MH2_12_ID,
  scryfallCard,
} from "@/lib/__fixtures__/esper-sentinel-prints";
import * as engine from "@/lib/recommendation/engine";
import { dailyHistory } from "@/lib/recommendation/fixtures";
import type { RecommendationInput } from "@/lib/recommendation/types";
import { getCardByName } from "@/lib/scryfall";
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
  type PriceHistoryReader,
} from "./history-reader";

vi.mock("@/lib/recommendation/engine", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/recommendation/engine")>();
  return {
    ...actual,
    computeRecommendation: vi.fn(actual.computeRecommendation),
  };
});
vi.mock("@/lib/throttle", () => ({ throttle: () => Promise.resolve() }));

const computeSpy = vi.mocked(engine.computeRecommendation);
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
  ])(
    "a named lookup that %s → error; prints, reader and engine 0 calls",
    async (_name, answer) => {
      fetchMock.mockImplementation(answer);
      const { deps, scryfall, reader, log } = depsWith({ getCardByName });
      const result = await buildEvaluation(query(7499), deps);
      expect(result).toEqual({ status: "error" });
      expect(scryfall.getAllPrintings).not.toHaveBeenCalled();
      expect(vi.mocked(reader.getPriceHistory)).not.toHaveBeenCalled();
      expect(vi.mocked(reader.getHistoryFreshness)).not.toHaveBeenCalled();
      expect(computeSpy).not.toHaveBeenCalled();
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

describe("lookup outcomes (T9)", () => {
  test("a null lookup → not_found, nothing computed", async () => {
    const { deps, scryfall, reader } = depsWith({
      getCardByName: async () => null,
    });
    expect(await buildEvaluation(query(7499), deps)).toEqual({
      status: "not_found",
    });
    expect(scryfall.getCardByName).toHaveBeenCalledExactlyOnceWith(
      "Esper Sentinel",
      true,
    );
    expect(scryfall.getAllPrintings).not.toHaveBeenCalled();
    expect(vi.mocked(reader.getPriceHistory)).not.toHaveBeenCalled();
    expect(computeSpy).not.toHaveBeenCalled();
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

  test("the default empty reader → insufficient_data, no history, syncStale", async () => {
    const { deps } = depsWith({ reader: defaultHistoryReader });
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

  test("the default deps use the empty reader and the real Scryfall client", () => {
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
