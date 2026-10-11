// T13 to T15 (AC-3 to AC-5, AC-7 to AC-9; S0.3d5, S0.3d9, S0.3d10, S0.3d21):
// the daily sync against a real Postgres. One scratch database on the server
// named by POSTGRES_URL_NON_POOLING (localhost only), both migrations
// deployed, dropped afterwards. T13 and T14 drive the real route's GET with
// the real @/lib/prisma (POSTGRES_PRISMA_URL stubbed to the scratch database),
// stubbing only global fetch (fixture bytes, identity encoding, exact
// Content-Length) and Date, so the guard, the lazy import, the http source,
// the Prisma adapter and the store run as in production. Every route case
// runs with TMPDIR pointed at a fresh directory, so the per-run download
// directory is seen holding Meta.json mid-run and gone afterwards (ADV.10).
// Unreachable server: fails when CI=true, skips with a warning otherwise.
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  CI_UNREACHABLE_TEST,
  createScratchDatabase,
  dropScratchDatabase,
  IN_CI,
  prismaCli,
  probeScratchServer,
  type ScratchDatabase,
} from "../../../tests/helpers/scratch-db";
import {
  BEFORE_WINDOW,
  fixtureFiles,
  manyCards,
  META,
  S,
  STANDARD_CARDS,
  STANDARD_IDENTIFIERS,
  standardCards,
  standardRows,
  U,
  WINDOW_START,
  type CardFixture,
} from "./__fixtures__/build";
import { MTGJSON_BASE_URL, type MtgjsonFileName } from "./consts";
import { prismaDb } from "./prisma-db";
import { createFixtureSource } from "./source";
import {
  STALE_RUN_MESSAGE,
  upsertIdentifierChunk,
  type Db,
  type QueryResultLike,
} from "./store";
import { runDailySync, type SyncDeps } from "./sync";
import { SYNC_TEMP_PREFIX } from "./sync-handler";

const server = await probeScratchServer();

const NOW = new Date("2026-10-05T17:00:00.000Z");
const RUN_DATE = "2026-10-05";
const SECRET = "int-test-cron-secret-0a1b2c3d4e5f60718293a4b5c6d7e8f9";
const TODAY_ROWS = standardRows(RUN_DATE).filter((r) => r.date === RUN_DATE);

type Files = Partial<Record<MtgjsonFileName, Buffer>>;

/** A stored row without its synced_at, to compare with fixture rows. */
const withoutSyncedAt = (row: {
  scryfallId: string;
  finish: string;
  date: string;
  priceCents: number;
}) => ({
  scryfallId: row.scryfallId,
  finish: row.finish,
  date: row.date,
  priceCents: row.priceCents,
});

describe.runIf(IN_CI && !server.reachable)(
  "the daily sync (CI without a database)",
  () => {
    test(CI_UNREACHABLE_TEST, () => {
      expect.fail(
        `local Postgres unreachable in CI (${server.reachable ? "" : server.reason})`,
      );
    });
  },
);

describe.skipIf(!server.reachable)(
  "the daily sync against a local Postgres (T13 to T15)",
  () => {
    let scratch: ScratchDatabase;
    let seed: pg.Client;
    let seedDb: Db;
    let served: Files = fixtureFiles();
    const fetched: string[] = [];
    let tmpRoot: string;
    let originalTmpdir: string | undefined;
    /** What the run's directory held when AllPricesToday was requested. */
    let duringRun: string[][] = [];
    type Route = typeof import("@/app/api/prices/sync-mtgjson/route");
    let route: Route;
    let sharedDb: Db;

    const clearGlobalClients = async () => {
      const g = globalThis as {
        prisma?: { $disconnect(): Promise<void> };
        historyPrisma?: { $disconnect(): Promise<void> };
      };
      await g.prisma?.$disconnect().catch(() => undefined);
      await g.historyPrisma?.$disconnect().catch(() => undefined);
      delete g.prisma;
      delete g.historyPrisma;
    };

    const fetchStub = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      fetched.push(url);
      const name = url.startsWith(MTGJSON_BASE_URL)
        ? (url.slice(MTGJSON_BASE_URL.length) as MtgjsonFileName)
        : null;
      if (name === "AllPricesToday.json.gz") {
        const dirs = (await readdir(tmpRoot)).filter((d) =>
          d.startsWith(SYNC_TEMP_PREFIX),
        );
        duringRun = await Promise.all(
          dirs.map(async (d) => (await readdir(path.join(tmpRoot, d))).sort()),
        );
      }
      const bytes = name === null ? undefined : served[name];
      if (bytes === undefined) {
        return new Response("not found", { status: 404 });
      }
      return new Response(new Uint8Array(bytes), {
        headers: { "content-length": String(bytes.length) },
      });
    });

    const get = () =>
      route.GET(
        new Request("http://localhost:3000/api/prices/sync-mtgjson", {
          headers: { Authorization: `Bearer ${SECRET}` },
        }),
      );

    const rows = async (where = "TRUE") =>
      (
        await seed.query(
          `SELECT scryfall_id::text AS "scryfallId", finish::text AS finish,
                  to_char(date, 'YYYY-MM-DD') AS date, price_cents AS "priceCents",
                  synced_at::text AS "syncedAt"
           FROM price_history WHERE ${where}
           ORDER BY scryfall_id, finish, date`,
        )
      ).rows as {
        scryfallId: string;
        finish: string;
        date: string;
        priceCents: number;
        syncedAt: string;
      }[];
    const runs = async () =>
      (
        await seed.query(
          `SELECT id, trigger::text AS trigger, status::text AS status,
                  to_char(source_date, 'YYYY-MM-DD') AS "sourceDate",
                  source_version AS "sourceVersion", rows_written AS "rowsWritten",
                  rows_pruned AS "rowsPruned", unmapped_uuids AS "unmappedUuids",
                  db_bytes::text AS "dbBytes", error, finished_at IS NOT NULL AS finished
           FROM price_sync_runs ORDER BY id`,
        )
      ).rows as Record<string, unknown>[];

    /** runDailySync over the shared client, with the fixture source. */
    const sync = (files: Files, extra: Partial<SyncDeps> = {}) =>
      runDailySync({
        db: sharedDb,
        source: createFixtureSource(files),
        now: () => NOW,
        log: { warn: () => undefined, error: () => undefined },
        ...extra,
      });

    beforeAll(async () => {
      scratch = await createScratchDatabase(server.url!, "mtgjson_sync");
      const deploy = prismaCli(["migrate", "deploy"], scratch.url);
      expect(deploy.status, deploy.output).toBe(0);
      seed = new pg.Client({ connectionString: scratch.url });
      await seed.connect();
      seedDb = {
        query: (text, values) =>
          seed.query(text, values === undefined ? undefined : [...values]),
      };

      await clearGlobalClients();
      vi.stubEnv("CRON_SECRET", SECRET);
      vi.stubEnv("POSTGRES_PRISMA_URL", scratch.url);
      vi.stubEnv("POSTGRES_SSL_ROOT_CERT", undefined);
      vi.resetModules();
      route = await import("@/app/api/prices/sync-mtgjson/route");
      const { prisma } = await import("@/lib/prisma");
      sharedDb = prismaDb(prisma);
    });

    afterAll(async () => {
      await clearGlobalClients();
      vi.unstubAllEnvs();
      vi.resetModules();
      await seed?.end().catch(() => undefined);
      if (scratch) await dropScratchDatabase(server.url!, scratch.name);
    });

    beforeEach(async () => {
      tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mox-sync-int-tmp-"));
      originalTmpdir = process.env.TMPDIR;
      process.env.TMPDIR = tmpRoot;
      duringRun = [];
      served = fixtureFiles();
      fetched.length = 0;
      fetchStub.mockClear();
      vi.stubGlobal("fetch", fetchStub);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      await seed.query(
        "TRUNCATE price_history, mtgjson_identifiers, price_sync_runs RESTART IDENTITY",
      );
      await upsertIdentifierChunk(seedDb, STANDARD_IDENTIFIERS);
      // One row the prune deletes (runDate − 31) and one it keeps (runDate − 30).
      await seed.query(
        `INSERT INTO price_history (scryfall_id, finish, date, price_cents)
         VALUES ($1, 'etched', $2, 1111), ($1, 'etched', $3, 2222)`,
        [S.ETCHED, BEFORE_WINDOW, WINDOW_START],
      );
    });

    afterEach(async () => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      if (originalTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmpdir;
      // ADV.10: no run leaves its download directory behind, files included.
      const left = await readdir(tmpRoot);
      await rm(tmpRoot, { recursive: true, force: true });
      expect(left).toEqual([]);
    });

    test("T13 (AC-3): GET through the real route → 200, the gated rows stored, the prune, one cron ok row equal to the body", async () => {
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const body = JSON.parse(await res.text());
      expect(typeof body.dbBytes).toBe("number");
      expect(body.dbBytes).toBeGreaterThan(0);

      const today = await rows(`date = '${RUN_DATE}'`);
      expect(today.map(withoutSyncedAt)).toEqual(TODAY_ROWS);
      const old = await rows(`date < '${RUN_DATE}'`);
      expect(old.map((r) => r.date)).toEqual([WINDOW_START]);

      const all = await runs();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        trigger: "cron",
        status: "ok",
        sourceDate: RUN_DATE,
        sourceVersion: META.version,
        rowsWritten: TODAY_ROWS.length,
        rowsPruned: 1,
        unmappedUuids: 1,
        error: null,
        finished: true,
      });
      expect(body).toMatchObject({
        status: "ok",
        runId: all[0].id,
        sourceDate: all[0].sourceDate,
        sourceVersion: all[0].sourceVersion,
        rowsWritten: all[0].rowsWritten,
        rowsPruned: all[0].rowsPruned,
        unmappedUuids: all[0].unmappedUuids,
        staleRunsMarked: 0,
      });
      expect(String(body.dbBytes)).toBe(all[0].dbBytes);

      expect(fetched.length).toBeGreaterThan(0);
      for (const url of fetched) {
        expect(url.startsWith(MTGJSON_BASE_URL)).toBe(true);
      }
      expect(new Set(fetched)).toEqual(
        new Set([
          `${MTGJSON_BASE_URL}Meta.json`,
          `${MTGJSON_BASE_URL}AllPricesToday.json.gz`,
        ]),
      );
      // ADV.10: the run's directory held the downloaded Meta.json mid-run,
      // under os.tmpdir(); afterEach asserts it is gone.
      expect(duringRun).toHaveLength(1);
      expect(duringRun[0]).toContain("Meta.json");
      expect(existsSync(tmpRoot)).toBe(true);
    });

    test("T14 (AC-5): a second run writes 0 rows and moves no synced_at; one changed price updates only that row", async () => {
      expect((await get()).status).toBe(200);
      expect(duringRun).toHaveLength(1);
      expect(duringRun[0]).toContain("Meta.json");
      expect(await readdir(tmpRoot)).toEqual([]);
      const first = await rows();

      const again = JSON.parse(await (await get()).text());
      expect(again.status).toBe("ok");
      expect(again.rowsWritten).toBe(0);
      expect(await rows()).toEqual(first);

      // U.RANK_6000_AT_100's normal series moves from $1.00 to $1.25.
      const changed: CardFixture[] = standardCards(RUN_DATE).map((card) =>
        card.uuid === U.RANK_6000_AT_100
          ? {
              ...card,
              retail: {
                ...card.retail,
                normal: { [RUN_DATE]: 1.25 },
              },
            }
          : card,
      );
      served = fixtureFiles(changed);
      const third = JSON.parse(await (await get()).text());
      expect(third.status).toBe("ok");
      expect(third.rowsWritten).toBe(1);
      const after = await rows();
      const key = (r: { scryfallId: string; finish: string; date: string }) =>
        `${r.scryfallId}|${r.finish}|${r.date}`;
      const changedKey = `${S.RANK_6000_AT_100}|normal|${RUN_DATE}`;
      expect(after.map(key)).toEqual(first.map(key));
      for (const [i, row] of after.entries()) {
        if (key(row) === changedKey) {
          expect(row.priceCents).toBe(125);
          expect(row.syncedAt).not.toBe(first[i].syncedAt);
        } else {
          expect(row).toEqual(first[i]);
        }
      }
    });

    describe("unhappy paths on a real database (T15)", () => {
      test("AC-4: Meta.json dated 2026-10-04 → source_stale with that date, the old row pruned, no 2026-10-05 row", async () => {
        served = fixtureFiles(STANDARD_CARDS, {
          meta: { date: "2026-10-04", version: META.version },
        });
        const res = await get();
        expect(res.status).toBe(200);
        expect((await res.json()).status).toBe("source_stale");
        expect(await rows(`date = '${RUN_DATE}'`)).toEqual([]);
        expect((await rows()).map((r) => r.date)).toEqual([WINDOW_START]);
        expect(await runs()).toEqual([
          expect.objectContaining({
            trigger: "cron",
            status: "source_stale",
            sourceDate: "2026-10-04",
            rowsWritten: 0,
            rowsPruned: 1,
          }),
        ]);
        expect(fetched).toEqual([`${MTGJSON_BASE_URL}Meta.json`]);
      });

      test("AC-7: the size stubbed to 450,000,001 → budget_stop, pruned, no new row", async () => {
        const sized: Db = {
          query: (text, values): Promise<QueryResultLike> =>
            /pg_database_size/.test(text)
              ? Promise.resolve({ rowCount: 1, rows: [{ bytes: "450000001" }] })
              : sharedDb.query(text, values),
        };
        const result = await sync(fixtureFiles(), { db: sized });
        expect(result.status).toBe("budget_stop");
        expect(await rows(`date = '${RUN_DATE}'`)).toEqual([]);
        expect((await rows()).map((r) => r.date)).toEqual([WINDOW_START]);
        expect(await runs()).toEqual([
          expect.objectContaining({
            status: "budget_stop",
            rowsWritten: 0,
            rowsPruned: 1,
            dbBytes: "450000001",
          }),
        ]);
      });

      test("AC-8: an empty identifier table → 500, error 'identifiers not loaded', no price row, nothing pruned", async () => {
        await seed.query("TRUNCATE mtgjson_identifiers");
        const res = await get();
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.status).toBe("error");
        expect(body.error).toContain("identifiers not loaded");
        expect((await rows()).map((r) => r.date)).toEqual([
          BEFORE_WINDOW,
          WINDOW_START,
        ]);
        const [run] = await runs();
        expect(run).toMatchObject({
          status: "error",
          rowsWritten: 0,
          rowsPruned: 0,
          dbBytes: null,
          finished: true,
        });
        expect(String(run.error)).toContain("identifiers not loaded");
      });

      test("AC-8: the two-face printing with chunkRows = 1 → one row, side a's price", async () => {
        const faces = STANDARD_CARDS.filter(
          (c) => c.uuid === U.FACE_A || c.uuid === U.FACE_B,
        );
        const result = await sync(fixtureFiles(faces), { chunkRows: 1 });
        expect(result.status).toBe("ok");
        expect(
          (await rows(`date = '${RUN_DATE}'`)).map(withoutSyncedAt),
        ).toEqual([
          {
            scryfallId: S.FACE,
            finish: "normal",
            date: RUN_DATE,
            priceCents: 200,
          },
        ]);
      });

      test("AC-9: the second upsert rejects → error with the message, the first chunk's rows present, nothing pruned", async () => {
        let upserts = 0;
        const failing: Db = {
          query: (text, values) => {
            if (/unnest/.test(text) && ++upserts === 2) {
              return Promise.reject(new Error("injected fault on chunk 2"));
            }
            return sharedDb.query(text, values);
          },
        };
        const result = await sync(fixtureFiles(), {
          db: failing,
          chunkRows: 3,
        });
        expect(result.status).toBe("error");
        expect(result.error).toContain("injected fault on chunk 2");
        expect(result.rowsWritten).toBe(3);
        expect(await rows(`date = '${RUN_DATE}'`)).toHaveLength(3);
        expect((await rows(`date < '${RUN_DATE}'`)).map((r) => r.date)).toEqual(
          [BEFORE_WINDOW, WINDOW_START],
        );
        const [run] = await runs();
        expect(run).toMatchObject({
          status: "error",
          rowsWritten: 3,
          rowsPruned: 0,
        });
        expect(String(run.error)).toContain("injected fault on chunk 2");
      });

      test("ADV.1: AllPricesToday with no calendar date through the route → 500, error, nothing pruned, no price row", async () => {
        served = fixtureFiles(STANDARD_CARDS, {
          pricesMeta: { date: null, version: META.version },
        });
        const res = await get();
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.status).toBe("error");
        expect(body.error).toMatch(
          /AllPricesToday\.json\.gz has no calendar date/,
        );
        expect((await rows()).map((r) => r.date)).toEqual([
          BEFORE_WINDOW,
          WINDOW_START,
        ]);
        expect(await runs()).toEqual([
          expect.objectContaining({
            status: "error",
            sourceDate: RUN_DATE,
            rowsWritten: 0,
            rowsPruned: 0,
          }),
        ]);
      });

      test("ADV.5: three overlapping syncs (one row per chunk) all end ok, write the 7 rows once between them, and leave one ok row each", async () => {
        const results = await Promise.all([
          sync(fixtureFiles(), { chunkRows: 1 }),
          sync(fixtureFiles(), { chunkRows: 1 }),
          sync(fixtureFiles(), { chunkRows: 1 }),
        ]);
        expect(results.map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
        expect(results.map((r) => r.error)).toEqual([null, null, null]);
        expect(results.reduce((sum, r) => sum + r.rowsWritten, 0)).toBe(
          TODAY_ROWS.length,
        );
        expect(
          (await rows(`date = '${RUN_DATE}'`)).map(withoutSyncedAt),
        ).toEqual(TODAY_ROWS);
        const all = await runs();
        expect(all).toHaveLength(3);
        for (const run of all) {
          expect(run).toMatchObject({ trigger: "cron", status: "ok" });
        }
        expect(new Set(all.map((r) => r.id))).toEqual(
          new Set(results.map((r) => r.runId)),
        );
      });

      test("ADV.5: two overlapping syncs of 2,000 cards (50 rows per chunk) both end ok with no deadlock, 2,000 rows stored once", async () => {
        const cards = manyCards(2000, 31);
        await upsertIdentifierChunk(
          seedDb,
          cards.map((c) => ({
            mtgjsonUuid: c.uuid,
            scryfallId: c.scryfallId as string,
            side: null,
            edhrecRank: 10,
          })),
        );
        const files = fixtureFiles(cards);
        const results = await Promise.all([
          sync(files, { chunkRows: 50 }),
          sync(files, { chunkRows: 50 }),
        ]);
        expect(results.map((r) => r.status)).toEqual(["ok", "ok"]);
        for (const r of results) expect(r.error ?? "").not.toMatch(/deadlock/);
        expect(results[0].rowsWritten + results[1].rowsWritten).toBe(2000);
        const [{ count }] = (
          await seed.query(
            `SELECT count(*)::int AS count FROM price_history WHERE date = $1`,
            [RUN_DATE],
          )
        ).rows as { count: number }[];
        expect(count).toBe(2000);
        expect((await runs()).map((r) => r.status)).toEqual(["ok", "ok"]);
      });

      test("AC-9: a running row two hours old (any trigger) is marked error by the next run; a 30-minute-old one is untouched; the new run never marks itself", async () => {
        await seed.query(
          `INSERT INTO price_sync_runs (trigger, status, started_at)
           VALUES ('bulk', 'running', now() - interval '2 hours'),
                  ('cron', 'running', now() - interval '30 minutes')`,
        );
        const result = await sync(fixtureFiles());
        expect(result.status).toBe("ok");
        expect(result.staleRunsMarked).toBe(1);
        const [old, recent, current] = await runs();
        expect(old).toMatchObject({
          trigger: "bulk",
          status: "error",
          error: STALE_RUN_MESSAGE,
          finished: true,
        });
        expect(recent).toMatchObject({
          trigger: "cron",
          status: "running",
          error: null,
          finished: false,
        });
        expect(current).toMatchObject({
          id: result.runId,
          trigger: "cron",
          status: "ok",
          error: null,
        });
      });
    });
  },
);
