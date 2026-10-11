// T7 (AC-6, AC-1) and T8 (AC-3, contract): the F0 reader with a fake client
// whose $queryRaw is a spy, and the default reader's lazy client (S0.1d6,
// S0.1d8).
import { CardFinish } from "@/generated/prisma/enums";
import { FINISHES, type Finish } from "@/lib/recommendation/types";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createPriceHistoryReader,
  isCalendarDate,
  type RawQueryClient,
} from "./price-history";

const ID_A = "f3537373-ef54-4578-9d05-6216420ee349";
const AS_OF = "2026-10-10";

function fakeClient(rows: unknown = []) {
  const $queryRaw = vi.fn<
    (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
  >(async () => rows);
  const client: RawQueryClient = { $queryRaw };
  const getClient = vi.fn(async () => client);
  return {
    $queryRaw,
    getClient,
    reader: createPriceHistoryReader(getClient),
  };
}

/** The SQL text of a tagged-template call, placeholders as ${…}. */
const sqlOf = (call: unknown[]) =>
  (call[0] as TemplateStringsArray).join("${…}");

describe("input validation before any query (T7, AC-6)", () => {
  const BAD_IDS: [string, unknown][] = [
    ["empty", ""],
    ["abc", "abc"],
    ["no dashes", ID_A.replace(/-/g, "")],
    ["braces", `{${ID_A}}`],
    ["leading space", ` ${ID_A}`],
    ["trailing space", `${ID_A} `],
    ["37 characters", `${ID_A}0`],
    ["a number", 123],
    ["null", null],
    ["undefined", undefined],
  ];
  const BAD_DATES: [string, unknown][] = [
    ["empty", ""],
    ["one-digit day", "2026-10-5"],
    ["one-digit month", "2026-1-05"],
    ["no dashes", "20261005"],
    ["a timestamp", "2026-10-05T00:00:00Z"],
    ["leading space", " 2026-10-05"],
    ["Feb 30", "2026-02-30"],
    ["Feb 29 in a common year", "2025-02-29"],
    ["month 13", "2026-13-01"],
    ["month 00", "2026-00-10"],
    ["a Date", new Date("2026-10-05T00:00:00Z")],
    ["null", null],
  ];
  const BAD_FINISHES: [string, unknown][] = [
    ["Foil", "Foil"],
    ["nonfoil", "nonfoil"],
    ["empty", ""],
  ];

  const call = (
    reader: ReturnType<typeof fakeClient>["reader"],
    id: unknown,
    finish: unknown,
    asOf: unknown,
  ) => reader.getPriceHistory(id as string, finish as Finish, asOf as string);

  /** Rejects with a TypeError naming the argument, never echoing the value. */
  async function expectRejected(
    promise: Promise<unknown>,
    argument: string,
    value: unknown,
  ) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TypeError);
    const message = (error as TypeError).message;
    expect(message).toContain(argument);
    if (typeof value === "string" && value.trim() !== "") {
      expect(message).not.toContain(value.trim());
    }
  }

  test.each(BAD_IDS)(
    "scryfallId %s → TypeError, zero queries, no client",
    async (_name, id) => {
      const { reader, $queryRaw, getClient } = fakeClient();
      await expectRejected(call(reader, id, "foil", AS_OF), "scryfallId", id);
      expect($queryRaw).not.toHaveBeenCalled();
      expect(getClient).not.toHaveBeenCalled();
    },
  );

  test.each(BAD_DATES)(
    "asOf %s → TypeError, zero queries, no client",
    async (_name, asOf) => {
      const { reader, $queryRaw, getClient } = fakeClient();
      await expectRejected(call(reader, ID_A, "foil", asOf), "asOf", asOf);
      expect($queryRaw).not.toHaveBeenCalled();
      expect(getClient).not.toHaveBeenCalled();
    },
  );

  test.each(BAD_FINISHES)(
    "finish %s → TypeError, zero queries, no client",
    async (_name, finish) => {
      const { reader, $queryRaw, getClient } = fakeClient();
      await expectRejected(call(reader, ID_A, finish, AS_OF), "finish", finish);
      expect($queryRaw).not.toHaveBeenCalled();
      expect(getClient).not.toHaveBeenCalled();
    },
  );

  test("a TypeError is a rejection, not a synchronous throw", () => {
    const { reader } = fakeClient();
    let thrown: unknown = null;
    let promise: Promise<unknown> | null = null;
    try {
      promise = reader.getPriceHistory("abc", "foil", AS_OF);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeNull();
    expect(promise).toBeInstanceOf(Promise);
    return expect(promise).rejects.toBeInstanceOf(TypeError);
  });

  test.each([
    ["an upper-case UUID", ID_A.toUpperCase(), AS_OF],
    ["Feb 29 in a leap year", ID_A, "2028-02-29"],
  ])("accepts %s with one query", async (_name, id, asOf) => {
    const { reader, $queryRaw } = fakeClient();
    await expect(reader.getPriceHistory(id, "foil", asOf)).resolves.toEqual({
      history: [],
      latestSnapshotAt: null,
    });
    expect($queryRaw).toHaveBeenCalledOnce();
  });

  test("isCalendarDate accepts real dates only", () => {
    expect(isCalendarDate("2026-10-10")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate(20261010)).toBe(false);
  });
});

describe("the query and its result (T7, AC-6)", () => {
  test("getPriceHistory sends one parameterized statement: id, finish, asOf as values", async () => {
    const { reader, $queryRaw } = fakeClient();
    await reader.getPriceHistory(ID_A, "etched", AS_OF);
    expect($queryRaw).toHaveBeenCalledOnce();
    const [strings, ...values] = $queryRaw.mock.calls[0];
    expect(Array.isArray(strings)).toBe(true);
    expect(values).toEqual([ID_A, "etched", AS_OF, AS_OF]);
    const sql = sqlOf($queryRaw.mock.calls[0]);
    expect(sql).toMatch(/^SELECT /);
    expect(sql).toContain('FROM "price_history"');
    expect(sql).not.toContain(ID_A);
  });

  test("getHistoryFreshness sends one statement with no values", async () => {
    const { reader, $queryRaw } = fakeClient();
    await reader.getHistoryFreshness();
    expect($queryRaw).toHaveBeenCalledOnce();
    const [, ...values] = $queryRaw.mock.calls[0];
    expect(values).toEqual([]);
    expect(sqlOf($queryRaw.mock.calls[0])).toContain('FROM "price_sync_runs"');
  });

  test("rows map to exactly { date, priceCents }; latestSnapshotAt is the last row's synced_at", async () => {
    const { reader } = fakeClient([
      {
        date: "2026-10-09",
        price_cents: 500,
        synced_at: "2026-10-10T01:00:00.000Z",
      },
      {
        date: "2026-10-10",
        price_cents: 510,
        synced_at: "2026-10-10T05:06:07.089Z",
      },
    ]);
    const result = await reader.getPriceHistory(ID_A, "normal", AS_OF);
    expect(result.history).toEqual([
      { date: "2026-10-09", priceCents: 500 },
      { date: "2026-10-10", priceCents: 510 },
    ]);
    expect(Object.keys(result.history[0])).toEqual(["date", "priceCents"]);
    expect(result.latestSnapshotAt).toEqual(
      new Date("2026-10-10T05:06:07.089Z"),
    );
  });

  test("freshness maps the row; no row → both null", async () => {
    await expect(
      fakeClient([
        { finished_at: "2026-10-10T09:00:00.000Z", source_date: "2026-10-09" },
      ]).reader.getHistoryFreshness(),
    ).resolves.toEqual({
      lastSuccessAt: new Date("2026-10-10T09:00:00.000Z"),
      sourceDate: "2026-10-09",
    });
    await expect(
      fakeClient([
        { finished_at: "2026-10-10T09:00:00.000Z", source_date: null },
      ]).reader.getHistoryFreshness(),
    ).resolves.toEqual({
      lastSuccessAt: new Date("2026-10-10T09:00:00.000Z"),
      sourceDate: null,
    });
    await expect(fakeClient([]).reader.getHistoryFreshness()).resolves.toEqual({
      lastSuccessAt: null,
      sourceDate: null,
    });
  });

  test.each([
    [
      "a non-YYYY-MM-DD date",
      {
        date: "10/10/2026",
        price_cents: 1,
        synced_at: "2026-10-10T00:00:00.000Z",
      },
    ],
    [
      "a Date object as the date",
      {
        date: new Date("2026-10-10T00:00:00Z"),
        price_cents: 1,
        synced_at: "2026-10-10T00:00:00.000Z",
      },
    ],
    [
      "zero cents",
      {
        date: "2026-10-10",
        price_cents: 0,
        synced_at: "2026-10-10T00:00:00.000Z",
      },
    ],
    [
      "negative cents",
      {
        date: "2026-10-10",
        price_cents: -5,
        synced_at: "2026-10-10T00:00:00.000Z",
      },
    ],
    [
      "fractional cents",
      {
        date: "2026-10-10",
        price_cents: 1.5,
        synced_at: "2026-10-10T00:00:00.000Z",
      },
    ],
    [
      "string cents",
      {
        date: "2026-10-10",
        price_cents: "100",
        synced_at: "2026-10-10T00:00:00.000Z",
      },
    ],
    [
      "a synced_at with an offset",
      {
        date: "2026-10-10",
        price_cents: 1,
        synced_at: "2026-10-10T00:00:00.000+00:00",
      },
    ],
    [
      "a synced_at Date (the adapter's shifted form)",
      {
        date: "2026-10-10",
        price_cents: 1,
        synced_at: new Date("2026-10-10T00:00:00Z"),
      },
    ],
  ])("a returned row with %s rejects with TypeError", async (_name, row) => {
    await expect(
      fakeClient([row]).reader.getPriceHistory(ID_A, "normal", AS_OF),
    ).rejects.toBeInstanceOf(TypeError);
  });

  test.each([
    ["a null finished_at", { finished_at: null, source_date: null }],
    [
      "a malformed source_date",
      { finished_at: "2026-10-10T09:00:00.000Z", source_date: "2026-13-01" },
    ],
  ])("a freshness row with %s rejects with TypeError", async (_name, row) => {
    await expect(
      fakeClient([row]).reader.getHistoryFreshness(),
    ).rejects.toBeInstanceOf(TypeError);
  });

  test("a non-array query result rejects with TypeError", async () => {
    await expect(
      fakeClient({ rows: [] }).reader.getPriceHistory(ID_A, "normal", AS_OF),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      fakeClient(null).reader.getHistoryFreshness(),
    ).rejects.toBeInstanceOf(TypeError);
  });

  test("a rejecting $queryRaw rejects both calls with that same error (F2 owns the fallback, C1.32)", async () => {
    const failure = new Error('relation "price_history" does not exist');
    const $queryRaw = vi.fn(async () => {
      throw failure;
    });
    const reader = createPriceHistoryReader(async () => ({ $queryRaw }));
    await expect(reader.getPriceHistory(ID_A, "foil", AS_OF)).rejects.toBe(
      failure,
    );
    await expect(reader.getHistoryFreshness()).rejects.toBe(failure);
  });

  test("a rejecting client getter rejects with that same error", async () => {
    const failure = new Error("POSTGRES_PRISMA_URL unset");
    const reader = createPriceHistoryReader(async () => {
      throw failure;
    });
    await expect(reader.getPriceHistory(ID_A, "foil", AS_OF)).rejects.toBe(
      failure,
    );
    await expect(reader.getHistoryFreshness()).rejects.toBe(failure);
  });

  test("the reader is frozen", () => {
    expect(Object.isFrozen(fakeClient().reader)).toBe(true);
  });

  test("the generated CardFinish values equal F1's FINISHES, in order", () => {
    expect(Object.values(CardFinish)).toEqual([...FINISHES]);
  });
});

describe("the default reader (T8, S0.1d8)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@prisma/adapter-pg");
    vi.resetModules();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  /** Fresh modules, POSTGRES_PRISMA_URL unset, PrismaPg construction counted. */
  function freshWithoutUrl() {
    vi.resetModules();
    delete (globalThis as { prisma?: unknown }).prisma;
    vi.stubEnv("POSTGRES_PRISMA_URL", undefined);
    const adapterBuilt = vi.fn();
    vi.doMock("@prisma/adapter-pg", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@prisma/adapter-pg")>();
      class CountingPrismaPg extends actual.PrismaPg {
        constructor(...args: ConstructorParameters<typeof actual.PrismaPg>) {
          adapterBuilt();
          super(...args);
        }
      }
      return { ...actual, PrismaPg: CountingPrismaPg };
    });
    return { adapterBuilt };
  }

  test("with POSTGRES_PRISMA_URL unset, importing the reader does not throw and constructs no client", async () => {
    const { adapterBuilt } = freshWithoutUrl();
    // @/lib/prisma throws at load without the variable (T25), so a clean
    // import here proves the page's import chain never evaluates it.
    await expect(import("@/lib/prisma")).rejects.toThrow(
      "POSTGRES_PRISMA_URL unset",
    );
    vi.resetModules();
    const historyReader = await import("@/lib/evaluation/history-reader");
    const priceHistory = await import("@/lib/price-history");
    expect(historyReader.defaultHistoryReader).toBe(
      priceHistory.prismaHistoryReader,
    );
    expect(Object.isFrozen(historyReader.defaultHistoryReader)).toBe(true);
    expect(adapterBuilt).not.toHaveBeenCalled();
    expect((globalThis as { prisma?: unknown }).prisma).toBeUndefined();
  });

  test("a valid call then rejects 'POSTGRES_PRISMA_URL unset' and opens no connection", async () => {
    const { adapterBuilt } = freshWithoutUrl();
    const { defaultHistoryReader } =
      await import("@/lib/evaluation/history-reader");
    await expect(
      defaultHistoryReader.getPriceHistory(ID_A, "normal", AS_OF),
    ).rejects.toThrow("POSTGRES_PRISMA_URL unset");
    await expect(defaultHistoryReader.getHistoryFreshness()).rejects.toThrow(
      "POSTGRES_PRISMA_URL unset",
    );
    expect(adapterBuilt).not.toHaveBeenCalled();
    expect((globalThis as { prisma?: unknown }).prisma).toBeUndefined();
  });

  test("an invalid call rejects with TypeError before any client load", async () => {
    freshWithoutUrl();
    const { prismaHistoryReader } = await import("@/lib/price-history");
    const error = await prismaHistoryReader
      .getPriceHistory("abc", "normal", AS_OF)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).not.toContain("POSTGRES_PRISMA_URL");
  });
});
