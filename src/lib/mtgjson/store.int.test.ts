// T12 (AC-7, AC-8, AC-10; S0.2d12 to S0.2d14): the store against a real
// Postgres. One scratch database on the server named by
// POSTGRES_URL_NON_POOLING (localhost only), both migrations deployed,
// dropped afterwards. Unreachable server: fails when CI=true, skips with a
// warning otherwise (S0.2d22, C2-A.10).
import pg from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
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
  analyzeTables,
  databaseSizeBytes,
  finishRun,
  priceHistoryIsEmpty,
  prunePriceHistory,
  RUN_ERROR_MAX_CHARS,
  startRun,
  upsertIdentifierChunk,
  upsertPriceChunk,
  type Db,
} from "./store";
import type { IdentifierRow, PriceRow } from "./transform";

const server = await probeScratchServer();

const RUN_DATE = "2026-10-05";
const sid = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const uid = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pause = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

/** A Db over one client that counts every statement it sends. */
function counted(client: pg.Client): Db & { count: number } {
  const db = {
    count: 0,
    async query(text: string, values?: readonly unknown[]) {
      db.count += 1;
      return client.query(text, values === undefined ? undefined : [...values]);
    },
  };
  return db;
}

describe.runIf(IN_CI && !server.reachable)(
  "the F0 store (CI without a database)",
  () => {
    test(CI_UNREACHABLE_TEST, () => {
      expect.fail(
        `local Postgres unreachable in CI (${server.reachable ? "" : server.reason})`,
      );
    });
  },
);

describe.skipIf(!server.reachable)(
  "the F0 store against a local Postgres (T12)",
  () => {
    let scratch: ScratchDatabase;
    let client: pg.Client;
    let db: Db & { count: number };

    beforeAll(async () => {
      scratch = await createScratchDatabase(server.url!, "mtgjson_store");
      const deploy = prismaCli(["migrate", "deploy"], scratch.url);
      expect(deploy.status, deploy.output).toBe(0);
      client = new pg.Client({ connectionString: scratch.url });
      await client.connect();
      db = counted(client);
    });

    afterAll(async () => {
      await client?.end().catch(() => undefined);
      if (scratch) await dropScratchDatabase(server.url!, scratch.name);
    });

    beforeEach(async () => {
      await client.query(
        `TRUNCATE "price_history", "mtgjson_identifiers", "price_sync_runs" RESTART IDENTITY`,
      );
      db.count = 0;
    });

    const syncedAt = async () =>
      (
        await client.query<{
          id: string;
          f: string;
          d: string;
          c: number;
          s: string;
        }>(
          `SELECT scryfall_id AS id, finish::text AS f, to_char(date, 'YYYY-MM-DD') AS d,
                price_cents AS c, to_char(synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS s
         FROM price_history ORDER BY 1, 2, 3`,
        )
      ).rows;

    test("a 5,000-row chunk is one statement; a re-run writes 0 and moves no synced_at; one change writes 1", async () => {
      const rows: PriceRow[] = Array.from({ length: 5000 }, (_, i) => ({
        scryfallId: sid(i + 1),
        finish: i % 2 === 0 ? "normal" : "foil",
        date: RUN_DATE,
        priceCents: 100 + i,
      }));
      expect(await upsertPriceChunk(db, rows)).toBe(5000);
      expect(db.count).toBe(1);
      const before = await syncedAt();
      expect(before).toHaveLength(5000);
      await pause();
      expect(await upsertPriceChunk(db, rows)).toBe(0);
      expect(await syncedAt()).toEqual(before);
      await pause();
      const changed = rows.map((r, i) =>
        i === 7 ? { ...r, priceCents: 9999 } : r,
      );
      expect(await upsertPriceChunk(db, changed)).toBe(1);
      const after = await syncedAt();
      const diff = after.filter(
        (row, i) => JSON.stringify(row) !== JSON.stringify(before[i]),
      );
      expect(diff).toHaveLength(1);
      expect(diff[0]).toMatchObject({ id: sid(8), c: 9999 });
      expect(diff[0].s > before[7].s).toBe(true);
    });

    test("identifiers: insert, re-run 0 with loaded_at unchanged, a changed rank moves only that row; nulls round-trip", async () => {
      const rows: IdentifierRow[] = [
        {
          mtgjsonUuid: uid(1),
          scryfallId: sid(1),
          side: null,
          edhrecRank: null,
        },
        { mtgjsonUuid: uid(2), scryfallId: sid(2), side: "a", edhrecRank: 40 },
        { mtgjsonUuid: uid(3), scryfallId: sid(2), side: "b", edhrecRank: 40 },
      ];
      const read = async () =>
        (
          await client.query(
            `SELECT mtgjson_uuid, scryfall_id, side, edhrec_rank,
                  to_char(loaded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS loaded
           FROM mtgjson_identifiers ORDER BY 1`,
          )
        ).rows;
      expect(await upsertIdentifierChunk(db, rows)).toBe(3);
      const before = await read();
      expect(
        before.map((r) => [
          r.mtgjson_uuid,
          r.scryfall_id,
          r.side,
          r.edhrec_rank,
        ]),
      ).toEqual([
        [uid(1), sid(1), null, null],
        [uid(2), sid(2), "a", 40],
        [uid(3), sid(2), "b", 40],
      ]);
      await pause();
      expect(await upsertIdentifierChunk(db, rows)).toBe(0);
      expect(await read()).toEqual(before);
      await pause();
      expect(
        await upsertIdentifierChunk(db, [
          { ...rows[1], edhrecRank: 41 },
          rows[0],
          rows[2],
        ]),
      ).toBe(1);
      const after = await read();
      expect(after[0]).toEqual(before[0]);
      expect(after[2]).toEqual(before[2]);
      expect(after[1].edhrec_rank).toBe(41);
      expect(after[1].loaded > before[1].loaded).toBe(true);
    });

    test("prune deletes only rows before runDate − 30, any printing or finish, and returns the count", async () => {
      const dates = ["2026-09-04", "2026-09-05", RUN_DATE, "2026-10-06"];
      const rows: PriceRow[] = dates.flatMap((date, i) => [
        {
          scryfallId: sid(1),
          finish: "normal" as const,
          date,
          priceCents: 100 + i,
        },
        {
          scryfallId: sid(2),
          finish: "etched" as const,
          date,
          priceCents: 200 + i,
        },
      ]);
      await upsertPriceChunk(db, rows);
      expect(await prunePriceHistory(db, RUN_DATE)).toBe(2);
      const left = await client.query(
        `SELECT DISTINCT to_char(date, 'YYYY-MM-DD') AS d FROM price_history ORDER BY 1`,
      );
      expect(left.rows.map((r) => r.d)).toEqual([
        "2026-09-05",
        RUN_DATE,
        "2026-10-06",
      ]);
      await analyzeTables(db, { prices: true });
      await analyzeTables(db, { prices: false });
    });

    test("databaseSizeBytes is a number equal to pg_database_size(current_database())", async () => {
      const bytes = await databaseSizeBytes(db);
      expect(typeof bytes).toBe("number");
      const direct = await client.query(
        `SELECT pg_database_size(current_database())::text AS b`,
      );
      expect(String(bytes)).toBe(direct.rows[0].b);
    });

    test("priceHistoryIsEmpty before and after a write", async () => {
      expect(await priceHistoryIsEmpty(db)).toBe(true);
      await upsertPriceChunk(db, [
        { scryfallId: sid(1), finish: "normal", date: RUN_DATE, priceCents: 1 },
      ]);
      expect(await priceHistoryIsEmpty(db)).toBe(false);
    });

    test("startRun and finishRun write every column", async () => {
      const id = await startRun(db, {
        trigger: "bulk",
        sourceDate: RUN_DATE,
        sourceVersion: "5.3.0+20261005",
      });
      const running = await client.query(
        `SELECT trigger::text, status::text, finished_at, to_char(source_date, 'YYYY-MM-DD') AS sd, source_version FROM price_sync_runs WHERE id = $1`,
        [id],
      );
      expect(running.rows[0]).toEqual({
        trigger: "bulk",
        status: "running",
        finished_at: null,
        sd: RUN_DATE,
        source_version: "5.3.0+20261005",
      });
      await finishRun(db, id, {
        status: "ok",
        rowsWritten: 12,
        rowsPruned: 3,
        unmappedUuids: 2,
        dbBytes: 123_456_789,
        error: null,
      });
      const done = await client.query(
        `SELECT status::text, finished_at IS NOT NULL AS finished, rows_written, rows_pruned, unmapped_uuids, db_bytes::text, error FROM price_sync_runs WHERE id = $1`,
        [id],
      );
      expect(done.rows[0]).toEqual({
        status: "ok",
        finished: true,
        rows_written: 12,
        rows_pruned: 3,
        unmapped_uuids: 2,
        db_bytes: "123456789",
        error: null,
      });
    });

    test("an error over 1,000 characters is stored at 1,000, with any URL redacted", async () => {
      const id = await startRun(db, {
        trigger: "identifiers",
        sourceDate: null,
        sourceVersion: null,
      });
      const message = `Error: lost postgres://user:secret@host/db then ${"x".repeat(2000)}`;
      await finishRun(db, id, {
        status: "error",
        rowsWritten: 0,
        rowsPruned: 0,
        unmappedUuids: 0,
        dbBytes: null,
        error: message,
      });
      const row = (
        await client.query(
          `SELECT error, trigger::text FROM price_sync_runs WHERE id = $1`,
          [id],
        )
      ).rows[0];
      expect(row.trigger).toBe("identifiers");
      expect(row.error).toHaveLength(RUN_ERROR_MAX_CHARS);
      expect(row.error).toMatch(/^Error: lost \[redacted url\] then x+$/);
      expect(row.error).not.toContain("secret");
    });
  },
);
