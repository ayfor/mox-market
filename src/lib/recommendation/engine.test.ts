// T1, T4, T5, T6, T7 (engine half) and T20: computeRecommendation end to end.
import { describe, expect, test } from "vitest";
import { computeRecommendation } from "./engine";
import { InvalidRecommendationInputError } from "./errors";
import {
  CANONICAL_FIXTURES,
  canonicalFixture,
  dailyHistory,
  FIXTURE_AS_OF,
  fixtureInput,
  fixtureMarket,
  flat,
  INSUFFICIENT_DATA_SENTENCE,
  ramp,
} from "./fixtures";
import {
  PARAMS_VERSION,
  RECOMMENDATION_PARAMS,
  type RecommendationParams,
} from "./params";
import {
  type Finish,
  FINISHES,
  type MarketSnapshot,
  type PriceSnapshot,
  type RecommendationInput,
} from "./types";

/** UTC 'YYYY-MM-DD' k days before FIXTURE_AS_OF (negative k is after it). */
const daysBefore = (k: number) =>
  new Date(Date.UTC(2026, 9, 10 - k)).toISOString().slice(0, 10);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
  }
  return value;
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("canonical fixtures (T1, AC-1, AC-4, AC-10)", () => {
  test("the suite holds exactly F1's ten worked examples", () => {
    expect(CANONICAL_FIXTURES.map((f) => f.name)).toEqual([
      "A",
      "A-rising",
      "B",
      "C",
      "D",
      "D-buy",
      "D0",
      "E",
      "F",
      "G",
    ]);
  });

  test.each(CANONICAL_FIXTURES.map((f) => [f.name, f] as const))(
    "%s gives its exact kind, confidence, deltaBp and reason",
    (_name, f) => {
      const result = computeRecommendation(f.input, f.market);
      expect(result.kind).toBe(f.expected.kind);
      expect(result.confidence).toBe(f.expected.confidence);
      expect(result.signals.deltaBp).toBe(f.expected.deltaBp);
      expect(result.reason).toBe(f.expected.reason);
    },
  );

  test("the expected values are F1's table, independent of the fixture module", () => {
    const table = {
      A: ["buy", "high", -920, "9% below market."],
      "A-rising": ["fair", "high", -500, "Within 5% of market."],
      B: ["fair", "high", -184, "Within 2% of market."],
      C: ["buy", "high", -920, "9% below market."],
      D: ["wait", "low", 1905, "19% above market; only 10 price snapshots."],
      "D-buy": [
        "buy",
        "low",
        -1429,
        "14% below market; only 10 price snapshots.",
      ],
      D0: ["insufficient_data", "low", 1905, INSUFFICIENT_DATA_SENTENCE],
      E: ["insufficient_data", "low", null, INSUFFICIENT_DATA_SENTENCE],
      F: ["wait", "high", 1043, "10% above market."],
      G: ["fair", "medium", -184, "Within 2% of market."],
    } as const;
    for (const [name, [kind, confidence, deltaBp, reason]] of Object.entries(
      table,
    )) {
      const f = canonicalFixture(name);
      const r = computeRecommendation(f.input, f.market);
      expect([r.kind, r.confidence, r.signals.deltaBp, r.reason]).toEqual([
        kind,
        confidence,
        deltaBp,
        reason,
      ]);
    }
  });

  test("the insufficient_data sentence is F1's copy, verbatim", () => {
    expect(INSUFFICIENT_DATA_SENTENCE).toBe(
      "We don't have enough pricing data on this printing to give a recommendation — try a different printing.",
    );
  });

  test("canonicalFixture throws on an unknown name", () => {
    expect(() => canonicalFixture("Z")).toThrow("no canonical fixture named Z");
  });
});

describe("confidence from the window count (T4, AC-3)", () => {
  test.each([
    [7, "low"],
    [13, "low"],
    [14, "medium"],
    [27, "medium"],
    [28, "high"],
    [29, "high"],
    [30, "high"],
  ] as const)("%i flat window snapshots → %s", (n, confidence) => {
    const r = computeRecommendation(
      fixtureInput(8150),
      fixtureMarket(8150, flat(n, 8150)),
    );
    expect(r.kind).toBe("fair");
    expect(r.confidence).toBe(confidence);
    expect(r.signals.snapshotCount30d).toBe(n);
  });

  test("60 entries with 13 in the window and 47 older → low, count 13", () => {
    const older = Array.from({ length: 47 }, (_, i) => ({
      date: daysBefore(77 - i),
      priceCents: 8150,
    }));
    const inWindow = Array.from({ length: 13 }, (_, i) => ({
      date: daysBefore(13 - i),
      priceCents: 8150,
    }));
    const history = [...older, ...inWindow];
    expect(history).toHaveLength(60);
    expect(older.at(-1)?.date).toBe(daysBefore(31));
    const market = { ...fixtureMarket(8150, []), history };
    const r = computeRecommendation(fixtureInput(8150), market);
    expect(r.confidence).toBe("low");
    expect(r.signals.snapshotCount30d).toBe(13);
    expect(r.kind).toBe("fair");
  });

  test("every insufficient_data result is low, including E with 30 snapshots", () => {
    for (const f of CANONICAL_FIXTURES) {
      const r = computeRecommendation(f.input, f.market);
      if (r.kind === "insufficient_data") expect(r.confidence).toBe("low");
    }
    const e = canonicalFixture("E");
    const r = computeRecommendation(e.input, e.market);
    expect(r.signals.snapshotCount30d).toBe(30);
    expect(r.confidence).toBe("low");
  });
});

describe("the caveat's n and the confidence count de-duplicated window rows (ADV-5)", () => {
  /** n distinct window dates ending at asOf − 1, oldest first. */
  const lastDates = (n: number) =>
    Array.from({ length: n }, (_, i) => daysBefore(n - i));
  const withHistory = (history: PriceSnapshot[], price: number) => ({
    ...fixtureMarket(price, []),
    history,
  });

  test("60 entries, 13 in the window: n is 13, not 60", () => {
    const history = [
      ...Array.from({ length: 47 }, (_, i) => ({
        date: daysBefore(77 - i),
        priceCents: 8150,
      })),
      ...lastDates(13).map((date) => ({ date, priceCents: 8150 })),
    ];
    const r = computeRecommendation(
      fixtureInput(8150),
      withHistory(history, 8150),
    );
    expect(r.reason).toBe("At market price; only 13 price snapshots.");
  });

  test("10 dates plus 3 duplicate rows: n is 10, not 13", () => {
    const dates = lastDates(10);
    const history = [
      ...dates.map((date) => ({ date, priceCents: 4200 })),
      ...dates.slice(0, 3).map((date) => ({ date, priceCents: 4200 })),
    ];
    expect(history).toHaveLength(13);
    const r = computeRecommendation(
      fixtureInput(5000),
      withHistory(history, 4200),
    );
    expect(r.kind).toBe("wait");
    expect(r.confidence).toBe("low");
    expect(r.signals.snapshotCount30d).toBe(10);
    expect(r.reason).toBe("19% above market; only 10 price snapshots.");
  });

  test("27 dates plus 3 duplicate rows: medium, no caveat (30 rows would be high)", () => {
    const dates = lastDates(27);
    const history = [
      ...dates.map((date) => ({ date, priceCents: 8150 })),
      ...dates.slice(-3).map((date) => ({ date, priceCents: 8150 })),
    ];
    expect(history).toHaveLength(30);
    const r = computeRecommendation(
      fixtureInput(8150),
      withHistory(history, 8150),
    );
    expect(r.signals.snapshotCount30d).toBe(27);
    expect(r.confidence).toBe("medium");
    expect(r.reason).toBe("At market price.");
  });

  test("7 dates where one price is 0: 6 real snapshots, insufficient_data", () => {
    const history = lastDates(7).map((date, i) => ({
      date,
      priceCents: i === 3 ? 0 : 8150,
    }));
    const r = computeRecommendation(
      fixtureInput(8150),
      withHistory(history, 8150),
    );
    expect(r.kind).toBe("insufficient_data");
    expect(r.signals.snapshotCount30d).toBe(6);
    expect(r.reason).toBe(INSUFFICIENT_DATA_SENTENCE);
  });

  test("14 dates where one date's last entry is 0: low, only 13", () => {
    const dates = lastDates(14);
    const history = [
      ...dates.map((date) => ({ date, priceCents: 8150 })),
      { date: dates[6], priceCents: 0 },
    ];
    const r = computeRecommendation(
      fixtureInput(8150),
      withHistory(history, 8150),
    );
    expect(r.signals.snapshotCount30d).toBe(13);
    expect(r.confidence).toBe("low");
    expect(r.reason).toBe("At market price; only 13 price snapshots.");
  });
});

describe("insufficient_data (T5, AC-4)", () => {
  const A_HISTORY = flat(30, 8150);

  test.each([
    ["null", null],
    ["0", 0],
    ["-100", -100],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["81.5", 81.5],
    ["undefined", undefined],
    ['the string "8150"', "8150"],
  ])("market price %s → insufficient_data, never a throw", (_label, price) => {
    const market = {
      ...fixtureMarket(null, A_HISTORY),
      currentPriceCents: price as number | null,
    };
    const r = computeRecommendation(fixtureInput(7400), market);
    expect(r.kind).toBe("insufficient_data");
    expect(r.confidence).toBe("low");
    expect(r.reason).toBe(INSUFFICIENT_DATA_SENTENCE);
    expect(r.reason).toContain("—");
    expect(r.reason).toContain("don't");
    expect(r.signals.fallbackNotice).toBe(false);
    expect(r.signals.marketPriceCents).toBeNull();
    expect(r.signals.deltaBp).toBeNull();
    expect(r.signals.deltaPct).toBeNull();
  });

  test("a market price missing from the snapshot entirely is insufficient_data", () => {
    const { currentPriceCents: _omit, ...rest } = fixtureMarket(
      8150,
      A_HISTORY,
    );
    expect(_omit).toBe(8150);
    const r = computeRecommendation(
      fixtureInput(7400),
      rest as unknown as MarketSnapshot,
    );
    expect(r.kind).toBe("insufficient_data");
  });

  test("a valid price with 6 window snapshots (D0) is insufficient_data", () => {
    const d0 = canonicalFixture("D0");
    const r = computeRecommendation(d0.input, d0.market);
    expect(r.kind).toBe("insufficient_data");
    expect(r.signals.snapshotCount30d).toBe(6);
    expect(r.signals.marketPriceCents).toBe(4200);
  });

  test("a valid price with an empty history is insufficient_data", () => {
    const r = computeRecommendation(
      fixtureInput(7400),
      fixtureMarket(8150, []),
    );
    expect(r.kind).toBe("insufficient_data");
    expect(r.signals.snapshotCount30d).toBe(0);
  });

  test("30 entries all outside the window are insufficient_data", () => {
    const tooOld = Array.from({ length: 30 }, (_, i) => ({
      date: daysBefore(60 - i),
      priceCents: 8150,
    }));
    const todayAndLater = Array.from({ length: 30 }, (_, i) => ({
      date: daysBefore(-i),
      priceCents: 8150,
    }));
    for (const history of [tooOld, todayAndLater]) {
      expect(history).toHaveLength(30);
      const market = { ...fixtureMarket(8150, []), history };
      const r = computeRecommendation(fixtureInput(7400), market);
      expect(r.kind).toBe("insufficient_data");
      expect(r.signals.snapshotCount30d).toBe(0);
    }
  });

  test("the asking price is validated first: bad input throws before any market check", () => {
    const cases: Array<[unknown, MarketSnapshot]> = [
      [0, fixtureMarket(null, A_HISTORY)],
      [74.99, fixtureMarket(8150, [])],
    ];
    for (const [asking, market] of cases) {
      const error = thrownBy(() =>
        computeRecommendation(
          { ...fixtureInput(1), askingPriceCents: asking as number },
          market,
        ),
      );
      expect(error).toBeInstanceOf(InvalidRecommendationInputError);
      expect((error as InvalidRecommendationInputError).field).toBe(
        "askingPriceCents",
      );
    }
  });

  test("an input that is not an object throws the typed error, never a TypeError (ADV-6, D7)", () => {
    for (const input of [null, undefined, 42, "x"]) {
      for (const market of [canonicalFixture("A").market, null]) {
        const error = thrownBy(() =>
          computeRecommendation(
            input as unknown as RecommendationInput,
            market as unknown as MarketSnapshot,
          ),
        );
        expect(error, String(input)).toBeInstanceOf(
          InvalidRecommendationInputError,
        );
        expect((error as InvalidRecommendationInputError).field).toBe(
          "askingPriceCents",
        );
      }
    }
  });

  test("E still carries the signals its data supports (S1.2d10)", () => {
    const e = canonicalFixture("E");
    const r = computeRecommendation(e.input, e.market);
    expect(r.signals.snapshotCount30d).toBe(30);
    expect(r.signals.median30dCents).toBe(2000);
  });

  test("a market snapshot that is not an object is insufficient_data, never a throw", () => {
    for (const market of [null, undefined, 42, "market"]) {
      const r = computeRecommendation(
        fixtureInput(7400),
        market as unknown as MarketSnapshot,
      );
      expect(r.kind).toBe("insufficient_data");
      expect(r.signals.fallbackNotice).toBe(false);
      expect(r.signals.snapshotCount30d).toBe(0);
    }
  });
});

describe("finish fallback (T6, AC-5)", () => {
  const A_HISTORY = flat(30, 8150);

  test("foil requested, normal applied: computes on the supplied price, fallbackNotice true", () => {
    const r = computeRecommendation(
      fixtureInput(7400, "foil"),
      fixtureMarket(8150, A_HISTORY, { appliedFinish: "normal" }),
    );
    expect(r.kind).toBe("buy");
    expect(r.signals.deltaBp).toBe(-920);
    expect(r.signals.marketPriceCents).toBe(8150);
    expect(r.signals.fallbackNotice).toBe(true);
  });

  test("etched requested, normal applied: fallbackNotice true", () => {
    const r = computeRecommendation(
      fixtureInput(7400, "etched"),
      fixtureMarket(8150, A_HISTORY, { appliedFinish: "normal" }),
    );
    expect(r.signals.fallbackNotice).toBe(true);
  });

  test.each(["normal", "foil", "etched"] as const)(
    "applied finish equal to the requested %s: fallbackNotice false",
    (finish: Finish) => {
      const r = computeRecommendation(
        fixtureInput(7400, finish),
        fixtureMarket(8150, A_HISTORY, { appliedFinish: finish }),
      );
      expect(r.kind).toBe("buy");
      expect(r.signals.fallbackNotice).toBe(false);
    },
  );

  test("differing finishes on insufficient_data: fallbackNotice false", () => {
    const nullPrice = computeRecommendation(
      fixtureInput(7400, "foil"),
      fixtureMarket(null, A_HISTORY, { appliedFinish: "normal" }),
    );
    const thin = computeRecommendation(
      fixtureInput(5000, "foil"),
      fixtureMarket(4200, flat(6, 4200), { appliedFinish: "normal" }),
    );
    for (const r of [nullPrice, thin]) {
      expect(r.kind).toBe("insufficient_data");
      expect(r.signals.fallbackNotice).toBe(false);
    }
  });
});

describe("unusable finishes (ADV-3, D5, D6)", () => {
  const A_HISTORY = flat(30, 8150);
  const insufficient = (r: ReturnType<typeof computeRecommendation>) => {
    expect(r.kind).toBe("insufficient_data");
    expect(r.confidence).toBe("low");
    expect(r.reason).toBe(INSUFFICIENT_DATA_SENTENCE);
    expect(r.signals.fallbackNotice).toBe(false);
    expect(r.signals.marketPriceCents).toBeNull();
    expect(r.signals.deltaBp).toBeNull();
    expect(r.signals.snapshotCount30d).toBe(0);
  };

  test("an appliedFinish that is missing, null or not a finish is unusable market data", () => {
    const { appliedFinish: _omit, ...missing } = fixtureMarket(8150, A_HISTORY);
    expect(_omit).toBe("normal");
    for (const market of [
      missing,
      { ...fixtureMarket(8150, A_HISTORY), appliedFinish: null },
      { ...fixtureMarket(8150, A_HISTORY), appliedFinish: "Normal" },
      { ...fixtureMarket(8150, A_HISTORY), appliedFinish: "" },
    ]) {
      for (const finish of FINISHES) {
        insufficient(
          computeRecommendation(
            fixtureInput(7400, finish),
            market as unknown as MarketSnapshot,
          ),
        );
      }
    }
  });

  test.each([
    ["normal", "foil"],
    ["normal", "etched"],
    ["foil", "etched"],
    ["etched", "foil"],
  ] as const)(
    "requested %s with applied %s breaks the caller contract (fallback is normal only): insufficient_data",
    (requested, applied) => {
      insufficient(
        computeRecommendation(
          fixtureInput(7400, requested),
          fixtureMarket(8150, A_HISTORY, { appliedFinish: applied }),
        ),
      );
    },
  );

  test.each([
    ["undefined", undefined],
    ["null", null],
    ['"Foil"', "Foil"],
    ['""', ""],
    ['"nonfoil"', "nonfoil"],
  ])(
    "input finish %s throws InvalidRecommendationInputError (field finish) before any market check",
    (_label, finish) => {
      for (const market of [
        fixtureMarket(8150, A_HISTORY),
        null as unknown as MarketSnapshot,
      ]) {
        const error = thrownBy(() =>
          computeRecommendation(
            { ...fixtureInput(7400), finish: finish as Finish },
            market,
          ),
        );
        expect(error).toBeInstanceOf(InvalidRecommendationInputError);
        expect((error as InvalidRecommendationInputError).field).toBe("finish");
        expect((error as Error).message).toBe(
          "finish must be one of normal, foil, etched",
        );
      }
    },
  );

  test("an invalid asking price is reported before an invalid finish", () => {
    const error = thrownBy(() =>
      computeRecommendation(
        { ...fixtureInput(0), finish: "Foil" as Finish },
        fixtureMarket(8150, A_HISTORY),
      ),
    );
    expect((error as InvalidRecommendationInputError).field).toBe(
      "askingPriceCents",
    );
  });
});

describe("purity (T7, AC-6)", () => {
  test("deep-frozen input, market, history and params: no throw, same output twice, order kept", () => {
    for (const f of [
      ...CANONICAL_FIXTURES,
      {
        input: fixtureInput(8000),
        market: fixtureMarket(
          8150,
          [8150, 8020, 8310, 7990, 8100, 8240, 7870, 8060, 8180, 7950],
        ),
      },
    ]) {
      const input = deepFreeze(structuredClone(f.input));
      const market = deepFreeze(structuredClone(f.market));
      const params = deepFreeze({ ...RECOMMENDATION_PARAMS });
      const before = market.history.map((h: PriceSnapshot) => h.date);
      const first = computeRecommendation(input, market, params);
      const second = computeRecommendation(input, market, params);
      expect(second).toStrictEqual(first);
      expect(market.history.map((h: PriceSnapshot) => h.date)).toEqual(before);
      expect(computeRecommendation(f.input, f.market)).toStrictEqual(first);
    }
  });

  test("latestSnapshotAt null and a Date give identical output", () => {
    for (const f of CANONICAL_FIXTURES) {
      const withNull = computeRecommendation(f.input, {
        ...f.market,
        latestSnapshotAt: null,
      });
      const withDate = computeRecommendation(f.input, {
        ...f.market,
        latestSnapshotAt: new Date("2020-01-01T00:00:00Z"),
      });
      expect(withDate).toStrictEqual(withNull);
    }
  });

  test("the result shares no object with the inputs", () => {
    const f = canonicalFixture("A");
    const r = computeRecommendation(f.input, f.market);
    const range = r.signals.range30dCents;
    expect(range).not.toBeNull();
    if (range) range.low = 1;
    expect(
      computeRecommendation(f.input, f.market).signals.range30dCents?.low,
    ).toBe(8150);
    expect(f.market.history.every((h) => h.priceCents === 8150)).toBe(true);
  });
});

describe("tuning without logic changes (T20, F1 W2)", () => {
  test("fairBandPct 10 turns A into fair, Within 9% of market", () => {
    const a = canonicalFixture("A");
    const r = computeRecommendation(a.input, a.market, {
      ...RECOMMENDATION_PARAMS,
      fairBandPct: 10,
    });
    expect(r.kind).toBe("fair");
    expect(r.reason).toBe("Within 9% of market.");
    expect(r.signals.buyThresholdPct).toBe(-16.67);
    expect(r.signals.waitThresholdPct).toBe(10);
    expect(r.signals.bandPct).toBe(10);
  });

  test("minSnapshotsForVerdict 5 turns D0 into wait, low", () => {
    const d0 = canonicalFixture("D0");
    const r = computeRecommendation(d0.input, d0.market, {
      ...RECOMMENDATION_PARAMS,
      minSnapshotsForVerdict: 5,
    });
    expect(r.kind).toBe("wait");
    expect(r.confidence).toBe("low");
    expect(r.reason).toBe("19% above market; only 6 price snapshots.");
  });

  test("windowDays 60 counts all 45 entries of a 45-day history", () => {
    const market = fixtureMarket(8150, flat(45, 8150));
    const params: RecommendationParams = {
      ...RECOMMENDATION_PARAMS,
      windowDays: 60,
    };
    expect(
      computeRecommendation(fixtureInput(8150), market).signals
        .snapshotCount30d,
    ).toBe(30);
    const r = computeRecommendation(fixtureInput(8150), market, params);
    expect(r.signals.snapshotCount30d).toBe(45);
    expect(r.confidence).toBe("high");
  });

  test("highConfidenceSnapshotCount 31 makes A medium", () => {
    const a = canonicalFixture("A");
    const r = computeRecommendation(a.input, a.market, {
      ...RECOMMENDATION_PARAMS,
      highConfidenceSnapshotCount: 31,
    });
    expect(r.confidence).toBe("medium");
    expect(r.kind).toBe("buy");
  });

  test("a rising ramp under a lower trend threshold still only changes the label", () => {
    const market = fixtureMarket(8000, ramp(30, 7420, 40));
    const r = computeRecommendation(fixtureInput(8000), market, {
      ...RECOMMENDATION_PARAMS,
      trendThresholdPct: 0.4,
    });
    expect(r.signals.trendDirection).toBe("rising");
    expect(r.kind).toBe("fair");
  });

  test("RECOMMENDATION_PARAMS and PARAMS_VERSION are unchanged afterwards", () => {
    expect(RECOMMENDATION_PARAMS.fairBandPct).toBe(5);
    expect(RECOMMENDATION_PARAMS.minSnapshotsForVerdict).toBe(7);
    expect(RECOMMENDATION_PARAMS.windowDays).toBe(30);
    expect(RECOMMENDATION_PARAMS.highConfidenceSnapshotCount).toBe(28);
    expect(RECOMMENDATION_PARAMS.trendThresholdPct).toBe(0.5);
    expect(PARAMS_VERSION).toBe("46ec1cd7");
  });
});

describe("fixture helpers", () => {
  test("dailyHistory ends at asOf − 1 on consecutive dates", () => {
    expect(dailyHistory(FIXTURE_AS_OF, [1, 2, 3])).toEqual([
      { date: "2026-10-07", priceCents: 1 },
      { date: "2026-10-08", priceCents: 2 },
      { date: "2026-10-09", priceCents: 3 },
    ]);
    expect(dailyHistory("2026-03-01", [1, 2]).map((h) => h.date)).toEqual([
      "2026-02-27",
      "2026-02-28",
    ]);
  });
});
