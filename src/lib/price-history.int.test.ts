// T4 (AC-3), T5 (AC-4), T6 (AC-5), T9 (AC-7) and T10 (AC-8): the F0 reader
// against a real Postgres. One scratch database on the server named by
// POSTGRES_URL_NON_POOLING (localhost only), both migrations deployed, seeded
// with parameterized pg inserts (never through the reader), dropped
// afterwards. Unreachable server: fails when CI=true, skips with a warning
// otherwise (S0.1d10, AC-10).
//
// AC-4: the zone is set before any Date exists in this file.
process.env.TZ = "America/Toronto";

import { PrismaClient } from "@/generated/prisma/client";
import {
  ESPER_SENTINEL_PRINTS,
  MH2_12_ID,
  scryfallCard,
} from "@/lib/__fixtures__/esper-sentinel-prints";
import {
  buildEvaluation,
  type EvaluationDeps,
} from "@/lib/evaluation/build-evaluation";
import type { PriceHistoryReader } from "@/lib/evaluation/history-reader";
import { createPriceHistoryReader } from "@/lib/price-history";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  CI_UNREACHABLE_TEST,
  createScratchDatabase,
  dropScratchDatabase,
  IN_CI,
  prismaCli,
  probeScratchServer,
  type ScratchDatabase,
} from "../../tests/helpers/scratch-db";

const server = await probeScratchServer();

const ID_A = "f3537373-ef54-4578-9d05-6216420ee349"; // mh2 #12
const ID_B = "f8b6c532-b837-42b6-9ed2-0231d0779626"; // sld #2123
const ID_NONE = "00000000-0000-4000-8000-000000000000";
const ID_EDGE = [
  "0b9a3f4e-1111-4c1d-9d2e-000000000001",
  "0b9a3f4e-1111-4c1d-9d2e-000000000002",
  "0b9a3f4e-1111-4c1d-9d2e-000000000003",
];
const ID_TZ = "0b9a3f4e-2222-4c1d-9d2e-000000000001";
const ID_LATEST = "0b9a3f4e-3333-4c1d-9d2e-000000000001";
const AS_OF = "2026-10-10";
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0, 0);
const HOUR = 3_600_000;

/** iso ± days, computed in UTC (test fixture arithmetic only). */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** A reader client: Prisma over pg, every statement recorded twice. */
interface InstrumentedReader {
  reader: PriceHistoryReader;
  prisma: InstanceType<typeof PrismaClient>;
  /** Prisma's own query log events (S0.1d11). */
  events: string[];
  /** Every statement pg sent on any pooled connection, with its values. */
  wire: { text: string; values: unknown[] }[];
  close(): Promise<void>;
}

/**
 * Builds the reader over a client whose connections are read-only
 * (`options=-c default_transaction_read_only=on`, S0.1d11), optionally with a
 * session TimeZone.
 */
function instrumentedReader(
  dbUrl: string,
  timeZone?: string,
): InstrumentedReader {
  const url = new URL(dbUrl);
  const options = ["-c default_transaction_read_only=on"];
  if (timeZone) options.push(`-c TimeZone=${timeZone}`);
  url.searchParams.set("options", options.join(" "));
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  const wire: InstrumentedReader["wire"] = [];
  pool.on("connect", (connection) => {
    const query = connection.query.bind(connection) as (
      ...args: unknown[]
    ) => unknown;
    (connection as unknown as { query: unknown }).query = (
      ...args: unknown[]
    ) => {
      const [first, second] = args;
      if (typeof first === "string") {
        wire.push({
          text: first,
          values: Array.isArray(second) ? second : [],
        });
      } else if (first && typeof first === "object" && "text" in first) {
        const config = first as { text: string; values?: unknown[] };
        wire.push({ text: config.text, values: config.values ?? [] });
      }
      return query(...args);
    };
  });
  const prisma = new PrismaClient({
    // The adapter bundles its own pg typings; the runtime Pool is the same.
    adapter: new PrismaPg(
      pool as unknown as ConstructorParameters<typeof PrismaPg>[0],
    ),
    log: [{ emit: "event", level: "query" }],
  });
  const events: string[] = [];
  prisma.$on("query", (e) => events.push(e.query));
  return {
    reader: createPriceHistoryReader(async () => prisma),
    prisma,
    events,
    wire,
    async close() {
      await prisma.$disconnect();
      await pool.end().catch(() => undefined);
    },
  };
}

describe.runIf(IN_CI && !server.reachable)(
  "the F0 reader (CI without a database)",
  () => {
    test(CI_UNREACHABLE_TEST, () => {
      expect.fail(
        `local Postgres unreachable in CI (${server.reachable ? "" : server.reason})`,
      );
    });
  },
);

describe.skipIf(!server.reachable)(
  "the F0 reader against a local Postgres",
  () => {
    const serverUrl = server.url!;
    let db: ScratchDatabase;
    let seed: pg.Client;
    let main: InstrumentedReader;

    const insertRow = (
      id: string,
      finish: string,
      date: string,
      cents: number,
      syncedAt?: string,
    ) =>
      seed.query(
        `INSERT INTO price_history (scryfall_id, finish, date, price_cents, synced_at)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))`,
        [id, finish, date, cents, syncedAt ?? null],
      );

    beforeAll(async () => {
      db = await createScratchDatabase(serverUrl, "mox_s01_reader");
      const deploy = prismaCli(["migrate", "deploy"], db.url);
      if (deploy.status !== 0) throw new Error(deploy.output);
      seed = new pg.Client({ connectionString: db.url });
      await seed.connect();
      main = instrumentedReader(db.url);

      // T4: five dates for each of four series, distinct cents per series.
      const dates = [-31, -30, -1, 0, 1].map((n) => addDays(AS_OF, n));
      const series: [string, string, number][] = [
        [ID_A, "foil", 1000],
        [ID_A, "normal", 2000],
        [ID_A, "etched", 3000],
        [ID_B, "foil", 4000],
      ];
      for (const [id, finish, base] of series) {
        for (const [i, date] of dates.entries()) {
          await insertRow(id, finish, date, base + i);
        }
      }
      // T4 calendar edges: the first included date and the day before it.
      const edges: [string, string][] = [
        ["2026-03-01", "2026-01-30"],
        ["2028-03-01", "2028-01-31"],
        ["2027-01-15", "2026-12-16"],
      ];
      for (const [i, [, first]] of edges.entries()) {
        await insertRow(ID_EDGE[i], "normal", addDays(first, -1), 111);
        await insertRow(ID_EDGE[i], "normal", first, 222);
      }
      // T5: a plain date and both of Toronto's 2026 DST changes.
      for (const date of ["2026-10-05", "2026-03-08", "2026-11-01"]) {
        await insertRow(ID_TZ, "normal", date, 500);
      }
      // T6: the AS_OF row is the newest returned; AS_OF + 1 and a
      // republished older row both carry later synced_at values.
      await insertRow(
        ID_LATEST,
        "normal",
        addDays(AS_OF, -2),
        700,
        "2026-10-10T17:00:00.789Z",
      );
      await insertRow(
        ID_LATEST,
        "normal",
        addDays(AS_OF, -1),
        710,
        "2026-10-09T06:00:00.111Z",
      );
      await insertRow(
        ID_LATEST,
        "normal",
        AS_OF,
        720,
        "2026-10-10T06:00:00.123Z",
      );
      await insertRow(
        ID_LATEST,
        "normal",
        addDays(AS_OF, 1),
        730,
        "2026-10-11T06:00:00.456Z",
      );
      await seed.query("ANALYZE price_history");
    });

    afterAll(async () => {
      await main?.close();
      await seed?.end().catch(() => undefined);
      if (db) await dropScratchDatabase(serverUrl, db.name);
    });

    describe("the window (T4, AC-3)", () => {
      test("(ID_A, foil) returns exactly asOf − 30, − 1 and asOf, ascending, as { date, priceCents }", async () => {
        const result = await main.reader.getPriceHistory(ID_A, "foil", AS_OF);
        expect(result.history).toEqual([
          { date: "2026-09-10", priceCents: 1001 },
          { date: "2026-10-09", priceCents: 1002 },
          { date: "2026-10-10", priceCents: 1003 },
        ]);
        for (const row of result.history) {
          expect(Object.keys(row).sort()).toEqual(["date", "priceCents"]);
          expect(Number.isInteger(row.priceCents)).toBe(true);
        }
      });

      test.each([
        [ID_A, "normal", 2000],
        [ID_A, "etched", 3000],
        [ID_B, "foil", 4000],
      ] as const)(
        "(%s, %s) returns only its own three rows",
        async (id, finish, base) => {
          const { history } = await main.reader.getPriceHistory(
            id,
            finish,
            AS_OF,
          );
          expect(history).toEqual([
            { date: "2026-09-10", priceCents: base + 1 },
            { date: "2026-10-09", priceCents: base + 2 },
            { date: "2026-10-10", priceCents: base + 3 },
          ]);
        },
      );

      test("an id with no rows returns { history: [], latestSnapshotAt: null }", async () => {
        await expect(
          main.reader.getPriceHistory(ID_NONE, "foil", AS_OF),
        ).resolves.toEqual({ history: [], latestSnapshotAt: null });
      });

      test("an upper-case UUID reads the same rows", async () => {
        const { history } = await main.reader.getPriceHistory(
          ID_A.toUpperCase(),
          "foil",
          AS_OF,
        );
        expect(history.map((r) => r.priceCents)).toEqual([1001, 1002, 1003]);
      });

      test.each([
        [0, "2026-03-01", "2026-01-30"],
        [1, "2028-03-01", "2028-01-31"],
        [2, "2027-01-15", "2026-12-16"],
      ] as const)(
        "calendar edge %#: asOf %s starts the window at %s",
        async (i, asOf, first) => {
          const { history } = await main.reader.getPriceHistory(
            ID_EDGE[i],
            "normal",
            asOf,
          );
          expect(history).toEqual([{ date: first, priceCents: 222 }]);
        },
      );
    });

    describe("time zones (T5, AC-4)", () => {
      afterAll(() => {
        process.env.TZ = "America/Toronto";
      });

      const readTzRows = async (reader: PriceHistoryReader) => {
        const dates: string[] = [];
        for (const asOf of ["2026-10-05", "2026-03-08", "2026-11-01"]) {
          const { history } = await reader.getPriceHistory(
            ID_TZ,
            "normal",
            asOf,
          );
          dates.push(history[history.length - 1]?.date);
        }
        return dates;
      };

      test("under TZ=America/Toronto (offset non-zero) each row returns its own date", async () => {
        process.env.TZ = "America/Toronto";
        expect(new Date(NOW).getTimezoneOffset()).toBe(240);
        expect(await readTzRows(main.reader)).toEqual([
          "2026-10-05",
          "2026-03-08",
          "2026-11-01",
        ]);
      });

      test("under TZ=Pacific/Kiritimati (UTC+14) each row returns its own date", async () => {
        process.env.TZ = "Pacific/Kiritimati";
        expect(new Date(NOW).getTimezoneOffset()).toBe(-840);
        expect(await readTzRows(main.reader)).toEqual([
          "2026-10-05",
          "2026-03-08",
          "2026-11-01",
        ]);
      });

      test("with the database session's TimeZone at Pacific/Kiritimati each row returns its own date", async () => {
        process.env.TZ = "America/Toronto";
        const kiritimati = instrumentedReader(db.url, "Pacific/Kiritimati");
        try {
          const [zone] = await kiritimati.prisma.$queryRaw<
            { zone: string }[]
          >`SELECT current_setting('TimeZone') AS zone`;
          expect(zone.zone).toBe("Pacific/Kiritimati");
          expect(await readTzRows(kiritimati.reader)).toEqual([
            "2026-10-05",
            "2026-03-08",
            "2026-11-01",
          ]);
        } finally {
          await kiritimati.close();
        }
      });

      // S0.1 Deviation 2: @prisma/adapter-pg 7.5 rewrites a timestamptz's
      // offset to +00:00, so a raw timestamptz column read under a non-UTC
      // session shifts by the offset. CI's postgres:16 runs in UTC, so each
      // zone is forced per connection here.
      test.each(["UTC", "America/Toronto", "Pacific/Kiritimati"])(
        "with the session TimeZone at %s, latestSnapshotAt and lastSuccessAt are the exact instants",
        async (zone) => {
          await seed.query("TRUNCATE price_sync_runs RESTART IDENTITY");
          await seed.query(
            `INSERT INTO price_sync_runs (trigger, status, finished_at, source_date)
             VALUES ('cron', 'ok', '2026-10-10T09:30:00.456Z'::timestamptz, '2026-10-09')`,
          );
          const zoned = instrumentedReader(db.url, zone);
          try {
            const [{ current }] = await zoned.prisma.$queryRaw<
              { current: string }[]
            >`SELECT current_setting('TimeZone') AS current`;
            expect(current).toBe(zone);
            const { latestSnapshotAt } = await zoned.reader.getPriceHistory(
              ID_LATEST,
              "normal",
              AS_OF,
            );
            expect(latestSnapshotAt?.toISOString()).toBe(
              "2026-10-10T06:00:00.123Z",
            );
            await expect(zoned.reader.getHistoryFreshness()).resolves.toEqual({
              lastSuccessAt: new Date("2026-10-10T09:30:00.456Z"),
              sourceDate: "2026-10-09",
            });
          } finally {
            await zoned.close();
          }
        },
      );
    });

    describe("latestSnapshotAt (T6, AC-5)", () => {
      test("is the synced_at of the newest returned row, to the millisecond", async () => {
        const { history, latestSnapshotAt } = await main.reader.getPriceHistory(
          ID_LATEST,
          "normal",
          AS_OF,
        );
        expect(history.map((r) => r.date)).toEqual([
          "2026-10-08",
          "2026-10-09",
          "2026-10-10",
        ]);
        expect(latestSnapshotAt).toBeInstanceOf(Date);
        expect(latestSnapshotAt?.toISOString()).toBe(
          "2026-10-10T06:00:00.123Z",
        );
      });

      test("neither the out-of-window asOf + 1 row nor a republished older row moves it", async () => {
        const { latestSnapshotAt } = await main.reader.getPriceHistory(
          ID_LATEST,
          "normal",
          AS_OF,
        );
        expect(latestSnapshotAt?.getTime()).not.toBe(
          Date.parse("2026-10-11T06:00:00.456Z"),
        );
        expect(latestSnapshotAt?.getTime()).not.toBe(
          Date.parse("2026-10-10T17:00:00.789Z"),
        );
      });

      test("is null with no rows", async () => {
        const { latestSnapshotAt } = await main.reader.getPriceHistory(
          ID_LATEST,
          "foil",
          AS_OF,
        );
        expect(latestSnapshotAt).toBeNull();
      });
    });

    describe("freshness (T9, AC-7)", () => {
      interface Run {
        trigger: "cron" | "bulk" | "identifiers";
        status: "running" | "ok" | "source_stale" | "budget_stop" | "error";
        finishedAt?: number | null;
        sourceDate?: string | null;
      }

      async function runs(...rows: Run[]) {
        await seed.query("TRUNCATE price_sync_runs RESTART IDENTITY");
        for (const r of rows) {
          await seed.query(
            `INSERT INTO price_sync_runs (trigger, status, started_at, finished_at, source_date)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              r.trigger,
              r.status,
              new Date(NOW - 30 * 24 * HOUR),
              r.finishedAt == null ? null : new Date(r.finishedAt),
              r.sourceDate ?? null,
            ],
          );
        }
      }

      const cronOk: Run = {
        trigger: "cron",
        status: "ok",
        finishedAt: NOW - 3 * HOUR,
        sourceDate: "2026-10-09",
      };

      test("(a) newer running, source_stale, budget_stop, error and identifiers ok rows never count", async () => {
        await runs(
          { trigger: "bulk", status: "ok", finishedAt: NOW - 48 * HOUR },
          cronOk,
          { trigger: "cron", status: "running", finishedAt: null },
          {
            trigger: "cron",
            status: "source_stale",
            finishedAt: NOW - 2 * HOUR,
            sourceDate: "2026-10-10",
          },
          {
            trigger: "bulk",
            status: "budget_stop",
            finishedAt: NOW - HOUR,
            sourceDate: "2026-10-10",
          },
          { trigger: "cron", status: "error", finishedAt: NOW - HOUR / 2 },
          {
            trigger: "identifiers",
            status: "ok",
            finishedAt: NOW - HOUR / 4,
            sourceDate: "2026-10-10",
          },
        );
        await expect(main.reader.getHistoryFreshness()).resolves.toEqual({
          lastSuccessAt: new Date(NOW - 3 * HOUR),
          sourceDate: "2026-10-09",
        });
      });

      test("(b) a newer bulk ok run beside the cron run wins", async () => {
        await runs(cronOk, {
          trigger: "bulk",
          status: "ok",
          finishedAt: NOW - HOUR,
          sourceDate: "2026-10-08",
        });
        await expect(main.reader.getHistoryFreshness()).resolves.toEqual({
          lastSuccessAt: new Date(NOW - HOUR),
          sourceDate: "2026-10-08",
        });
      });

      test("(c) only non-ok runs and an identifiers ok run → both null", async () => {
        await runs(
          { trigger: "cron", status: "error", finishedAt: NOW - HOUR },
          {
            trigger: "cron",
            status: "source_stale",
            finishedAt: NOW - 2 * HOUR,
          },
          { trigger: "bulk", status: "budget_stop", finishedAt: NOW },
          { trigger: "bulk", status: "running" },
          {
            trigger: "identifiers",
            status: "ok",
            finishedAt: NOW - HOUR,
            sourceDate: "2026-10-09",
          },
        );
        await expect(main.reader.getHistoryFreshness()).resolves.toEqual({
          lastSuccessAt: null,
          sourceDate: null,
        });
      });

      test("(d) an empty table → both null", async () => {
        await runs();
        await expect(main.reader.getHistoryFreshness()).resolves.toEqual({
          lastSuccessAt: null,
          sourceDate: null,
        });
      });

      test("(e) an ok cron row with a null finished_at is ignored, never returned as a null lastSuccessAt", async () => {
        await runs(cronOk, {
          trigger: "cron",
          status: "ok",
          finishedAt: null,
          sourceDate: "2026-10-10",
        });
        await expect(main.reader.getHistoryFreshness()).resolves.toEqual({
          lastSuccessAt: new Date(NOW - 3 * HOUR),
          sourceDate: "2026-10-09",
        });
        await runs({ trigger: "cron", status: "ok", finishedAt: null });
        await expect(main.reader.getHistoryFreshness()).resolves.toEqual({
          lastSuccessAt: null,
          sourceDate: null,
        });
      });

      test("(f) an ok cron run with a null source_date → its finished_at and sourceDate null", async () => {
        await runs({
          trigger: "cron",
          status: "ok",
          finishedAt: NOW - HOUR,
          sourceDate: null,
        });
        await expect(main.reader.getHistoryFreshness()).resolves.toEqual({
          lastSuccessAt: new Date(NOW - HOUR),
          sourceDate: null,
        });
      });

      test("(g) two ok runs with the same finished_at → the higher id", async () => {
        await runs(
          {
            trigger: "cron",
            status: "ok",
            finishedAt: NOW - HOUR,
            sourceDate: "2026-10-08",
          },
          {
            trigger: "bulk",
            status: "ok",
            finishedAt: NOW - HOUR,
            sourceDate: "2026-10-09",
          },
        );
        await expect(main.reader.getHistoryFreshness()).resolves.toEqual({
          lastSuccessAt: new Date(NOW - HOUR),
          sourceDate: "2026-10-09",
        });
      });

      test("sourceDate is exact under TZ=America/Toronto", async () => {
        expect(new Date(NOW).getTimezoneOffset()).toBe(240);
        await runs(cronOk);
        const { sourceDate, lastSuccessAt } =
          await main.reader.getHistoryFreshness();
        expect(sourceDate).toBe("2026-10-09");
        expect(lastSuccessAt).toBeInstanceOf(Date);
      });
    });

    describe("one SELECT, no writes (T10, AC-8)", () => {
      const clear = () => {
        main.events.length = 0;
        main.wire.length = 0;
      };
      const NOT_A_READ =
        /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i;

      beforeAll(async () => {
        await runs(cronOkSeed());
        // Warm the pool, so a connection's own setup is not in a call's log.
        await main.reader.getHistoryFreshness();
      });

      function cronOkSeed() {
        return {
          trigger: "cron" as const,
          status: "ok" as const,
          finishedAt: NOW - HOUR,
          sourceDate: "2026-10-09",
        };
      }

      async function runs(run: ReturnType<typeof cronOkSeed>) {
        await seed.query("TRUNCATE price_sync_runs RESTART IDENTITY");
        await seed.query(
          `INSERT INTO price_sync_runs (trigger, status, finished_at, source_date)
           VALUES ($1, $2, $3, $4)`,
          [run.trigger, run.status, new Date(run.finishedAt), run.sourceDate],
        );
        await seed.query("ANALYZE price_sync_runs");
      }

      test.each([
        [
          "getPriceHistory",
          "price_history",
          () => main.reader.getPriceHistory(ID_A, "foil", AS_OF),
        ],
        [
          "getHistoryFreshness",
          "price_sync_runs",
          () => main.reader.getHistoryFreshness(),
        ],
      ] as const)(
        "%s issues exactly one SELECT on %s",
        async (_name, table, call) => {
          clear();
          await call();
          for (const log of [main.events, main.wire.map((w) => w.text)]) {
            expect(log).toHaveLength(1);
            expect(log[0].trimStart()).toMatch(/^SELECT\b/);
            expect(log[0]).toContain(`"${table}"`);
            expect(log[0]).not.toMatch(NOT_A_READ);
          }
        },
      );

      test("a call with invalid input records no statement", async () => {
        clear();
        await expect(
          main.reader.getPriceHistory("not-a-uuid", "foil", AS_OF),
        ).rejects.toBeInstanceOf(TypeError);
        expect(main.events).toEqual([]);
        expect(main.wire).toEqual([]);
      });

      test("the reader's connection is read-only: a deliberate INSERT on the same client fails with 25006", async () => {
        const write = main.prisma
          .$executeRaw`INSERT INTO price_sync_runs (trigger, status) VALUES ('cron', 'ok')`;
        const error = await write.then(
          () => null,
          (e: unknown) => e,
        );
        expect(error).not.toBeNull();
        expect(
          JSON.stringify(error, Object.getOwnPropertyNames(error)),
        ).toMatch(/25006|read-only transaction/);
        const { rows } = await seed.query(
          "SELECT count(*)::int AS n FROM price_sync_runs",
        );
        expect(rows).toEqual([{ n: 1 }]);
      });

      test.each([
        [
          "getPriceHistory",
          "price_history_pkey",
          () => main.reader.getPriceHistory(ID_A, "foil", AS_OF),
        ],
        [
          "getHistoryFreshness",
          "price_sync_runs_status_finished_at_idx",
          () => main.reader.getHistoryFreshness(),
        ],
      ] as const)(
        "%s's statement can use %s (EXPLAIN, enable_seqscan off)",
        async (_name, index, call) => {
          clear();
          await call();
          const [{ text, values }] = main.wire;
          await seed.query("BEGIN");
          try {
            await seed.query("SET LOCAL enable_seqscan = off");
            const plan = await seed.query<{ "QUERY PLAN": string }>(
              `EXPLAIN ${text}`,
              values,
            );
            expect(plan.rows.map((r) => r["QUERY PLAN"]).join("\n")).toContain(
              index,
            );
          } finally {
            await seed.query("ROLLBACK");
          }
        },
      );
    });

    // T17's functional half (S0.1 Deviation 3): the result page's server
    // logic over the F0 reader and a seeded database, run in CI. Dates sit in
    // June 2027, clear of T4's series for the same printing.
    describe("buildEvaluation through the F0 reader (T17, functional)", () => {
      const now = new Date("2027-06-15T12:00:00.000Z");
      const deps = (reader: PriceHistoryReader): EvaluationDeps => ({
        scryfall: {
          getCardByName: async () => scryfallCard(),
          getAllPrintings: async () => [...ESPER_SENTINEL_PRINTS],
        },
        reader,
        now: () => now,
        log: vi.fn(),
      });
      const query = {
        card: "Esper Sentinel",
        askingPriceCents: 7499,
        finish: "normal" as const,
      };

      beforeAll(async () => {
        // 30 daily rows for mh2 #12 normal ending yesterday, at its market
        // price, and a bulk ok run an hour ago.
        for (let i = 30; i >= 1; i--) {
          await insertRow(
            MH2_12_ID,
            "normal",
            addDays("2027-06-15", -i),
            5917,
            i === 1 ? "2027-06-15T10:00:00.000Z" : "2027-06-14T10:00:00.000Z",
          );
        }
        await seed.query("TRUNCATE price_sync_runs RESTART IDENTITY");
        await seed.query(
          `INSERT INTO price_sync_runs (trigger, status, finished_at, source_date)
           VALUES ('bulk', 'ok', '2027-06-15T11:00:00.000Z', '2027-06-14')`,
        );
      });

      test("seeded history → a real kind with 30 snapshots, no unavailable note and no banner", async () => {
        const d = deps(main.reader);
        const result = await buildEvaluation(query, d);
        if (result.status !== "ok") throw new Error(result.status);
        expect(result.printing.id).toBe(MH2_12_ID);
        expect(["buy", "fair", "wait"]).toContain(result.recommendation.kind);
        expect(result.recommendation.signals.snapshotCount30d).toBe(30);
        expect(result.historyUnavailable).toBe(false);
        expect(result.syncStale).toBe(false);
        expect(result.latestSnapshotAt?.toISOString()).toBe(
          "2027-06-15T10:00:00.000Z",
        );
        expect(d.log).not.toHaveBeenCalled();
      });

      test("a database that refuses connections → history unavailable and the banner, never an error", async () => {
        const refused = new PrismaClient({
          adapter: new PrismaPg({
            connectionString:
              "postgresql://postgres:postgres@127.0.0.1:1/mox_market",
            connectionTimeoutMillis: 300,
          }),
        });
        try {
          const d = deps(createPriceHistoryReader(async () => refused));
          const result = await buildEvaluation(query, d);
          if (result.status !== "ok") throw new Error(result.status);
          expect(result.recommendation.kind).toBe("insufficient_data");
          expect(result.historyUnavailable).toBe(true);
          expect(result.syncStale).toBe(true);
          expect(d.log).toHaveBeenCalledWith(
            "history_read_failed",
            expect.anything(),
          );
          expect(d.log).toHaveBeenCalledWith(
            "freshness_read_failed",
            expect.anything(),
          );
        } finally {
          await refused.$disconnect().catch(() => undefined);
        }
      });
    });
  },
);
