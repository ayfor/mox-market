// T16, T17 (AC-4, AC-9; C1.09 = A, C1.22; S1.2d3, S1.2d4): the counting
// window. Market-data problems never throw (F1 W1 step 2).
import { describe, expect, test } from "vitest";
import { computeRecommendation } from "./engine";
import {
  CANONICAL_FIXTURES,
  FIXTURE_AS_OF,
  fixtureInput,
  fixtureMarket,
} from "./fixtures";
import { RECOMMENDATION_PARAMS } from "./params";
import type { MarketSnapshot } from "./types";
import { readWindow, windowDates } from "./window";

const WINDOW = RECOMMENDATION_PARAMS.windowDays;

/** UTC 'YYYY-MM-DD' k days before FIXTURE_AS_OF. */
const daysBefore = (k: number) =>
  new Date(Date.UTC(2026, 9, 10 - k)).toISOString().slice(0, 10);

const withHistory = (history: unknown, price: number | null = 8150) =>
  ({ ...fixtureMarket(price, []), history }) as MarketSnapshot;

/** n distinct window dates, oldest first, ending at asOf − 1. */
const lastDates = (n: number) =>
  Array.from({ length: n }, (_, i) => daysBefore(n - i));

describe("one entry per UTC date (T16, AC-9; S1.2d4)", () => {
  test("three entries on one date count once, so the result is insufficient_data", () => {
    const date = daysBefore(1);
    const history = [
      { date, priceCents: 8000 },
      { date, priceCents: 8100 },
      { date, priceCents: 8200 },
    ];
    const r = computeRecommendation(fixtureInput(8000), withHistory(history));
    expect(r.signals.snapshotCount30d).toBe(1);
    expect(r.kind).toBe("insufficient_data");
    expect(readWindow(history, FIXTURE_AS_OF, WINDOW)).toEqual([
      { index: 29, date, priceCents: 8200 },
    ]);
  });

  test("14 dates where one holds 1000, 2000 and 9999 count 14, and the last entry wins", () => {
    const dates = lastDates(14);
    const history = [
      ...dates.map((date) => ({ date, priceCents: 8000 })),
      { date: dates[5], priceCents: 1000 },
      { date: dates[5], priceCents: 2000 },
      { date: dates[5], priceCents: 9999 },
    ];
    const s = computeRecommendation(
      fixtureInput(8000),
      withHistory(history),
    ).signals;
    expect(s.snapshotCount30d).toBe(14);
    expect(s.range30dCents?.high).toBe(9999);
    expect(s.range30dCents?.low).toBe(8000);
  });

  test("a date whose last entry is 0 after a valid 8000 is a gap; 8000 is not used", () => {
    const dates = lastDates(14);
    const history = [
      ...dates.map((date) => ({ date, priceCents: 7000 })),
      { date: dates[3], priceCents: 8000 },
      { date: dates[3], priceCents: 0 },
    ];
    const snapshots = readWindow(history, FIXTURE_AS_OF, WINDOW);
    expect(snapshots).toHaveLength(13);
    expect(snapshots.some((s) => s.date === dates[3])).toBe(false);
    expect(snapshots.some((s) => s.priceCents === 8000)).toBe(false);
    const r = computeRecommendation(fixtureInput(7000), withHistory(history));
    expect(r.signals.snapshotCount30d).toBe(13);
    expect(r.signals.range30dCents).toBeNull();
  });

  test("a valid entry after an invalid one on the same date is kept", () => {
    const date = daysBefore(2);
    const snapshots = readWindow(
      [
        { date, priceCents: -5 },
        { date, priceCents: 8100 },
      ],
      FIXTURE_AS_OF,
      WINDOW,
    );
    expect(snapshots).toEqual([{ index: 28, date, priceCents: 8100 }]);
  });
});

describe("window bounds (T17, AC-4; C1.09 = A)", () => {
  test("asOf − 30 counts; asOf − 31, asOf and asOf + 1 are ignored", () => {
    expect(daysBefore(30)).toBe("2026-09-10");
    const history = [
      { date: "2026-09-09", priceCents: 8150 },
      { date: "2026-09-10", priceCents: 8150 },
      { date: "2026-10-10", priceCents: 8150 },
      { date: "2026-10-11", priceCents: 8150 },
    ];
    expect(readWindow(history, FIXTURE_AS_OF, WINDOW)).toEqual([
      { index: 0, date: "2026-09-10", priceCents: 8150 },
    ]);
  });

  test("windowDates gives 30 ascending distinct dates ending at asOf − 1", () => {
    const dates = windowDates(FIXTURE_AS_OF, WINDOW);
    expect(dates).toHaveLength(30);
    expect(dates?.[0]).toBe("2026-09-10");
    expect(dates?.[29]).toBe("2026-10-09");
    expect(new Set(dates).size).toBe(30);
    expect([...(dates ?? [])].sort()).toEqual(dates);
  });

  test("month, year and leap-day boundaries", () => {
    const march = windowDates("2026-03-01", WINDOW);
    expect(march?.[0]).toBe("2026-01-30");
    expect(march?.[29]).toBe("2026-02-28");
    expect(march).not.toContain("2026-02-29");
    expect(windowDates("2028-03-01", WINDOW)).toContain("2028-02-29");
    expect(windowDates("2028-03-01", WINDOW)?.[29]).toBe("2028-02-29");
    const newYear = windowDates("2027-01-01", WINDOW);
    expect(newYear?.[0]).toBe("2026-12-02");
    expect(newYear?.[29]).toBe("2026-12-31");
  });

  test.each([
    "2026-02-30",
    "2026-10-10T00:00:00Z",
    "20261010",
    "",
    "2026-13-01",
    "2026-10-00",
    "0099-03-01",
    " 2026-10-10",
  ])(
    "asOf %j gives no window, so a valid price is insufficient_data",
    (asOf) => {
      expect(windowDates(asOf, WINDOW)).toBeNull();
      const market = { ...fixtureMarket(8150, []), asOf };
      market.history = lastDates(30).map((date) => ({
        date,
        priceCents: 8150,
      }));
      const r = computeRecommendation(fixtureInput(8150), market);
      expect(r.kind).toBe("insufficient_data");
      expect(r.signals.snapshotCount30d).toBe(0);
    },
  );

  test.each([null, undefined, 20261010, new Date("2026-10-10T00:00:00Z")])(
    "a non-string asOf (%s) gives no window",
    (asOf) => {
      expect(windowDates(asOf, WINDOW)).toBeNull();
      const market = {
        ...fixtureMarket(8150, Array(30).fill(8150)),
        asOf: asOf as unknown as string,
      };
      expect(() =>
        computeRecommendation(fixtureInput(8150), market),
      ).not.toThrow();
      expect(computeRecommendation(fixtureInput(8150), market).kind).toBe(
        "insufficient_data",
      );
    },
  );
});

describe("malformed market data never throws (T17, AC-4; C1.22)", () => {
  const date = daysBefore(1);

  test.each([
    ["a null entry", null],
    ["an undefined entry", undefined],
    ["a number entry", 8150],
    ["a string entry", "2026-10-09"],
    ["an array entry", [date, 8150]],
    ['date "2026-10-9"', { date: "2026-10-9", priceCents: 8150 }],
    ["a timestamp date", { date: "2026-10-09T12:00:00Z", priceCents: 8150 }],
    [
      "a Date object",
      { date: new Date("2026-10-09T00:00:00Z"), priceCents: 8150 },
    ],
    ["a number date", { date: 20261009, priceCents: 8150 }],
    ["a missing date", { priceCents: 8150 }],
    ["priceCents 0", { date, priceCents: 0 }],
    ["priceCents −5", { date, priceCents: -5 }],
    ["priceCents 81.5", { date, priceCents: 81.5 }],
    ["priceCents NaN", { date, priceCents: Number.NaN }],
    ["priceCents Infinity", { date, priceCents: Number.POSITIVE_INFINITY }],
    ['priceCents "8150"', { date, priceCents: "8150" }],
    ["priceCents null", { date, priceCents: null }],
    ["a missing priceCents", { date }],
    ["priceCents past 2^53", { date, priceCents: 2 ** 53 }],
  ])("%s is a gap", (_label, entry) => {
    expect(readWindow([entry], FIXTURE_AS_OF, WINDOW)).toEqual([]);
    const history = [
      ...lastDates(30)
        .slice(0, 29)
        .map((d) => ({ date: d, priceCents: 8150 })),
      entry,
    ];
    let r: ReturnType<typeof computeRecommendation> | undefined;
    expect(() => {
      r = computeRecommendation(fixtureInput(8150), withHistory(history));
    }).not.toThrow();
    expect(r?.signals.snapshotCount30d).toBe(29);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["an object", { 0: { date: daysBefore(1), priceCents: 8150 }, length: 1 }],
    ["a string", "history"],
    ["a number", 30],
  ])("a history that is %s counts as empty", (_label, history) => {
    expect(readWindow(history, FIXTURE_AS_OF, WINDOW)).toEqual([]);
    const r = computeRecommendation(fixtureInput(8150), withHistory(history));
    expect(r.kind).toBe("insufficient_data");
    expect(r.signals.snapshotCount30d).toBe(0);
  });

  test("a shuffled history with distinct dates gives the same result as the sorted one", () => {
    const values = [
      8150, 8020, 8310, 7990, 8100, 8240, 7870, 8060, 8180, 7950, 8400, 8010,
      8120, 7780, 8290, 8050, 7930, 8210, 8070, 8330, 7900, 8160, 8040, 8260,
      7820, 8190, 8090, 7960, 8270, 8130,
    ];
    const sorted = fixtureMarket(8150, values);
    // A fixed permutation: odd indices reversed, then even indices.
    const shuffled = [
      ...sorted.history.filter((_, i) => i % 2 === 1).reverse(),
      ...sorted.history.filter((_, i) => i % 2 === 0),
    ];
    expect(shuffled.map((h) => h.date)).not.toEqual(
      sorted.history.map((h) => h.date),
    );
    expect(
      computeRecommendation(fixtureInput(8000), {
        ...sorted,
        history: shuffled,
      }),
    ).toStrictEqual(computeRecommendation(fixtureInput(8000), sorted));
  });
});

describe("time-zone independence (ADV-7)", () => {
  // UTC+14 and UTC−11: a local-time Date method in window.ts would shift
  // every date by a day in one of them. Vitest runs each test file in a
  // forked process, and Node re-reads TZ whenever process.env.TZ is set.
  const ZONES = ["Pacific/Kiritimati", "Pacific/Pago_Pago"];
  const AS_OFS = [FIXTURE_AS_OF, "2026-03-01", "2027-01-01", "2028-03-01"];

  const results = () => ({
    dates: AS_OFS.map((asOf) => windowDates(asOf, WINDOW)),
    windows: AS_OFS.map((asOf) =>
      readWindow(
        fixtureMarket(8000, [8000, 8100, 8200], { asOf }).history,
        asOf,
        WINDOW,
      ),
    ),
    fixtures: CANONICAL_FIXTURES.map((f) =>
      computeRecommendation(f.input, f.market),
    ),
  });

  test.each(ZONES)("%s gives exactly the UTC results", (zone) => {
    const original = process.env.TZ;
    const fixtureDay = Date.UTC(2026, 9, 10);
    try {
      process.env.TZ = "UTC";
      expect(new Date(fixtureDay).getTimezoneOffset()).toBe(0);
      const utc = results();
      process.env.TZ = zone;
      // The switch took effect, so the comparison is not vacuous.
      expect(new Date(fixtureDay).getTimezoneOffset()).not.toBe(0);
      expect(results()).toStrictEqual(utc);
      expect(utc.dates[0]?.[0]).toBe("2026-09-10");
      expect(utc.dates[0]?.at(-1)).toBe("2026-10-09");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
