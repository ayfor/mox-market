// T4 to T10 (AC-3, AC-4, AC-6 to AC-9, AC-11; S0.3d7 to S0.3d15):
// runDailySync with S0.2's FakeDb and fixture source, behind the no-database
// barrier. Clock 2026-10-05T17:00Z unless stated, so runDate is 2026-10-05.
//
// UTC only: the zone is set before any Date exists in this file, so a test
// that computed runDate in local time would fail at the boundary (T5).
process.env.TZ = "America/Toronto";

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  allPricesJson,
  allPricesTodayJson,
  gz,
  manyCards,
  META,
  metaJson,
  S,
  series,
  sortRows,
  STANDARD_CARDS,
  STANDARD_IDENTIFIERS,
  standardRows,
  U,
  type CardFixture,
} from "./__fixtures__/build";
import { FakeDb, type FakeDbOptions } from "./__fixtures__/fake-db";
import {
  ALL_PRICES_TODAY_FILE,
  HISTORY_WINDOW_DAYS,
  META_FILE,
  STALE_RUN_MS,
  SYNC_DEADLINE_MS,
  SYNC_MAX_ROWS,
  type MtgjsonFileName,
} from "./consts";
import {
  createFixtureSource,
  createHttpSource,
  type MtgjsonSource,
} from "./source";
import {
  LOAD_IDENTIFIERS_SQL,
  MARK_STALE_RUNS_SQL,
  PRUNE_SQL,
  SET_RUN_SOURCE_SQL,
  STALE_RUN_MESSAGE,
  UPSERT_PRICES_SQL,
  type Db,
  type QueryResultLike,
} from "./store";
import {
  IDENTIFIERS_NOT_LOADED,
  NO_RETAIL_PRICES,
  NO_ROWS_EMITTED,
  runDailySync,
  TOO_MANY_ROWS,
  UNSUPPORTED_VERSION,
  type SyncDeps,
} from "./sync";
import type { IdentifierRow, PriceRow } from "./transform";

const NOW = new Date("2026-10-05T17:00:00.000Z");
const RUN_DATE = "2026-10-05";

/** The gated 2026-10-05 rows of the standard fixture. */
const TODAY_ROWS = standardRows(RUN_DATE).filter((r) => r.date === RUN_DATE);

/** Meta.json and AllPricesToday.json.gz for a fixture source. */
function files({
  cards = STANDARD_CARDS,
  meta = META,
  todayMeta = META,
  todayDate = RUN_DATE,
}: {
  cards?: readonly CardFixture[];
  meta?: unknown;
  todayMeta?: unknown;
  todayDate?: string;
} = {}): Partial<Record<MtgjsonFileName, Buffer>> {
  return {
    [META_FILE]: Buffer.from(metaJson(meta)),
    [ALL_PRICES_TODAY_FILE]: gz(
      allPricesTodayJson(cards, todayDate, todayMeta),
    ),
  };
}

/** A fixture source whose prepare calls are recorded. */
function spiedSource(
  input: Partial<Record<MtgjsonFileName, Buffer | string>> = files(),
) {
  const source = createFixtureSource(input);
  const prepared: string[] = [];
  const wrapped: MtgjsonSource & { opened: string[]; prepared: string[] } = {
    description: source.description,
    opened: source.opened,
    prepared,
    async prepare(names) {
      prepared.push(...names);
      return source.prepare(names);
    },
    open: (name) => source.open(name),
    verify: (name) => source.verify(name),
  };
  return wrapped;
}

type RunOptions = Partial<SyncDeps> & { dbOptions?: FakeDbOptions };

async function run(options: RunOptions = {}) {
  const { dbOptions, ...rest } = options;
  const db =
    (rest.db as FakeDb | undefined) ??
    new FakeDb({ identifiers: STANDARD_IDENTIFIERS, ...dbOptions });
  const source = (rest.source ?? spiedSource()) as ReturnType<
    typeof spiedSource
  >;
  const log = { warn: vi.fn(), error: vi.fn() };
  const result = await runDailySync({
    now: () => NOW,
    log,
    ...rest,
    db,
    source,
  });
  return { db, source, log, result };
}

/** Every row the upsert statements carried, in statement order. */
function upserted(db: FakeDb): PriceRow[] {
  return db.matching(/unnest/).flatMap(({ values }) => {
    const [ids, finishes, dates, cents] = values as [
      string[],
      PriceRow["finish"][],
      string[],
      number[],
    ];
    return ids.map((scryfallId, i) => ({
      scryfallId,
      finish: finishes[i],
      date: dates[i],
      priceCents: cents[i],
    }));
  });
}

/** The finishRun statement's values, named. */
function finished(db: FakeDb) {
  const statements = db.matching(/"rows_written" = \$3::int4/);
  expect(statements).toHaveLength(1);
  const [id, status, rowsWritten, rowsPruned, unmappedUuids, dbBytes, error] =
    statements[0].values as [
      number,
      string,
      number,
      number,
      number,
      number | null,
      string | null,
    ];
  return { id, status, rowsWritten, rowsPruned, unmappedUuids, dbBytes, error };
}

/** Every finishRun statement's status, in order. */
const finishStatuses = (db: FakeDb) =>
  db.matching(/"rows_written" = \$3::int4/).map((s) => s.values[1]);

/**
 * A FakeDb whose nth statement matching `match` is recorded and then never
 * settles (a hung connect or query), every other statement answered as usual.
 */
function hangingOn(base: FakeDb, match: RegExp, nth = 1): Db {
  let seen = 0;
  return {
    query(text, values): Promise<QueryResultLike> {
      if (match.test(text) && ++seen === nth) {
        void base.query(text, values);
        return new Promise(() => undefined);
      }
      return base.query(text, values);
    },
  };
}

/** The identifier rows for manyCards(). */
const identifiersFor = (cards: readonly CardFixture[]): IdentifierRow[] =>
  cards.map((c) => ({
    mtgjsonUuid: c.uuid,
    scryfallId: c.scryfallId as string,
    side: null,
    edhrecRank: 10,
  }));

/** A label per statement, for order assertions. */
function labels(db: FakeDb): string[] {
  return db.statements.map(({ text }) => {
    if (text === MARK_STALE_RUNS_SQL) return "stale";
    if (/^INSERT INTO "price_sync_runs"/.test(text)) return "start";
    if (text === SET_RUN_SOURCE_SQL) return "source";
    if (text === LOAD_IDENTIFIERS_SQL) return "identifiers";
    if (/pg_database_size/.test(text)) return "size";
    if (text === UPSERT_PRICES_SQL) return "upsert";
    if (text === PRUNE_SQL) return "prune";
    if (/"rows_written" = \$3::int4/.test(text)) return "finish";
    return text.slice(0, 40);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the happy path (T4, AC-3)", () => {
  test("statements in W2's order, the gated 2026-10-05 rows, and the result equals the finished row", async () => {
    const { db, result, log } = await run();
    expect(labels(db)).toEqual([
      "stale",
      "start",
      "source",
      "identifiers",
      "size",
      "upsert",
      "prune",
      "size",
      "finish",
    ]);
    expect(db.statements[1].values).toEqual(["cron", null, null]);
    expect(db.matching(/^INSERT INTO "price_sync_runs"/)[0].text).toMatch(
      /'running'/,
    );
    expect(db.statements[2].values).toEqual([
      1,
      "2026-10-05",
      "5.3.0+20261005",
    ]);
    expect(db.matching(/^DELETE/)[0].values).toEqual([
      "2026-10-05",
      HISTORY_WINDOW_DAYS,
    ]);

    // TCGplayer retail only, cents, the gate's inclusive bounds, etched kept.
    expect(sortRows(upserted(db))).toEqual(TODAY_ROWS);
    expect(TODAY_ROWS.map((r) => r.finish)).toContain("etched");
    expect(TODAY_ROWS).toHaveLength(7);

    const row = finished(db);
    expect(row).toEqual({
      id: 1,
      status: "ok",
      rowsWritten: TODAY_ROWS.length,
      rowsPruned: 0,
      unmappedUuids: 1,
      dbBytes: 100_000_000,
      error: null,
    });
    expect(result).toMatchObject({
      status: "ok",
      runId: row.id,
      sourceDate: "2026-10-05",
      sourceVersion: "5.3.0+20261005",
      rowsWritten: row.rowsWritten,
      rowsPruned: row.rowsPruned,
      unmappedUuids: row.unmappedUuids,
      dbBytes: row.dbBytes,
      staleRunsMarked: 0,
      error: null,
    });
    expect(typeof result.dbBytes).toBe("number");
    for (const value of Object.values(result.phasesMs)) {
      expect(Number.isInteger(value) && value >= 0).toBe(true);
    }
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  test("rows_written is the upserts' rowCount sum, and staleRunsMarked the stale update's count", async () => {
    const { db, result } = await run({
      chunkRows: 3,
      dbOptions: { identifiers: STANDARD_IDENTIFIERS, staleRuns: 2 },
    });
    expect(db.matching(/unnest/)).toHaveLength(3);
    expect(result.rowsWritten).toBe(7);
    expect(result.staleRunsMarked).toBe(2);
  });

  test("a non-positive or fractional chunkRows is refused before any statement", async () => {
    for (const chunkRows of [0, -1, 1.5]) {
      const db = new FakeDb();
      await expect(
        runDailySync({ db, source: spiedSource(), now: () => NOW, chunkRows }),
      ).rejects.toThrow(/chunkRows/);
      expect(db.statements).toHaveLength(0);
    }
  });
});

describe("source dates (T5, AC-4)", () => {
  test.each([
    ["Meta.json dated the day before", "2026-10-04"],
    ["Meta.json dated ahead of the clock", "2026-10-06"],
  ])(
    "%s → AllPricesToday neither prepared nor opened, prune, source_stale",
    async (_label, date) => {
      const source = spiedSource(
        files({ meta: { date, version: META.version } }),
      );
      const { db, result } = await run({ source });
      expect(source.prepared).toEqual([META_FILE]);
      expect(source.opened).toEqual([META_FILE]);
      expect(db.matching(/unnest/)).toHaveLength(0);
      expect(db.matching(/^DELETE/)).toHaveLength(1);
      expect(db.matching(/^DELETE/)[0].values[0]).toBe(RUN_DATE);
      expect(labels(db)).toEqual([
        "stale",
        "start",
        "source",
        "prune",
        "size",
        "finish",
      ]);
      expect(result.status).toBe("source_stale");
      expect(result.sourceDate).toBe(date);
      expect(finished(db).status).toBe("source_stale");
      expect(finished(db).rowsWritten).toBe(0);
    },
  );

  test("AllPricesToday dated 2026-10-04 under a 2026-10-05 Meta.json → source_stale, no upsert, prune", async () => {
    const source = spiedSource(
      files({ todayMeta: { date: "2026-10-04", version: META.version } }),
    );
    const { db, result } = await run({ source });
    expect(result.status).toBe("source_stale");
    expect(result.sourceDate).toBe("2026-10-05");
    expect(db.matching(/unnest/)).toHaveLength(0);
    expect(db.matching(/^DELETE/)).toHaveLength(1);
    expect(db.matching(/mtgjson_identifiers/)).toHaveLength(0);
  });

  test("AllPricesToday dated 2026-10-06 (newer than a 2026-10-05 Meta.json) → source_stale, no upsert, prune", async () => {
    const source = spiedSource(
      files({ todayMeta: { date: "2026-10-06", version: META.version } }),
    );
    const { db, result } = await run({ source });
    expect(result.status).toBe("source_stale");
    expect(result.error).toBeNull();
    expect(db.matching(/unnest/)).toHaveLength(0);
    expect(db.matching(/^DELETE/)).toHaveLength(1);
    expect(finishStatuses(db)).toEqual(["source_stale"]);
  });

  // ADV.1: a malformed AllPricesToday date is a format change, refused like
  // Meta.json's, never a quiet "not published yet" that prunes every day.
  test.each([
    ["missing", { version: META.version }],
    ["null", { date: null, version: META.version }],
    ["empty", { date: "", version: META.version }],
    ["a timestamp", { date: "2026-10-05T14:00:00Z", version: META.version }],
    ["not a calendar date", { date: "2026-02-30", version: META.version }],
    ["a number", { date: 20261005, version: META.version }],
  ])(
    "AllPricesToday date %s under a valid Meta.json → error 'no calendar date', no prune, no identifier load",
    async (_label, todayMeta) => {
      const source = spiedSource(files({ todayMeta }));
      const { db, result } = await run({ source });
      expect(result.status).toBe("error");
      expect(result.error).toMatch(
        /AllPricesToday\.json\.gz has no calendar date[\s\S]*nothing written/,
      );
      expect(result.sourceDate).toBe(RUN_DATE);
      expect(db.matching(/^DELETE/)).toHaveLength(0);
      expect(db.matching(/mtgjson_identifiers/)).toHaveLength(0);
      expect(db.matching(/unnest/)).toHaveLength(0);
      expect(finished(db)).toMatchObject({
        status: "error",
        rowsWritten: 0,
        rowsPruned: 0,
        dbBytes: null,
      });
    },
  );

  test("a wrong AllPricesToday version wins over its missing date", async () => {
    const source = spiedSource(files({ todayMeta: { version: "4.0.0" } }));
    const { result } = await run({ source });
    expect(result.status).toBe("error");
    expect(result.error).toContain(UNSUPPORTED_VERSION);
  });

  test.each([
    ["missing", { version: META.version }],
    ["null", { date: null, version: META.version }],
    [
      "not a calendar date (2026-02-30)",
      { date: "2026-02-30", version: META.version },
    ],
    [
      "another format (10/05/2026)",
      { date: "10/05/2026", version: META.version },
    ],
  ])(
    "Meta.json date %s → error, nothing written, no prune",
    async (_label, meta) => {
      const source = spiedSource(files({ meta }));
      const { db, result } = await run({ source });
      expect(result.status).toBe("error");
      expect(result.error).toMatch(/Meta\.json has no calendar date/);
      expect(result.sourceDate).toBeNull();
      expect(db.matching(/unnest/)).toHaveLength(0);
      expect(db.matching(/^DELETE/)).toHaveLength(0);
      expect(source.opened).toEqual([META_FILE]);
      expect(finished(db)).toMatchObject({ status: "error", rowsWritten: 0 });
      // The row records what arrived: a non-calendar date is stored as null.
      expect(db.statements[2].values[1]).toBeNull();
    },
  );

  test.each([
    // The instant's UTC date, never Toronto's local date.
    ["2026-10-05T23:59:59.999Z", "2026-10-05", "ok"],
    ["2026-10-05T02:00:00.000Z", "2026-10-05", "ok"],
    ["2026-10-06T00:00:00.000Z", "2026-10-06", "source_stale"],
  ])(
    "UTC boundary under TZ=America/Toronto: %s runs as %s (%s against a 10-05 Meta.json)",
    async (instant, runDate, status) => {
      expect(new Date(instant).getTimezoneOffset()).toBe(240);
      const { db, result } = await run({ now: () => new Date(instant) });
      expect(result.status).toBe(status);
      expect(db.matching(/^DELETE/)[0].values[0]).toBe(runDate);
    },
  );
});

describe("version (T6, AC-6)", () => {
  test.each([
    ["4.9.0", "4.9.0"],
    ["50.1.0", "50.1.0"],
    ["5", "5"],
    ["empty", ""],
    ["missing", undefined],
    ["a number", 5.3],
  ])(
    "Meta.json version %s → error, nothing written, no prune, AllPricesToday never fetched",
    async (_label, version) => {
      const meta =
        version === undefined
          ? { date: META.date }
          : { date: META.date, version };
      const source = spiedSource(files({ meta }));
      const { db, result } = await run({ source });
      expect(result.status).toBe("error");
      expect(result.error).toContain(UNSUPPORTED_VERSION);
      expect(result.dbBytes).toBeNull();
      expect(db.matching(/unnest/)).toHaveLength(0);
      expect(db.matching(/^DELETE/)).toHaveLength(0);
      expect(source.prepared).toEqual([META_FILE]);
      expect(source.opened).toEqual([META_FILE]);
      // The version is recorded so the row shows what arrived.
      expect(db.statements[2].values).toEqual([
        1,
        META.date,
        typeof version === "string" ? version : null,
      ]);
      expect(finished(db)).toMatchObject({ status: "error", rowsWritten: 0 });
      expect(finished(db).error).toContain(UNSUPPORTED_VERSION);
    },
  );

  test("a wrong version wins over a stale date (S0.3d8)", async () => {
    const source = spiedSource(
      files({ meta: { date: "2026-10-04", version: "4.0.0" } }),
    );
    const { db, result } = await run({ source });
    expect(result.status).toBe("error");
    expect(db.matching(/^DELETE/)).toHaveLength(0);
  });

  test("a long version is recorded cut to 100 characters", async () => {
    const version = `4.${"9".repeat(300)}`;
    const source = spiedSource(files({ meta: { date: META.date, version } }));
    const { db, result } = await run({ source });
    expect(result.status).toBe("error");
    expect(db.statements[2].values[2]).toBe(version.slice(0, 100));
    expect(result.sourceVersion).toBe(version.slice(0, 100));
  });

  test("AllPricesToday's own version not 5. under a valid Meta.json → error, nothing written", async () => {
    const source = spiedSource(
      files({ todayMeta: { date: META.date, version: "6.0.0" } }),
    );
    const { db, result } = await run({ source });
    expect(result.status).toBe("error");
    expect(result.error).toContain(UNSUPPORTED_VERSION);
    expect(result.error).toContain(ALL_PRICES_TODAY_FILE);
    expect(db.matching(/unnest/)).toHaveLength(0);
    expect(db.matching(/^DELETE/)).toHaveLength(0);
  });
});

describe("budget (T7, AC-7)", () => {
  const budget = (sizes: number[]) =>
    run({ dbOptions: { identifiers: STANDARD_IDENTIFIERS, sizes } });

  test("450,000,001 → no upsert, the prune runs, budget_stop, one warning naming 450 MB", async () => {
    const { db, result, log } = await budget([450_000_001]);
    expect(db.matching(/unnest/)).toHaveLength(0);
    expect(db.matching(/^DELETE/)).toHaveLength(1);
    expect(result.status).toBe("budget_stop");
    expect(result.dbBytes).toBe(450_000_001);
    expect(finished(db)).toMatchObject({
      status: "budget_stop",
      rowsWritten: 0,
      dbBytes: 450_000_001,
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatch(/450 MB/);
  });

  test("exactly 450,000,000 → upserts run, with the 400 MB warning", async () => {
    const { db, result, log } = await budget([450_000_000]);
    expect(db.matching(/unnest/)).toHaveLength(1);
    expect(result.status).toBe("ok");
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatch(/400 MB/);
  });

  test("400,000,001 → upserts and one warning", async () => {
    const { db, result, log } = await budget([400_000_001]);
    expect(db.matching(/unnest/)).toHaveLength(1);
    expect(result.status).toBe("ok");
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  test("exactly 400,000,000 → upserts and no warning", async () => {
    const { db, result, log } = await budget([400_000_000]);
    expect(db.matching(/unnest/)).toHaveLength(1);
    expect(result.status).toBe("ok");
    expect(log.warn).not.toHaveBeenCalled();
  });

  test("a final size over 450 MB after an ok write → status stays ok, a warning is logged", async () => {
    const { result, log, db } = await budget([100_000_000, 460_000_000]);
    expect(result.status).toBe("ok");
    expect(result.dbBytes).toBe(460_000_000);
    expect(typeof result.dbBytes).toBe("number");
    expect(finished(db).dbBytes).toBe(460_000_000);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatch(/450 MB/);
  });

  test("a final size between 400 and 450 MB after a quiet pre-check → one 400 MB warning", async () => {
    const { result, log } = await budget([100_000_000, 420_000_000]);
    expect(result.status).toBe("ok");
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatch(/400 MB/);
  });
});

describe("identifiers (T8, AC-8)", () => {
  /** Asserts an error run that wrote nothing and pruned nothing. */
  function expectRefused(
    db: FakeDb,
    result: Awaited<ReturnType<typeof run>>["result"],
    message: string,
  ) {
    expect(result.status).toBe("error");
    expect(result.error).toContain(message);
    expect(result.rowsWritten).toBe(0);
    expect(db.matching(/unnest/)).toHaveLength(0);
    expect(db.matching(/^DELETE/)).toHaveLength(0);
    expect(finished(db)).toMatchObject({ status: "error", rowsWritten: 0 });
    expect(finished(db).error).toContain(message);
  }

  test("UUIDs absent from the map are skipped and counted, and the run ends ok", async () => {
    const { result } = await run();
    expect(result.status).toBe("ok");
    expect(result.unmappedUuids).toBe(1);
    expect(result.priceStats?.unmappedUuids).toBe(1);
  });

  test("an empty mtgjson_identifiers → error 'identifiers not loaded', nothing written", async () => {
    const { db, result } = await run({ dbOptions: { identifiers: [] } });
    expectRefused(db, result, IDENTIFIERS_NOT_LOADED);
    // Refused before AllPricesToday's entries are parsed.
    expect(result.priceStats).toBeNull();
  });

  test("missing identifiers win over the budget: an empty table on a 460 MB database → error, no size read, no prune (S0.3d8)", async () => {
    const { db, result } = await run({
      dbOptions: { identifiers: [], sizes: [460_000_000] },
    });
    expectRefused(db, result, IDENTIFIERS_NOT_LOADED);
    expect(db.matching(/pg_database_size/)).toHaveLength(0);
  });

  test("a stale date wins over missing identifiers: Meta.json 2026-10-04 with an empty table → source_stale, no identifier load, one prune (S0.3d8)", async () => {
    const source = spiedSource(
      files({ meta: { date: "2026-10-04", version: META.version } }),
    );
    const { db, result } = await run({
      source,
      dbOptions: { identifiers: [] },
    });
    expect(result.status).toBe("source_stale");
    expect(db.matching(/mtgjson_identifiers/)).toHaveLength(0);
    expect(db.matching(/^DELETE/)).toHaveLength(1);
  });

  test("identifiers present but no TCGplayer-retail UUID maps → the same", async () => {
    const { db, result } = await run({
      dbOptions: {
        identifiers: [
          {
            mtgjsonUuid: "10000000-0000-4000-8000-0000000000ff",
            scryfallId: "20000000-0000-4000-8000-0000000000ff",
            side: null,
            edhrecRank: 1,
          },
        ],
      },
    });
    expectRefused(db, result, IDENTIFIERS_NOT_LOADED);
    expect(result.unmappedUuids).toBe(STANDARD_CARDS.length);
  });

  test("AllPricesToday with an empty data object → error 'no TCGplayer retail prices'", async () => {
    const source = spiedSource({
      [META_FILE]: Buffer.from(metaJson(META)),
      [ALL_PRICES_TODAY_FILE]: gz(JSON.stringify({ meta: META, data: {} })),
    });
    const { db, result } = await run({ source });
    expectRefused(db, result, NO_RETAIL_PRICES);
  });

  test("AllPricesToday with only cardkingdom and mtgo series → the same", async () => {
    const decoy = { normal: series(9.99) };
    const data = Object.fromEntries(
      STANDARD_IDENTIFIERS.map((row) => [
        row.mtgjsonUuid,
        {
          mtgo: { cardhoarder: { currency: "USD", retail: decoy } },
          paper: { cardkingdom: { currency: "USD", retail: decoy } },
        },
      ]),
    );
    const source = spiedSource({
      [META_FILE]: Buffer.from(metaJson(META)),
      [ALL_PRICES_TODAY_FILE]: gz(JSON.stringify({ meta: META, data })),
    });
    const { db, result } = await run({ source });
    expectRefused(db, result, NO_RETAIL_PRICES);
  });

  test("retail UUIDs that map but are all gated out → error 'no price rows emitted'", async () => {
    const gatedOut = STANDARD_CARDS.filter(
      (c) => c.uuid === U.RANK_6000_AT_099 || c.uuid === U.RANK_5001_AT_099,
    );
    const source = spiedSource(files({ cards: gatedOut }));
    const { db, result } = await run({ source });
    expectRefused(db, result, NO_ROWS_EMITTED);
  });

  test("a two-face printing with chunkRows = 1 → one row, side a's price, one collision", async () => {
    const faces = STANDARD_CARDS.filter(
      (c) => c.uuid === U.FACE_A || c.uuid === U.FACE_B,
    );
    // Face b comes first in the file, with a different price.
    expect(faces.map((c) => c.side)).toEqual(["b", "a"]);
    const source = spiedSource(files({ cards: faces }));
    const { db, result } = await run({ source, chunkRows: 1 });
    expect(result.status).toBe("ok");
    expect(upserted(db)).toEqual([
      { scryfallId: S.FACE, finish: "normal", date: RUN_DATE, priceCents: 200 },
    ]);
    expect(db.matching(/unnest/)).toHaveLength(1);
    expect(result.priceStats?.scryfallCollisions).toBe(1);
  });
});

describe("faults (T9, AC-9)", () => {
  test("the stale-marking statement is first and carries STALE_RUN_MS and the fixed message as parameters", async () => {
    const { db } = await run();
    expect(db.statements[0].text).toBe(MARK_STALE_RUNS_SQL);
    expect(db.statements[0].values).toEqual([STALE_RUN_MS, STALE_RUN_MESSAGE]);
    expect(STALE_RUN_MS).toBe(3_600_000);
  });

  test("the second upsert rejects → error with its message, the first chunk counted, no prune", async () => {
    const { db, result } = await run({
      chunkRows: 3,
      dbOptions: {
        identifiers: STANDARD_IDENTIFIERS,
        failOn: {
          match: /unnest/,
          nth: 2,
          error: new Error("chunk 2 refused"),
        },
      },
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("chunk 2 refused");
    expect(result.rowsWritten).toBe(3);
    expect(db.matching(/unnest/)).toHaveLength(2);
    expect(db.matching(/^DELETE/)).toHaveLength(0);
    expect(finished(db)).toMatchObject({
      status: "error",
      rowsWritten: 3,
      rowsPruned: 0,
      dbBytes: null,
    });
  });

  test("the finish update also rejects → the original error returned, one line says the row stays running", async () => {
    const db = new FakeDb({
      identifiers: STANDARD_IDENTIFIERS,
      failOn: [
        { match: /unnest/, nth: 2, error: new Error("chunk 2 refused") },
        {
          match: /"rows_written" = \$3::int4/,
          nth: 1,
          error: new Error("connection lost"),
        },
      ],
    });
    const { result, log } = await run({ db, chunkRows: 3 });
    expect(result.status).toBe("error");
    expect(result.error).toContain("chunk 2 refused");
    expect(result.error).not.toContain("connection lost");
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toMatch(
      /stays running until the next run marks it error[\s\S]*connection lost/,
    );
  });

  test("the first query rejects (a paused database) → error with runId null and no row", async () => {
    const db = new FakeDb({
      failOn: {
        match: /^UPDATE/,
        nth: 1,
        error: new Error(
          "connect failed for postgresql://user:pw-XYZZY@db.example.invalid/postgres",
        ),
      },
    });
    const { result } = await run({ db });
    expect(result.status).toBe("error");
    expect(result.runId).toBeNull();
    expect(result.error).not.toContain("pw-XYZZY");
    expect(db.matching(/INSERT INTO "price_sync_runs"/)).toHaveLength(0);
  });

  describe("source faults (download and parse)", () => {
    let dir: string | undefined;
    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
      dir = undefined;
    });

    const httpSource = async (
      serve: (name: string) => Response | Promise<Response>,
      idleTimeoutMs?: number,
    ) => {
      dir = await mkdtemp(path.join(os.tmpdir(), "mox-sync-test-"));
      return createHttpSource({
        cacheDir: dir,
        idleTimeoutMs,
        fetchImpl: (async (url: string | URL | Request) =>
          serve(path.basename(String(url)))) as typeof fetch,
      });
    };

    const expectNothingWritten = (db: FakeDb) => {
      expect(db.matching(/unnest/)).toHaveLength(0);
      expect(db.matching(/^DELETE/)).toHaveLength(0);
      expect(finished(db)).toMatchObject({ status: "error", rowsWritten: 0 });
    };

    test("Meta.json 404 → error, nothing written, the run row is the heartbeat", async () => {
      const source = await httpSource(
        () => new Response("not found", { status: 404 }),
      );
      const { db, result } = await run({ source });
      expect(result.status).toBe("error");
      expect(result.error).toMatch(/Meta\.json: HTTP 404/);
      expect(result.runId).toBe(1);
      expectNothingWritten(db);
    });

    test("an AllPricesToday stall (idle timeout) → error, nothing written", async () => {
      const meta = Buffer.from(metaJson(META));
      const source = await httpSource((name) => {
        if (name === META_FILE) {
          return new Response(new Uint8Array(meta), {
            headers: { "content-length": String(meta.length) },
          });
        }
        // Two gzip bytes, then silence.
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([0x1f, 0x8b]));
          },
        });
        return new Response(body);
      }, 50);
      const { db, result } = await run({ source });
      expect(result.status).toBe("error");
      expect(result.error).toMatch(/no data for 50 ms/);
      expectNothingWritten(db);
    });

    test.each([
      [
        "truncated",
        (bytes: Buffer) => bytes.subarray(0, Math.floor(bytes.length / 2)),
      ],
      [
        "corrupt (CRC)",
        (bytes: Buffer) => {
          const copy = Buffer.from(bytes);
          copy[copy.length - 6] ^= 0xff; // inside the CRC32 trailer
          return copy;
        },
      ],
    ])(
      "a %s AllPricesToday → error, nothing written",
      async (_label, damage) => {
        const input = files();
        input[ALL_PRICES_TODAY_FILE] = damage(input[ALL_PRICES_TODAY_FILE]!);
        const { db, result } = await run({ source: spiedSource(input) });
        expect(result.status).toBe("error");
        expectNothingWritten(db);
        expect(db.matching(/mtgjson_identifiers/)).toHaveLength(0);
      },
    );

    test("a JSON syntax error mid-stream → error, nothing written", async () => {
      const whole = allPricesTodayJson(STANDARD_CARDS, RUN_DATE, META);
      const broken = `${whole.slice(0, Math.floor(whole.length * 0.6))}]]]}`;
      const input = files();
      input[ALL_PRICES_TODAY_FILE] = gz(broken);
      const { db, result } = await run({ source: spiedSource(input) });
      expect(result.status).toBe("error");
      expect(result.error).toMatch(/SourceFormatError/);
      expectNothingWritten(db);
    });
  });

  test("the deadline reached between chunks → error 'deadline exceeded', committed chunks kept, no prune", async () => {
    let now = 0;
    const db = new FakeDb({
      identifiers: STANDARD_IDENTIFIERS,
      onStatement: ({ text }) => {
        if (/unnest/.test(text)) now += 1_000;
      },
    });
    const { result } = await run({
      db,
      chunkRows: 3,
      deadlineMs: 500,
      clock: () => now,
    });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/deadline exceeded/);
    expect(result.rowsWritten).toBe(3);
    expect(db.matching(/unnest/)).toHaveLength(1);
    expect(db.matching(/^DELETE/)).toHaveLength(0);
    expect(finished(db)).toMatchObject({ status: "error", rowsWritten: 3 });
  });

  test("the deadline reached while parsing → error before any upsert", async () => {
    let now = 0;
    const base = spiedSource();
    let todayOpens = 0;
    const source: typeof base = {
      ...base,
      open(name) {
        // The second open of AllPricesToday is the parser's: time jumps there.
        if (name === ALL_PRICES_TODAY_FILE && ++todayOpens === 2) now += 1_000;
        return base.open(name);
      },
    };
    const { db, result } = await run({
      source,
      deadlineMs: 500,
      clock: () => now,
    });
    expect(todayOpens).toBe(2);
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/deadline exceeded/);
    expect(db.matching(/mtgjson_identifiers/)).toHaveLength(1);
    expect(db.matching(/pg_database_size/)).toHaveLength(0);
    expect(db.matching(/unnest/)).toHaveLength(0);
    expect(db.matching(/^DELETE/)).toHaveLength(0);
  });

  test("a redact function is applied before the error is stored or returned", async () => {
    const { db, result } = await run({
      redact: (text) => text.split("chunk").join("[x]"),
      chunkRows: 3,
      dbOptions: {
        identifiers: STANDARD_IDENTIFIERS,
        failOn: { match: /unnest/, nth: 1, error: new Error("chunk failed") },
      },
    });
    expect(result.error).toContain("[x] failed");
    expect(finished(db).error).toContain("[x] failed");
  });
});

describe("streaming (T10, AC-11)", () => {
  test("JSON.parse never receives AllPricesToday's text during a full sync", async () => {
    const parse = vi.spyOn(JSON, "parse");
    const { result } = await run();
    expect(result.status).toBe("ok");
    // U.UNMAPPED appears only in AllPricesToday (never in the identifiers).
    for (const [text] of parse.mock.calls) {
      expect(String(text)).not.toContain(U.UNMAPPED);
    }
  });

  test("sync.ts reads AllPricesToday only through parsePrices and readMeta", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(path.join(__dirname, "sync.ts"), "utf8");
    const parseImport = text.match(/import \{([^}]*)\} from "\.\/parse";/)?.[1];
    expect(
      parseImport
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ).toEqual([
      "emptyParseStats",
      "parsePrices",
      "readMeta",
      "type MtgjsonMeta",
    ]);
    expect(text).not.toMatch(/\bJSON\s*\.\s*parse\b/);
    expect(text).not.toMatch(/from "node:fs/);
    expect(text).not.toMatch(
      /\.json\s*\(\s*\)|\.text\s*\(\s*\)|\.arrayBuffer\s*\(/,
    );
  });
});

describe("today's rows only, under a cap (T8, ADV.8, S0.3d25)", () => {
  test("an AllPricesToday carrying 31 dates per series on a 449 MB database → only runDate's rows written, a warning, ok", async () => {
    const cards = manyCards(3, 31);
    const source = spiedSource({
      [META_FILE]: Buffer.from(metaJson(META)),
      [ALL_PRICES_TODAY_FILE]: gz(allPricesJson(cards, META)),
    });
    const { db, result, log } = await run({
      source,
      dbOptions: { identifiers: identifiersFor(cards), sizes: [449_000_000] },
    });
    expect(result.status).toBe("ok");
    const written = upserted(db);
    expect(written).toHaveLength(3);
    expect(new Set(written.map((r) => r.date))).toEqual(new Set([RUN_DATE]));
    expect(result.rowsWritten).toBe(3);
    // Two size reads only (before and after), and one other-dates warning
    // plus the 400 MB one.
    expect(db.matching(/pg_database_size/)).toHaveLength(2);
    const warnings = log.warn.mock.calls.map((c) => String(c[0]));
    expect(
      warnings.filter((w) => /dated other than 2026-10-05/.test(w)),
    ).toEqual([
      expect.stringContaining(
        "carried 90 in-window prices dated other than 2026-10-05",
      ),
    ]);
  });

  test("series whose only in-window dates are before runDate → error 'no price rows emitted', nothing written, no prune", async () => {
    const cards = manyCards(2, 30); // 2026-09-05 … 2026-10-04: never runDate
    const source = spiedSource({
      [META_FILE]: Buffer.from(metaJson(META)),
      [ALL_PRICES_TODAY_FILE]: gz(allPricesJson(cards, META)),
    });
    const { db, result } = await run({
      source,
      dbOptions: { identifiers: identifiersFor(cards) },
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain(NO_ROWS_EMITTED);
    expect(result.error).toContain("60 on other dates");
    expect(db.matching(/unnest/)).toHaveLength(0);
    expect(db.matching(/^DELETE/)).toHaveLength(0);
  });

  test("more runDate rows than maxRows → error 'too many price rows', nothing written, no size read, no prune", async () => {
    const { db, result } = await run({ maxRows: 6 });
    expect(TODAY_ROWS).toHaveLength(7);
    expect(result.status).toBe("error");
    expect(result.error).toContain(TOO_MANY_ROWS);
    expect(result.error).toContain("more than 6 rows for 2026-10-05");
    expect(db.matching(/unnest/)).toHaveLength(0);
    expect(db.matching(/pg_database_size/)).toHaveLength(0);
    expect(db.matching(/^DELETE/)).toHaveLength(0);
    expect(finished(db)).toMatchObject({ status: "error", rowsWritten: 0 });
  });

  test("exactly maxRows runDate rows → written", async () => {
    const { result } = await run({ maxRows: 7 });
    expect(result.status).toBe("ok");
    expect(result.rowsWritten).toBe(7);
  });

  test("the cap is 3 × the 73,323 rows a real AllPricesToday emitted, rounded, and a bad maxRows is refused", async () => {
    expect(SYNC_MAX_ROWS).toBe(220_000);
    expect(SYNC_MAX_ROWS).toBeGreaterThanOrEqual(3 * 73_323);
    for (const maxRows of [0, -1, 2.5]) {
      const db = new FakeDb();
      await expect(
        runDailySync({ db, source: spiedSource(), now: () => NOW, maxRows }),
      ).rejects.toThrow(/maxRows/);
      expect(db.statements).toHaveLength(0);
    }
  });
});

describe("the deadline bounds every await (T9, ADV.2)", () => {
  const quick = async (options: RunOptions) => {
    const t0 = performance.now();
    const outcome = await run({ deadlineMs: 200, ...options });
    return { ...outcome, elapsedMs: performance.now() - t0 };
  };

  test("a hung first query (connect) → error with runId null, no row, within about a second", async () => {
    const base = new FakeDb({ identifiers: STANDARD_IDENTIFIERS });
    const { result, elapsedMs } = await quick({
      db: hangingOn(
        base,
        /^UPDATE "price_sync_runs"[\s\S]*'running'/,
      ) as FakeDb,
    });
    expect(elapsedMs).toBeLessThan(1_500);
    expect(result.status).toBe("error");
    expect(result.runId).toBeNull();
    expect(result.error).toMatch(
      /deadline exceeded: 200 ms into the run, during the stale-run update; nothing written/,
    );
    expect(base.matching(/INSERT INTO "price_sync_runs"/)).toHaveLength(0);
  });

  test("a hung identifier load → error, the run row finished, nothing written", async () => {
    const base = new FakeDb({ identifiers: STANDARD_IDENTIFIERS });
    const { result, elapsedMs } = await quick({
      db: hangingOn(base, /FROM "mtgjson_identifiers"/) as FakeDb,
    });
    expect(elapsedMs).toBeLessThan(1_500);
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/during the identifier load; nothing written/);
    expect(base.matching(/unnest/)).toHaveLength(0);
    expect(finished(base)).toMatchObject({ status: "error", rowsWritten: 0 });
  });

  test("a hung second upsert → error, the first chunk counted, the row finished, no prune", async () => {
    const base = new FakeDb({ identifiers: STANDARD_IDENTIFIERS });
    const { result, elapsedMs } = await quick({
      db: hangingOn(base, /unnest/, 2) as FakeDb,
      chunkRows: 3,
    });
    expect(elapsedMs).toBeLessThan(1_500);
    expect(result.status).toBe("error");
    expect(result.error).toMatch(
      /during the upserts; committed chunks kept, nothing pruned/,
    );
    expect(result.rowsWritten).toBe(3);
    expect(base.matching(/unnest/)).toHaveLength(2);
    expect(base.matching(/^DELETE/)).toHaveLength(0);
    expect(finished(base)).toMatchObject({
      status: "error",
      rowsWritten: 3,
      rowsPruned: 0,
    });
  });

  test("a hung prune → error saying the prune may still complete; the row is finished error", async () => {
    const base = new FakeDb({ identifiers: STANDARD_IDENTIFIERS });
    const { result } = await quick({
      db: hangingOn(base, /^DELETE/) as FakeDb,
    });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(
      /during the prune; the prune was sent and may still complete/,
    );
    expect(finished(base)).toMatchObject({
      status: "error",
      rowsWritten: 7,
      rowsPruned: 0,
    });
  });

  test("a download that never settles → error, nothing written", async () => {
    const base = spiedSource();
    const source: typeof base = {
      ...base,
      async prepare(names) {
        if (names.includes(ALL_PRICES_TODAY_FILE)) {
          return new Promise<void>(() => undefined);
        }
        return base.prepare(names);
      },
    };
    const { db, result, elapsedMs } = await quick({ source });
    expect(elapsedMs).toBeLessThan(1_500);
    expect(result.status).toBe("error");
    expect(result.error).toMatch(
      /during AllPricesToday\.json\.gz; nothing written/,
    );
    expect(db.matching(/mtgjson_identifiers/)).toHaveLength(0);
    expect(finished(db)).toMatchObject({ status: "error", rowsWritten: 0 });
  });

  test("the deadline fired while parsing says nothing was written", async () => {
    let now = 0;
    const base = spiedSource();
    let todayOpens = 0;
    const source: typeof base = {
      ...base,
      open(name) {
        if (name === ALL_PRICES_TODAY_FILE && ++todayOpens === 2) now += 1_000;
        return base.open(name);
      },
    };
    const { result } = await run({ source, deadlineMs: 500, clock: () => now });
    expect(result.error).toMatch(/during the parse; nothing written/);
  });

  test("a hung final update on an ok run → its own grace, the outcome kept with an error, one line", async () => {
    const base = new FakeDb({ identifiers: STANDARD_IDENTIFIERS });
    const { result, log, elapsedMs } = await quick({
      db: hangingOn(base, /"rows_written" = \$3::int4/) as FakeDb,
      deadlineMs: 60_000,
      finishGraceMs: 100,
    });
    expect(elapsedMs).toBeLessThan(1_500);
    expect(result.status).toBe("ok");
    expect(result.error).toMatch(
      /outcome ok not recorded[\s\S]*took longer than 100 ms/,
    );
    expect(finishStatuses(base)).toEqual(["ok"]);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  test("a hung final update on an error run → the original error, one line that the row stays running", async () => {
    const base = new FakeDb({ identifiers: [] });
    const { result, log } = await quick({
      db: hangingOn(base, /"rows_written" = \$3::int4/) as FakeDb,
      deadlineMs: 60_000,
      finishGraceMs: 100,
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain(IDENTIFIERS_NOT_LOADED);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toMatch(
      /stays running until the next run marks it error[\s\S]*took longer than 100 ms/,
    );
  });
});

describe("after the prune, nothing rewrites the row as error (T9, ADV.4)", () => {
  test("the size read after the prune fails → ok with db_bytes null, one warning, one finish", async () => {
    const { db, result, log } = await run({
      dbOptions: {
        identifiers: STANDARD_IDENTIFIERS,
        failOn: {
          match: /pg_database_size/,
          nth: 2,
          error: new Error("connection reset"),
        },
      },
    });
    expect(result.status).toBe("ok");
    expect(result.error).toBeNull();
    expect(result.dbBytes).toBeNull();
    expect(db.matching(/^DELETE/)).toHaveLength(1);
    expect(finished(db)).toEqual({
      id: 1,
      status: "ok",
      rowsWritten: 7,
      rowsPruned: 0,
      unmappedUuids: 1,
      dbBytes: null,
      error: null,
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatch(
      /size after the prune could not be read[\s\S]*connection reset/,
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  test.each([
    ["ok", files(), [100_000_000]],
    [
      "source_stale",
      files({ meta: { date: "2026-10-04", version: META.version } }),
      [100_000_000],
    ],
    ["budget_stop", files(), [450_000_001]],
  ] as const)(
    "the final update rejects on a %s run → no second finish, the status kept with an error, one error line",
    async (status, input, sizes) => {
      const { db, result, log } = await run({
        source: spiedSource(input),
        dbOptions: {
          identifiers: STANDARD_IDENTIFIERS,
          sizes,
          failOn: {
            match: /"rows_written" = \$3::int4/,
            nth: 1,
            error: new Error("connection reset after commit"),
          },
        },
      });
      expect(finishStatuses(db)).toEqual([status]);
      expect(db.matching(/^DELETE/)).toHaveLength(1);
      expect(result.status).toBe(status);
      expect(result.error).toMatch(
        new RegExp(
          `outcome ${status} not recorded[\\s\\S]*connection reset after commit`,
        ),
      );
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(log.error.mock.calls[0][0]).toMatch(
        new RegExp(`the outcome ${status} may not be recorded`),
      );
    },
  );
});

describe("the deadline's default (T9, ADV.11)", () => {
  test("SYNC_DEADLINE_MS is 270 s", () => {
    expect(SYNC_DEADLINE_MS).toBe(270_000);
  });

  test("with no deadlineMs, a clock that jumps past SYNC_DEADLINE_MS at the first upsert ends the run error", async () => {
    let now = 0;
    const db = new FakeDb({
      identifiers: STANDARD_IDENTIFIERS,
      onStatement: ({ text }) => {
        if (text === UPSERT_PRICES_SQL) now += SYNC_DEADLINE_MS + 1;
      },
    });
    const { result } = await run({ db, clock: () => now });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/deadline exceeded: 270000 ms/);
    expect(db.matching(/^DELETE/)).toHaveLength(0);
  });

  test("with no deadlineMs, a clock that stays just inside SYNC_DEADLINE_MS lets the run finish ok", async () => {
    let now = 0;
    const db = new FakeDb({
      identifiers: STANDARD_IDENTIFIERS,
      onStatement: ({ text }) => {
        if (text === UPSERT_PRICES_SQL) now += SYNC_DEADLINE_MS - 1;
      },
    });
    const { result } = await run({ db, clock: () => now });
    expect(result.status).toBe("ok");
  });

  test("the deadline checked after Meta.json: a clock jump while it opens → AllPricesToday never prepared", async () => {
    let now = 0;
    const base = spiedSource();
    const source: typeof base = {
      ...base,
      open(name) {
        if (name === META_FILE) now += SYNC_DEADLINE_MS + 1;
        return base.open(name);
      },
    };
    const { result } = await run({ source, clock: () => now });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/deadline exceeded/);
    expect(base.prepared).toEqual([META_FILE]);
  });
});

describe("phase timings (T4, ADV.12)", () => {
  test("each phase is charged exactly its own time; total adds the untimed statements", async () => {
    let now = 0;
    const db = new FakeDb({
      identifiers: STANDARD_IDENTIFIERS,
      onStatement: ({ text }) => {
        if (text === MARK_STALE_RUNS_SQL) now += 7; // untimed
        if (text === LOAD_IDENTIFIERS_SQL) now += 10;
        if (text === UPSERT_PRICES_SQL) now += 1;
        if (text === PRUNE_SQL) now += 1_000;
      },
    });
    const base = spiedSource();
    let todayOpens = 0;
    const source: typeof base = {
      ...base,
      async prepare(names) {
        now += 100;
        return base.prepare(names);
      },
      open(name) {
        // The parser's open of AllPricesToday is the second one.
        if (name === ALL_PRICES_TODAY_FILE && ++todayOpens === 2) now += 5;
        return base.open(name);
      },
    };
    const { result } = await run({
      db,
      source,
      chunkRows: 3,
      clock: () => now,
    });
    expect(result.status).toBe("ok");
    expect(result.phasesMs).toEqual({
      fetch: 200,
      identifiers: 10,
      parse: 5,
      upserts: 3,
      prune: 1_000,
      total: 1_225,
    });
  });
});
