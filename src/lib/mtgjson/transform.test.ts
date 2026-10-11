// T2 (AC-2, S0.2d8) cents; T3 (AC-1, S0.2d6, S0.2d9) the window and the
// gate on parsed entries; T5 (AC-3, S0.2d10, S0.2d11) identifiers,
// collisions and the per-statement dedupe guard on a fake Db.
import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import {
  BEFORE_WINDOW,
  RUN_DATE,
  sortRows,
  WINDOW_START,
} from "./__fixtures__/build";
import { FakeDb } from "./__fixtures__/fake-db";
import {
  emptyParseStats,
  parsePrices,
  type PriceEntry,
  type RawIdentifier,
  type RawSeries,
} from "./parse";
import { UPSERT_PRICES_SQL, upsertPriceChunk } from "./store";
import {
  addDays,
  IdentifierIndex,
  isCalendarDate,
  MAX_PRICE_CENTS,
  PriceTransform,
  toCents,
  windowDates,
  type KeptSeries,
  type PriceRow,
} from "./transform";

const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sid = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function identifier(
  n: number,
  fields: Partial<Omit<RawIdentifier, "uuid">> = {},
  scryfallN = n,
): RawIdentifier {
  return {
    uuid: id(n),
    scryfallId: sid(scryfallN),
    side: null,
    edhrecRank: null,
    ...fields,
  };
}

function entry(
  n: number,
  series: Partial<Record<RawSeries["finish"], Record<string, unknown>>>,
  nonUsdCurrency = false,
): PriceEntry {
  return {
    uuid: id(n),
    series: Object.entries(series).map(([finish, prices]) => ({
      finish: finish as RawSeries["finish"],
      prices: prices!,
    })),
    nonUsdCurrency,
  };
}

/** Runs entries through a transform over these identifiers; rows sorted. */
function transformAll(
  identifiers: readonly RawIdentifier[],
  entries: readonly PriceEntry[],
  runDate = RUN_DATE,
  onKeptSeries?: (series: KeptSeries) => void,
) {
  const index = new IdentifierIndex();
  for (const raw of identifiers) index.add(raw);
  const transform = new PriceTransform(index, runDate, onKeptSeries);
  const rows: PriceRow[] = [];
  for (const e of entries) rows.push(...transform.rowsFor(e));
  return { rows: sortRows(rows), stats: transform.finish(), index };
}

describe("toCents (T2, AC-2)", () => {
  test.each([
    [12.63, 1263],
    [0.29, 29],
    [4.35, 435],
    [1.15, 115],
    [0.01, 1],
    [7500, 750000],
    [0.005, 1],
  ])("%s → %s", (price, cents) => {
    expect(toCents(price)).toBe(cents);
  });

  test.each([
    ["null", null],
    ["NaN", NaN],
    ["0", 0],
    ["-0", -0],
    ["-1", -1],
    ["0.004", 0.004],
    ["Infinity", Infinity],
    ['"1.00" (a string)', "1.00"],
    ["true", true],
    ["{}", {}],
    ["21474836.48 (over int4)", 21474836.48],
  ])("%s is skipped", (_label, price) => {
    expect(toCents(price)).toBeNull();
  });

  test("the largest int4 price converts; one cent more does not", () => {
    expect(toCents(21474836.47)).toBe(MAX_PRICE_CENTS);
    expect(toCents(21474836.48)).toBeNull();
  });

  test("every two-decimal value from 0.01 to 999.99, as a JSON number, converts to exactly its cents", () => {
    const misses: string[] = [];
    for (let cents = 1; cents <= 99_999; cents++) {
      const text = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
      if (toCents(Number(text)) !== cents) misses.push(text);
    }
    expect(misses).toEqual([]);
  });

  test("each skip is counted once in invalidPrices, and no emitted row is outside 1 … int4 max", () => {
    const invalid = [
      null,
      NaN,
      0,
      -0,
      -1,
      0.004,
      Infinity,
      "1.00",
      true,
      {},
      21474836.48,
    ];
    const prices: Record<string, unknown> = {};
    invalid.forEach((value, i) => {
      prices[addDays(WINDOW_START, i)] = value;
    });
    prices[RUN_DATE] = 12.63;
    const { rows, stats } = transformAll(
      [identifier(1, { edhrecRank: 10 })],
      [entry(1, { normal: prices })],
    );
    expect(stats.invalidPrices).toBe(invalid.length);
    expect(rows).toEqual([
      {
        scryfallId: sid(1),
        finish: "normal",
        date: RUN_DATE,
        priceCents: 1263,
      },
    ]);
    for (const row of rows) {
      expect(Number.isSafeInteger(row.priceCents)).toBe(true);
      expect(row.priceCents).toBeGreaterThanOrEqual(1);
      expect(row.priceCents).toBeLessThanOrEqual(MAX_PRICE_CENTS);
    }
  });
});

describe("dates and the window (T3, S0.2d6)", () => {
  test("isCalendarDate accepts real YYYY-MM-DD dates only", () => {
    expect(isCalendarDate("2026-10-05")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    for (const bad of [
      "2026-02-30",
      "2026-9-05",
      "20261005",
      "0000-01-01",
      "",
      20261005,
    ]) {
      expect(isCalendarDate(bad)).toBe(false);
    }
  });

  test("the window is runDate − 30 … runDate: 31 UTC dates", () => {
    const dates = windowDates(RUN_DATE);
    expect(dates).toHaveLength(31);
    expect(dates[0]).toBe(WINDOW_START);
    expect(dates[30]).toBe(RUN_DATE);
    expect(addDays(RUN_DATE, -31)).toBe(BEFORE_WINDOW);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("a runDate that is not a date is refused", () => {
    expect(
      () => new PriceTransform(new IdentifierIndex(), "2026-10-5"),
    ).toThrow(TypeError);
  });
});

describe("the gate (T3, AC-1, S0.2d9)", () => {
  const window = (price: unknown) => ({
    [BEFORE_WINDOW]: price,
    [WINDOW_START]: price,
    [RUN_DATE]: price,
    "2026-10-06": price,
  });
  const kept = (
    n: number,
    finish: PriceRow["finish"],
    cents: number,
  ): PriceRow[] =>
    [WINDOW_START, RUN_DATE].map((date) => ({
      scryfallId: sid(n),
      finish,
      date,
      priceCents: cents,
    }));

  test("AC-1's boundary cases emit exactly the expected row set", () => {
    const { rows, stats } = transformAll(
      [
        identifier(1, { edhrecRank: 4000 }),
        identifier(2, { edhrecRank: 6000 }),
        identifier(3, { edhrecRank: null }),
        identifier(4, { edhrecRank: 6000 }),
        identifier(5, { edhrecRank: 5000 }),
        identifier(6, { edhrecRank: 5001 }),
        identifier(7, { edhrecRank: 120 }),
      ],
      [
        entry(1, { normal: window(0.2) }),
        entry(2, { normal: window(1.0) }),
        entry(3, { normal: window(1.0) }),
        entry(4, { normal: window(0.99) }),
        entry(5, { normal: window(0.1) }),
        entry(6, { normal: window(0.99) }),
        entry(7, { etched: window(12.63) }),
      ],
    );
    expect(rows).toStrictEqual(
      sortRows([
        ...kept(1, "normal", 20),
        ...kept(2, "normal", 100),
        ...kept(3, "normal", 100),
        ...kept(5, "normal", 10),
        ...kept(7, "etched", 1263),
      ]),
    );
    expect(stats.gate).toEqual({
      rankOnly: 2,
      priceOnly: 2,
      both: 1,
      dropped: 2,
      noValidPrice: 0,
      keptNoWindowRows: 0,
    });
    expect(stats.beforeWindow).toBe(7);
    expect(stats.afterRunDate).toBe(7);
    expect(stats.rowsByFinish).toEqual({ normal: 8, foil: 0, etched: 2 });
    expect(stats.distinctSeries).toBe(5);
    expect(stats.distinctPrintings).toBe(5);
  });

  test.each([0, -3, 12.5, "40", null, undefined])(
    "rank %s is unranked: kept only on price",
    (rank) => {
      const cheap = transformAll(
        [identifier(1, { edhrecRank: rank })],
        [entry(1, { normal: window(0.5) })],
      );
      expect(cheap.rows).toEqual([]);
      expect(cheap.stats.gate.dropped).toBe(1);
      const dear = transformAll(
        [identifier(1, { edhrecRank: rank })],
        [entry(1, { normal: window(1.0) })],
      );
      expect(dear.stats.gate.priceOnly).toBe(1);
    },
  );

  test("the gate price is the newest valid price: a null or 0 newest falls back to the previous valid date", () => {
    for (const newest of [null, 0]) {
      const { rows, stats } = transformAll(
        [identifier(1, { edhrecRank: 9000 })],
        [
          entry(1, {
            normal: {
              [WINDOW_START]: 0.5,
              "2026-10-04": 1.5,
              [RUN_DATE]: newest,
            },
          }),
        ],
      );
      expect(stats.gate.priceOnly).toBe(1);
      expect(stats.invalidPrices).toBe(1);
      expect(rows.map((r) => [r.date, r.priceCents])).toEqual([
        [WINDOW_START, 50],
        ["2026-10-04", 150],
      ]);
    }
  });

  test("the gate reads the newest price in the file, even before the window", () => {
    const onKeptSeries = vi.fn();
    const { rows, stats } = transformAll(
      [identifier(1, { edhrecRank: 9000 })],
      [entry(1, { normal: { "2026-08-01": 0.5, [BEFORE_WINDOW]: 2.0 } })],
      RUN_DATE,
      onKeptSeries,
    );
    expect(stats.gate.priceOnly).toBe(1);
    expect(rows).toEqual([]);
    expect(stats.distinctSeries).toBe(0);
    // ADV.9: kept, but with no row in the window: counted on its own and
    // never offered to the basis sample (its price is weeks old).
    expect(stats.gate.keptNoWindowRows).toBe(1);
    expect(onKeptSeries).not.toHaveBeenCalled();
  });

  test("a rank-10 series priced only on 2026-08-01 is kept without window rows and never a basis candidate (ADV.9)", () => {
    const onKeptSeries = vi.fn();
    const { rows, stats } = transformAll(
      [identifier(1, { edhrecRank: 10 }), identifier(2, { edhrecRank: 10 })],
      [
        entry(1, { normal: { "2026-08-01": 3.0 } }),
        entry(2, { normal: { [RUN_DATE]: 3.0 } }),
      ],
      RUN_DATE,
      onKeptSeries,
    );
    expect(rows.map((r) => r.date)).toEqual([RUN_DATE]);
    expect(stats.gate.both).toBe(2);
    expect(stats.gate.keptNoWindowRows).toBe(1);
    expect(stats.distinctSeries).toBe(1);
    expect(onKeptSeries).toHaveBeenCalledTimes(1);
    expect(onKeptSeries.mock.calls[0][0]).toMatchObject({
      newestDate: RUN_DATE,
      newestCents: 300,
    });
  });

  test("a series with no valid price is dropped as noValidPrice", () => {
    const { rows, stats } = transformAll(
      [identifier(1, { edhrecRank: 10 })],
      [entry(1, { normal: { [RUN_DATE]: null, [WINDOW_START]: 0 } })],
    );
    expect(rows).toEqual([]);
    expect(stats.gate.noValidPrice).toBe(1);
  });

  test("a date after runDate is never gated on or emitted", () => {
    const { rows, stats } = transformAll(
      [identifier(1, { edhrecRank: 9000 })],
      [entry(1, { normal: { [RUN_DATE]: 0.5, "2026-10-06": 50 } })],
    );
    expect(rows).toEqual([]);
    expect(stats.gate.dropped).toBe(1);
    expect(stats.afterRunDate).toBe(1);
  });

  test.each(["2026-02-30", "2026-9-05", "20261005"])(
    "a malformed date key %s is skipped and counted",
    (bad) => {
      const { rows, stats } = transformAll(
        [identifier(1, { edhrecRank: 10 })],
        [entry(1, { normal: { [bad]: 1.0, [RUN_DATE]: 1.0 } })],
      );
      expect(stats.invalidDates).toBe(1);
      expect(rows.map((r) => r.date)).toEqual([RUN_DATE]);
    },
  );

  test("a TCGplayer block in another currency is ignored and counted", () => {
    const { rows, stats } = transformAll(
      [identifier(1, { edhrecRank: 10 })],
      [entry(1, {}, true)],
    );
    expect(rows).toEqual([]);
    expect(stats.nonUsdCurrency).toBe(1);
  });

  test("other providers, the buylist and mtgo never become rows (parsed from MTGJson's shape)", async () => {
    const decoy = {
      normal: { [RUN_DATE]: 999.99 },
      foil: { [RUN_DATE]: 999.99 },
    };
    const doc = {
      meta: { date: RUN_DATE, version: "5.3.0" },
      data: {
        [id(1)]: {
          mtgo: { cardhoarder: { currency: "USD", retail: decoy } },
          paper: {
            cardkingdom: { buylist: decoy, currency: "USD", retail: decoy },
            cardmarket: { buylist: decoy, currency: "EUR", retail: decoy },
            manapool: { currency: "USD", retail: decoy },
            tcgplayer: {
              buylist: decoy,
              currency: "USD",
              retail: { normal: { [RUN_DATE]: 1.15 } },
            },
          },
        },
        [id(2)]: {
          paper: { cardkingdom: { currency: "USD", retail: decoy } },
        },
        [id(3)]: {
          paper: { tcgplayer: { currency: "EUR", retail: decoy } },
        },
      },
    };
    const input = new PassThrough();
    input.end(JSON.stringify(doc));
    const entries: PriceEntry[] = [];
    for await (const e of parsePrices(input, emptyParseStats()))
      entries.push(e);
    const { rows, stats } = transformAll(
      [1, 2, 3].map((n) => identifier(n, { edhrecRank: 10 })),
      entries,
    );
    expect(rows).toEqual([
      { scryfallId: sid(1), finish: "normal", date: RUN_DATE, priceCents: 115 },
    ]);
    expect(stats.nonUsdCurrency).toBe(1);
  });
});

describe("identifiers and collisions (T5, AC-3, S0.2d10)", () => {
  test("a UUID absent from AllIdentifiers is skipped and counted in unmappedUuids", () => {
    const { rows, stats } = transformAll(
      [],
      [entry(1, { normal: { [RUN_DATE]: 5 } })],
    );
    expect(rows).toEqual([]);
    expect(stats.unmappedUuids).toBe(1);
  });

  test("sides a and b sharing a Scryfall id (b first, another price) emit side a's row once", () => {
    const { rows, stats } = transformAll(
      [
        identifier(2, { side: "b", edhrecRank: 300 }, 9),
        identifier(1, { side: "a", edhrecRank: 300 }, 9),
      ],
      [
        entry(2, { normal: { [RUN_DATE]: 3.0 } }),
        entry(1, { normal: { [RUN_DATE]: 2.0 } }),
      ],
    );
    expect(rows).toEqual([
      { scryfallId: sid(9), finish: "normal", date: RUN_DATE, priceCents: 200 },
    ]);
    expect(stats.scryfallCollisions).toBe(1);
    expect(stats.collisionLosses).toBe(0);
  });

  test.each([
    ["side null over a", [null, "a"], 0],
    ["a over b", ["b", "a"], 1],
    ["the lowest side among b and c", ["c", "b"], 1],
    ["two null sides: the lowest UUID", [null, null], 0],
  ] as const)("preference: %s", (_label, sides, winner) => {
    const index = new IdentifierIndex();
    sides.forEach((side, i) => index.add(identifier(i + 1, { side }, 9)));
    const preferred = [1, 2].filter((n) =>
      index.isPreferred(index.get(id(n))!),
    );
    expect(preferred).toEqual([winner + 1]);
  });

  test("the preference does not depend on file order", () => {
    const a = new IdentifierIndex();
    a.add(identifier(1, { side: "a" }, 9));
    a.add(identifier(2, { side: "b" }, 9));
    const b = new IdentifierIndex();
    b.add(identifier(2, { side: "b" }, 9));
    b.add(identifier(1, { side: "a" }, 9));
    expect(a.isPreferred(a.get(id(1))!)).toBe(true);
    expect(b.isPreferred(b.get(id(1))!)).toBe(true);
  });

  test.each([
    ["no scryfallId", { scryfallId: undefined }],
    ["a non-UUID scryfallId", { scryfallId: "not-a-uuid" }],
    ["a numeric scryfallId", { scryfallId: 12 }],
  ])("an identifier with %s is skipped and counted", (_label, fields) => {
    const index = new IdentifierIndex();
    index.add(identifier(1, fields));
    expect(index.size).toBe(0);
    expect(index.stats.invalidIdentifiers).toBe(1);
  });

  test("a non-UUID key is skipped and counted", () => {
    const index = new IdentifierIndex();
    index.add({ ...identifier(1), uuid: "abc" });
    expect(index.stats.invalidIdentifiers).toBe(1);
    expect(index.size).toBe(0);
  });

  test("ranks and sides are normalized for storage", () => {
    const index = new IdentifierIndex();
    index.add(identifier(1, { side: "", edhrecRank: 0 }));
    index.add(identifier(2, { side: 3, edhrecRank: "40" }));
    index.add(identifier(3, { side: "a", edhrecRank: 77 }));
    expect([...index.rows()].map((r) => [r.side, r.edhrecRank])).toEqual([
      [null, null],
      [null, null],
      ["a", 77],
    ]);
  });

  test("a UUID repeated in AllPrices is dropped the second time and counted", () => {
    const { rows, stats } = transformAll(
      [identifier(1, { edhrecRank: 10 })],
      [
        entry(1, { normal: { [RUN_DATE]: 1 } }),
        entry(1, { normal: { [RUN_DATE]: 2 } }),
      ],
    );
    expect(rows).toEqual([
      { scryfallId: sid(1), finish: "normal", date: RUN_DATE, priceCents: 100 },
    ]);
    expect(stats.duplicateUuids).toBe(1);
  });

  test("collisionLosses counts a Scryfall id whose preferred UUID has no retail series while a dropped one does", () => {
    const { rows, stats } = transformAll(
      [identifier(1, { side: "a" }, 9), identifier(2, { side: "b" }, 9)],
      [entry(1, {}), entry(2, { normal: { [RUN_DATE]: 5 } })],
    );
    expect(rows).toEqual([]);
    expect(stats.scryfallCollisions).toBe(1);
    expect(stats.collisionLosses).toBe(1);
  });
});

describe("no upsert statement carries a duplicate key (T5, AC-3, S0.2d11)", () => {
  const faces = () =>
    transformAll(
      [
        identifier(2, { side: "b", edhrecRank: 300 }, 9),
        identifier(1, { side: "a", edhrecRank: 300 }, 9),
        identifier(3, { edhrecRank: 10 }),
      ],
      [
        entry(2, { normal: { [WINDOW_START]: 3, [RUN_DATE]: 3 } }),
        entry(1, {
          normal: { [WINDOW_START]: 2, [RUN_DATE]: 2 },
          foil: { [RUN_DATE]: 4 },
        }),
        entry(3, { normal: { [RUN_DATE]: 1 } }),
      ],
    ).rows;

  test.each([1, 5000])("with UPSERT_CHUNK_ROWS %s", async (chunkRows) => {
    const db = new FakeDb();
    const rows = faces();
    for (let i = 0; i < rows.length; i += chunkRows) {
      await upsertPriceChunk(db, rows.slice(i, i + chunkRows));
    }
    const statements = db.matching(/INSERT INTO "price_history"/);
    expect(statements.length).toBe(Math.ceil(rows.length / chunkRows));
    for (const { text, values } of statements) {
      expect(text).toBe(UPSERT_PRICES_SQL);
      const [ids, finishes, dates] = values as string[][];
      const keys = ids.map((v, i) => `${v}|${finishes[i]}|${dates[i]}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
    const sent = statements.flatMap(({ values }) => {
      const [ids, , dates, cents] = values as [
        string[],
        string[],
        string[],
        number[],
      ];
      return ids.map((v, i) => [v, dates[i], cents[i]]);
    });
    expect(sent.filter(([v]) => v === sid(9)).map(([, , c]) => c)).toEqual([
      400, 200, 200,
    ]);
  });

  test("the per-chunk guard drops a planted duplicate and counts it", async () => {
    const db = new FakeDb();
    const row: PriceRow = {
      scryfallId: sid(1),
      finish: "normal",
      date: RUN_DATE,
      priceCents: 100,
    };
    const stats = { duplicateKeys: 0 };
    const written = await upsertPriceChunk(
      db,
      [row, { ...row, priceCents: 999 }],
      stats,
    );
    expect(written).toBe(1);
    expect(stats.duplicateKeys).toBe(1);
    expect(db.statements[0].values).toEqual([
      [sid(1)],
      ["normal"],
      [RUN_DATE],
      [100],
    ]);
  });

  test("an empty chunk sends no statement", async () => {
    const db = new FakeDb();
    expect(await upsertPriceChunk(db, [])).toBe(0);
    expect(db.statements).toEqual([]);
  });
});
