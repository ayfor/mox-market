// T13 (AC-3, AC-4, AC-7 to AC-11; S0.2d12 to S0.2d15): path B through
// runBulkIngest on a scratch database, with fixture sources. The client is
// the real createIngestDb over a localhost URL (S0.1d20: a local URL passes
// through unchanged). Unreachable server: fails when CI=true, skips with a
// warning otherwise.
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
  allPricesJson,
  BEFORE_WINDOW,
  fixtureFiles,
  gz,
  manyCards,
  META,
  NOW,
  RUN_DATE,
  S,
  series,
  STANDARD_CARDS,
  STANDARD_IDENTIFIERS,
  STANDARD_ROWS,
  U,
  WINDOW_START,
  type CardFixture,
} from "./__fixtures__/build";
import { ALL_PRICES_FILE } from "./consts";
import { createIngestDb, type IngestDb } from "./db";
import { EXIT, runBulkIngest, type IngestDeps } from "./ingest";
import { createFixtureSource } from "./source";
import { IngestRefusedError, type IngestTarget } from "./target";

const server = await probeScratchServer();

describe.runIf(IN_CI && !server.reachable)(
  "path B (CI without a database)",
  () => {
    test(CI_UNREACHABLE_TEST, () => {
      expect.fail(
        `local Postgres unreachable in CI (${server.reachable ? "" : server.reason})`,
      );
    });
  },
);

describe.skipIf(!server.reachable)(
  "path B against a local Postgres (T13)",
  () => {
    let scratch: ScratchDatabase;
    let client: pg.Client;
    let target: IngestTarget;

    beforeAll(async () => {
      scratch = await createScratchDatabase(server.url!, "mtgjson_ingest");
      const deploy = prismaCli(["migrate", "deploy"], scratch.url);
      expect(deploy.status, deploy.output).toBe(0);
      client = new pg.Client({ connectionString: scratch.url });
      await client.connect();
      target = { kind: "local", url: scratch.url, display: "scratch" };
    });

    afterAll(async () => {
      await client?.end().catch(() => undefined);
      if (scratch) await dropScratchDatabase(server.url!, scratch.name);
    });

    beforeEach(async () => {
      await client.query(
        `TRUNCATE "price_history", "mtgjson_identifiers", "price_sync_runs" RESTART IDENTITY`,
      );
    });

    /** One ingest; `wrap` may decorate the real client (fault or size stubs). */
    async function ingest(
      options: {
        cards?: readonly CardFixture[];
        files?: ReturnType<typeof fixtureFiles>;
        identifiersOnly?: boolean;
        chunkRows?: number;
        wrap?: (db: IngestDb) => IngestDb;
      } = {},
    ) {
      const source = createFixtureSource(
        options.files ?? fixtureFiles(options.cards ?? STANDARD_CARDS),
      );
      const deps: IngestDeps = {
        source,
        now: () => NOW,
        dbFactory: async (t) => {
          const db = await createIngestDb(t.url, { caCert: t.caCert });
          return options.wrap ? options.wrap(db) : db;
        },
        chunkRows: options.chunkRows,
      };
      const result = await runBulkIngest(
        { target, identifiersOnly: options.identifiersOnly ?? false },
        deps,
      );
      return { result, source };
    }

    const prices = async () =>
      (
        await client.query(
          `SELECT scryfall_id AS "scryfallId", finish::text AS finish, to_char(date, 'YYYY-MM-DD') AS date,
                price_cents AS "priceCents"
         FROM price_history ORDER BY scryfall_id, finish::text, date`,
        )
      ).rows;
    const syncedAt = async () =>
      (
        await client.query(
          `SELECT scryfall_id, finish::text, date::text, to_char(synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS s
         FROM price_history ORDER BY 1, 2, 3`,
        )
      ).rows;
    const identifiers = async () =>
      (
        await client.query(
          `SELECT mtgjson_uuid AS "mtgjsonUuid", scryfall_id AS "scryfallId", side, edhrec_rank AS "edhrecRank"
         FROM mtgjson_identifiers ORDER BY mtgjson_uuid`,
        )
      ).rows;
    const runs = async () =>
      (
        await client.query(
          `SELECT trigger::text, status::text, to_char(source_date, 'YYYY-MM-DD') AS source_date, source_version,
                rows_written, rows_pruned, unmapped_uuids, db_bytes::bigint > 0 AS has_bytes,
                finished_at IS NOT NULL AS finished, error
         FROM price_sync_runs ORDER BY id`,
        )
      ).rows;

    describe("AC-7: exact rows, idempotent re-runs, change-only updates", () => {
      test("the fixtures write exactly the expected price rows and identifiers", async () => {
        const { result } = await ingest();
        expect(result.exitCode).toBe(EXIT.ok);
        expect(await prices()).toStrictEqual(STANDARD_ROWS);
        expect(await identifiers()).toStrictEqual(STANDARD_IDENTIFIERS);
      });

      test("a second identical run writes 0 rows and moves no synced_at", async () => {
        await ingest();
        const before = await syncedAt();
        await new Promise((resolve) => setTimeout(resolve, 25));
        const { result } = await ingest();
        expect(result.report.write?.rowsWritten).toBe(0);
        expect(result.report.write?.identifierRowsWritten).toBe(0);
        expect(await syncedAt()).toEqual(before);
        const rows = await runs();
        expect(rows.map((r) => r.rows_written)).toEqual([
          STANDARD_ROWS.length,
          0,
        ]);
      });

      test("one changed price updates only that row's price_cents and synced_at", async () => {
        await ingest();
        const before = await syncedAt();
        await new Promise((resolve) => setTimeout(resolve, 25));
        const changed = STANDARD_CARDS.map((card) =>
          card.uuid === U.ETCHED
            ? {
                ...card,
                retail: { etched: { ...series(12.63), [RUN_DATE]: 13.0 } },
              }
            : card,
        );
        const { result } = await ingest({ cards: changed });
        expect(result.report.write?.rowsWritten).toBe(1);
        const after = await syncedAt();
        const moved = after.filter((row, i) => row.s !== before[i].s);
        expect(moved).toEqual([
          expect.objectContaining({ scryfall_id: S.ETCHED, date: RUN_DATE }),
        ]);
        const etched = (await prices()).filter(
          (r) => r.scryfallId === S.ETCHED,
        );
        expect(etched.map((r) => r.priceCents)).toEqual([1263, 1263, 1300]);
      });
    });

    test("AC-8: rows dated runDate − 31 are pruned, runDate − 30 kept, and rows_pruned counts them", async () => {
      await client.query(
        `INSERT INTO price_history (scryfall_id, finish, date, price_cents) VALUES
         ($1, 'normal', $2, 500), ($1, 'foil', $2, 600), ($1, 'normal', $3, 700)`,
        ["30000000-0000-4000-8000-000000000001", BEFORE_WINDOW, WINDOW_START],
      );
      const { result } = await ingest();
      expect(result.report.write?.rowsPruned).toBe(2);
      const seeded = (await prices()).filter(
        (r) => r.scryfallId === "30000000-0000-4000-8000-000000000001",
      );
      expect(seeded.map((r) => r.date)).toEqual([WINDOW_START]);
      expect((await runs())[0].rows_pruned).toBe(2);
    });

    test("AC-3: with UPSERT_CHUNK_ROWS 1 every row is its own statement and the face row is side a's", async () => {
      const statements: string[] = [];
      const { result } = await ingest({
        chunkRows: 1,
        wrap: (db) => ({
          query: (text, values) => {
            statements.push(text);
            return db.query(text, values);
          },
          end: () => db.end(),
        }),
      });
      expect(result.exitCode).toBe(EXIT.ok);
      expect(
        statements.filter((t) => t.startsWith(`INSERT INTO "price_history"`)),
      ).toHaveLength(STANDARD_ROWS.length);
      const face = (await prices()).filter((r) => r.scryfallId === S.FACE);
      expect(face.map((r) => r.priceCents)).toEqual([200, 200, 200]);
    });

    describe("AC-10: one run row per run, and faults", () => {
      test("a run writes exactly one bulk ok row with its counts and AllPrices' meta", async () => {
        await ingest();
        expect(await runs()).toEqual([
          {
            trigger: "bulk",
            status: "ok",
            source_date: META.date,
            source_version: META.version,
            rows_written: STANDARD_ROWS.length,
            rows_pruned: 0,
            unmapped_uuids: 1,
            has_bytes: true,
            finished: true,
            error: null,
          },
        ]);
      });

      test("a fault on the second price chunk keeps the first chunk and ends the row error", async () => {
        let priceChunks = 0;
        const run = ingest({
          chunkRows: 3,
          wrap: (db) => ({
            query: (text, values) => {
              if (text.startsWith(`INSERT INTO "price_history"`)) {
                priceChunks += 1;
                if (priceChunks === 2)
                  return Promise.reject(
                    new Error("injected fault after chunk 1"),
                  );
              }
              return db.query(text, values);
            },
            end: () => db.end(),
          }),
        });
        await expect(run).rejects.toThrow(/injected fault/);
        expect(await prices()).toHaveLength(3);
        const [row] = await runs();
        expect(row).toMatchObject({
          trigger: "bulk",
          status: "error",
          finished: true,
          rows_written: 3,
        });
        expect(row.error).toBe("Error: injected fault after chunk 1");
      });

      test("malformed JSON after the first chunk keeps it and ends the row error", async () => {
        const cards = manyCards(300, 2);
        const text = allPricesJson(cards);
        const broken = `${text.slice(0, text.length - 40)},"x":{"paper":}}}`;
        const files = { ...fixtureFiles(cards), [ALL_PRICES_FILE]: gz(broken) };
        // The integrity pass reads gzip only, so the JSON fault surfaces mid-run.
        const run = ingest({ files, chunkRows: 2 });
        await expect(run).rejects.toThrow(/malformed JSON/);
        expect((await prices()).length).toBeGreaterThanOrEqual(2);
        const [row] = await runs();
        expect(row).toMatchObject({ status: "error", finished: true });
        expect(row.error).toMatch(
          /^SourceFormatError: AllPrices\.json\.gz: malformed JSON/,
        );
      });
    });

    test("AC-11: --identifiers-only writes identifiers only, never prunes, never opens AllPrices", async () => {
      await client.query(
        `INSERT INTO price_history (scryfall_id, finish, date, price_cents) VALUES ($1, 'normal', $2, 500)`,
        [S.ETCHED, BEFORE_WINDOW],
      );
      const { result, source } = await ingest({ identifiersOnly: true });
      expect(result.exitCode).toBe(EXIT.ok);
      expect(source.opened).not.toContain(ALL_PRICES_FILE);
      expect(await identifiers()).toStrictEqual(STANDARD_IDENTIFIERS);
      expect(await prices()).toEqual([
        {
          scryfallId: S.ETCHED,
          finish: "normal",
          date: BEFORE_WINDOW,
          priceCents: 500,
        },
      ]);
      expect(await runs()).toEqual([
        expect.objectContaining({
          trigger: "identifiers",
          status: "ok",
          rows_written: STANDARD_IDENTIFIERS.length,
          rows_pruned: 0,
        }),
      ]);
    });

    test("AC-4: a bad AllPrices meta leaves all three tables empty and writes no run row", async () => {
      const files = fixtureFiles(STANDARD_CARDS, {
        pricesMeta: { date: RUN_DATE, version: "4.0.0" },
      });
      await expect(ingest({ files })).rejects.toBeInstanceOf(
        IngestRefusedError,
      );
      expect(await prices()).toEqual([]);
      expect(await identifiers()).toEqual([]);
      expect(await runs()).toEqual([]);
    });

    test("AC-9: a stubbed size over 450 MB at the 50-chunk re-check stops with budget_stop; 50 chunks stay, the prune ran", async () => {
      await client.query(
        `INSERT INTO price_history (scryfall_id, finish, date, price_cents) VALUES ($1, 'normal', $2, 500)`,
        ["30000000-0000-4000-8000-000000000009", BEFORE_WINDOW],
      );
      let sizeReads = 0;
      const cards = manyCards(10, 11);
      const run = await ingest({
        cards,
        chunkRows: 1,
        wrap: (db) => ({
          query: async (text, values) => {
            if (/pg_database_size/.test(text)) {
              sizeReads += 1;
              if (sizeReads >= 2)
                return { rowCount: 1, rows: [{ bytes: "450000001" }] };
            }
            return db.query(text, values);
          },
          end: () => db.end(),
        }),
      });
      expect(run.result.exitCode).toBe(EXIT.budgetStop);
      // 10 identifier chunks, then 40 price chunks, then the stop.
      expect((await identifiers()).length).toBe(10);
      expect((await prices()).length).toBe(40);
      const [row] = await runs();
      expect(row).toMatchObject({
        trigger: "bulk",
        status: "budget_stop",
        rows_written: 40,
        rows_pruned: 1,
        finished: true,
      });
    });
  },
);
