// T2 (AC-1) and T3 (AC-2): 0001_price_history deployed into an empty local
// Postgres. Runs on scratch databases on the server named by
// POSTGRES_URL_NON_POOLING (localhost only), dropped afterwards; seeding uses
// parameterized pg inserts. Unreachable server: fails when CI=true, skips
// with a warning otherwise (S0.1d10, AC-10).
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { withClient } from "../tests/helpers/local-db";
import {
  CI_UNREACHABLE_TEST,
  createScratchDatabase,
  dropScratchDatabase,
  IN_CI,
  prismaCli,
  probeScratchServer,
  type ScratchDatabase,
} from "../tests/helpers/scratch-db";

const server = await probeScratchServer();

const ID_A = "f3537373-ef54-4578-9d05-6216420ee349";
const ID_B = "f8b6c532-b837-42b6-9ed2-0231d0779626";
const NEW_TABLES = ["mtgjson_identifiers", "price_history", "price_sync_runs"];
const V1_TABLES = ["price_snapshots", "tracked_cards"];

/** information_schema.columns as compared in T2. */
interface Column {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  datetime_precision: number | null;
}

const col = (
  column_name: string,
  data_type: string,
  udt_name: string,
  nullable: boolean,
  column_default: string | null = null,
  datetime_precision: number | null = null,
): Column => ({
  column_name,
  data_type,
  udt_name,
  is_nullable: nullable ? "YES" : "NO",
  column_default,
  datetime_precision,
});
const TS3 = ["timestamp with time zone", "timestamptz"] as const;

/** F0 §Fields, in column order (S0.1d2). */
const EXPECTED_COLUMNS: Record<string, Column[]> = {
  price_history: [
    col("scryfall_id", "uuid", "uuid", false),
    col("finish", "USER-DEFINED", "card_finish", false),
    col("date", "date", "date", false, null, 0),
    col("price_cents", "integer", "int4", false),
    col("synced_at", ...TS3, false, "CURRENT_TIMESTAMP", 3),
  ],
  mtgjson_identifiers: [
    col("mtgjson_uuid", "uuid", "uuid", false),
    col("scryfall_id", "uuid", "uuid", false),
    col("side", "text", "text", true),
    col("edhrec_rank", "integer", "int4", true),
    col("loaded_at", ...TS3, false, "CURRENT_TIMESTAMP", 3),
  ],
  price_sync_runs: [
    col(
      "id",
      "integer",
      "int4",
      false,
      "nextval('price_sync_runs_id_seq'::regclass)",
    ),
    col("trigger", "USER-DEFINED", "price_sync_trigger", false),
    col("status", "USER-DEFINED", "price_sync_status", false),
    col("started_at", ...TS3, false, "CURRENT_TIMESTAMP", 3),
    col("finished_at", ...TS3, true, null, 3),
    col("source_date", "date", "date", true, null, 0),
    col("source_version", "text", "text", true),
    col("rows_written", "integer", "int4", false, "0"),
    col("rows_pruned", "integer", "int4", false, "0"),
    col("unmapped_uuids", "integer", "int4", false, "0"),
    col("db_bytes", "bigint", "int8", true),
    col("error", "text", "text", true),
  ],
};

const ENUM_VALUES: Record<string, string[]> = {
  card_finish: ["normal", "foil", "etched"],
  price_sync_trigger: ["cron", "bulk", "identifiers"],
  price_sync_status: ["running", "ok", "source_stale", "budget_stop", "error"],
};

async function columnsOf(c: pg.Client, table: string): Promise<Column[]> {
  const { rows } = await c.query<Column>(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default, datetime_precision
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

async function indexColumns(c: pg.Client, index: string): Promise<string[]> {
  const { rows } = await c.query<{ column_name: string }>(
    `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
       JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE ic.relname = $1
      ORDER BY k.ord`,
    [index],
  );
  return rows.map((r) => r.column_name);
}

/** V1's catalog: columns, constraints, indexes and reloptions (T2). */
async function v1Catalog(c: pg.Client) {
  const columns: Record<string, Column[]> = {};
  for (const t of V1_TABLES) columns[t] = await columnsOf(c, t);
  const constraints = await c.query(
    `SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conrelid IN ('tracked_cards'::regclass, 'price_snapshots'::regclass)
      ORDER BY 1, 2`,
  );
  const indexes = await c.query(
    `SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ANY($1::text[])
      ORDER BY 1, 2`,
    [V1_TABLES],
  );
  const reloptions = await c.query(
    `SELECT relname, reloptions, relrowsecurity FROM pg_class
      WHERE relname = ANY($1::text[]) AND relkind = 'r' ORDER BY 1`,
    [V1_TABLES],
  );
  return {
    columns,
    constraints: constraints.rows,
    indexes: indexes.rows,
    reloptions: reloptions.rows,
  };
}

/** Runs fn expecting a Postgres error; returns its code and constraint. */
async function pgError(
  fn: () => Promise<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  try {
    await fn();
  } catch (error) {
    const { code, constraint } = error as pg.DatabaseError;
    return { code, constraint };
  }
  throw new Error("expected a Postgres error, got success");
}

describe.runIf(IN_CI && !server.reachable)(
  "0001_price_history (CI without a database)",
  () => {
    test(CI_UNREACHABLE_TEST, () => {
      expect.fail(
        `local Postgres unreachable in CI (${server.reachable ? "" : server.reason})`,
      );
    });
  },
);

describe.skipIf(!server.reachable)(
  "0001_price_history against an empty local Postgres (T2, T3)",
  () => {
    const serverUrl = server.url!;
    let db: ScratchDatabase;
    let baselineOnly: ScratchDatabase;
    let firstDeploy: { status: number | null; output: string };
    let client: pg.Client;

    beforeAll(async () => {
      db = await createScratchDatabase(serverUrl, "mox_s01_mig");
      baselineOnly = await createScratchDatabase(serverUrl, "mox_s01_v1");
      firstDeploy = prismaCli(["migrate", "deploy"], db.url);
      // The V1 reference: 0000_baseline's SQL alone, no Prisma involved.
      const baselineSql = readFileSync(
        path.join(__dirname, "migrations", "0000_baseline", "migration.sql"),
        "utf8",
      );
      await withClient(baselineOnly.url, (c) => c.query(baselineSql));
      client = new pg.Client({ connectionString: db.url });
      await client.connect();
    });

    afterAll(async () => {
      await client?.end().catch(() => undefined);
      if (db) await dropScratchDatabase(serverUrl, db.name);
      if (baselineOnly) await dropScratchDatabase(serverUrl, baselineOnly.name);
    });

    describe("deploy (T2, AC-1)", () => {
      test("migrate deploy exits 0 and applies 0000_baseline before 0001_price_history", () => {
        expect(firstDeploy.status, firstDeploy.output).toBe(0);
        const base = firstDeploy.output.indexOf("0000_baseline");
        const next = firstDeploy.output.indexOf("0001_price_history");
        expect(base).toBeGreaterThanOrEqual(0);
        expect(next).toBeGreaterThan(base);
      });

      test("_prisma_migrations holds exactly the two, finished and not rolled back, in order", async () => {
        const { rows } = await client.query(
          `SELECT migration_name, finished_at IS NOT NULL AS finished,
                  rolled_back_at IS NOT NULL AS rolled_back
             FROM _prisma_migrations ORDER BY started_at, migration_name`,
        );
        expect(rows).toEqual([
          {
            migration_name: "0000_baseline",
            finished: true,
            rolled_back: false,
          },
          {
            migration_name: "0001_price_history",
            finished: true,
            rolled_back: false,
          },
        ]);
      });

      test("the three F0 tables exist in public beside V1's two", async () => {
        const { rows } = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
            ORDER BY table_name`,
        );
        expect(rows.map((r) => r.table_name)).toEqual(
          [...NEW_TABLES, ...V1_TABLES].sort(),
        );
      });

      test.each(Object.entries(ENUM_VALUES))(
        "enum %s has F0's values in order",
        async (name, values) => {
          const { rows } = await client.query<{ label: string }>(
            `SELECT e.enumlabel AS label FROM pg_enum e
               JOIN pg_type t ON t.oid = e.enumtypid
              WHERE t.typname = $1 ORDER BY e.enumsortorder`,
            [name],
          );
          expect(rows.map((r) => r.label)).toEqual(values);
        },
      );

      test.each(Object.entries(EXPECTED_COLUMNS))(
        "%s's columns equal F0 §Fields",
        async (table, expected) => {
          expect(await columnsOf(client, table)).toEqual(expected);
        },
      );

      test("price_history_pkey covers (scryfall_id, finish, date) and is price_history's only index", async () => {
        expect(await indexColumns(client, "price_history_pkey")).toEqual([
          "scryfall_id",
          "finish",
          "date",
        ]);
        const { rows } = await client.query(
          `SELECT indexname FROM pg_indexes WHERE tablename = 'price_history'`,
        );
        expect(rows).toEqual([{ indexname: "price_history_pkey" }]);
      });

      test("price_sync_runs_status_finished_at_idx covers (status, finished_at)", async () => {
        expect(
          await indexColumns(client, "price_sync_runs_status_finished_at_idx"),
        ).toEqual(["status", "finished_at"]);
      });

      test("no F0 table has a foreign key", async () => {
        const { rows } = await client.query(
          `SELECT conname FROM pg_constraint
            WHERE contype = 'f' AND conrelid::regclass::text = ANY($1::text[])`,
          [NEW_TABLES],
        );
        expect(rows).toEqual([]);
      });

      test("price_history carries both autovacuum settings (C2-A.8)", async () => {
        const { rows } = await client.query<{ reloptions: string[] }>(
          `SELECT reloptions FROM pg_class WHERE relname = 'price_history'`,
        );
        expect([...rows[0].reloptions].sort()).toEqual([
          "autovacuum_vacuum_insert_scale_factor=0.02",
          "autovacuum_vacuum_scale_factor=0.02",
        ]);
      });

      test("the CHECK exists as CHECK ((price_cents > 0))", async () => {
        const { rows } = await client.query(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conname = 'price_history_price_cents_check'
              AND conrelid = 'price_history'::regclass AND contype = 'c'`,
        );
        expect(rows).toEqual([{ def: "CHECK ((price_cents > 0))" }]);
      });

      test("row level security is on for the three F0 tables, with no policy, and off for V1's (ADV.7)", async () => {
        const { rows } = await client.query(
          `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
            WHERE relkind = 'r' AND relname = ANY($1::text[]) ORDER BY relname`,
          [[...NEW_TABLES, ...V1_TABLES]],
        );
        expect(rows).toEqual(
          [...NEW_TABLES, ...V1_TABLES].sort().map((relname) => ({
            relname,
            relrowsecurity: NEW_TABLES.includes(relname),
            relforcerowsecurity: false,
          })),
        );
        const policies = await client.query(
          `SELECT tablename FROM pg_policies WHERE tablename = ANY($1::text[])`,
          [NEW_TABLES],
        );
        expect(policies.rows).toEqual([]);
      });

      test("a granted role without BYPASSRLS (Supabase's anon) can neither write nor read; the owner still reads (ADV.7)", async () => {
        const role = `mox_s01_anon_${process.pid}`;
        await client.query(`CREATE ROLE "${role}" NOLOGIN NOBYPASSRLS`);
        try {
          await client.query(
            `GRANT ALL ON "price_history", "mtgjson_identifiers", "price_sync_runs" TO "${role}"`,
          );
          await client.query(
            `GRANT USAGE ON SEQUENCE "price_sync_runs_id_seq" TO "${role}"`,
          );
          await client.query(
            `INSERT INTO price_history (scryfall_id, finish, date, price_cents)
             VALUES ($1, 'normal', '2026-09-01', 999)`,
            [ID_A],
          );
          await client.query("BEGIN");
          try {
            await client.query(`SET LOCAL ROLE "${role}"`);
            const read = await client.query(
              "SELECT count(*)::int AS n FROM price_history",
            );
            expect(read.rows).toEqual([{ n: 0 }]);
            for (const write of [
              `INSERT INTO price_history (scryfall_id, finish, date, price_cents)
               VALUES ('${ID_B}', 'normal', '2026-09-02', 1)`,
              `INSERT INTO price_sync_runs (trigger, status, finished_at)
               VALUES ('cron', 'ok', now() + interval '1 day')`,
              `INSERT INTO mtgjson_identifiers (mtgjson_uuid, scryfall_id)
               VALUES ('5f8287b1-5bb6-5f4c-ad17-316a40d5bb0d', '${ID_B}')`,
            ]) {
              await client.query("SAVEPOINT w");
              expect((await pgError(() => client.query(write))).code).toBe(
                "42501",
              );
              await client.query("ROLLBACK TO SAVEPOINT w");
            }
          } finally {
            await client.query("ROLLBACK");
          }
          const owner = await client.query(
            "SELECT count(*)::int AS n FROM price_history WHERE date = '2026-09-01'",
          );
          expect(owner.rows).toEqual([{ n: 1 }]);
        } finally {
          await client.query(
            "DELETE FROM price_history WHERE date = '2026-09-01'",
          );
          await client.query(`DROP OWNED BY "${role}"`);
          await client.query(`DROP ROLE "${role}"`);
        }
      });

      test("V1's tables are unchanged: their catalog equals 0000_baseline's alone", async () => {
        const after = await v1Catalog(client);
        const reference = await withClient(baselineOnly.url, v1Catalog);
        expect(after.columns.tracked_cards).toHaveLength(6);
        expect(after.columns.price_snapshots).toHaveLength(8);
        expect(after.constraints.length).toBeGreaterThanOrEqual(3);
        expect(after).toEqual(reference);
      });

      test("drift: migrate diff from the deployed database to schema.prisma is clean (S0.1d4)", () => {
        const { status, output } = prismaCli(
          [
            "migrate",
            "diff",
            "--from-config-datasource",
            "--to-schema",
            "prisma/schema.prisma",
            "--exit-code",
          ],
          db.url,
        );
        expect(status, output).toBe(0);
        expect(output).toMatch(/No difference detected/);
      });

      test("a second deploy is a no-op", () => {
        const { status, output } = prismaCli(["migrate", "deploy"], db.url);
        expect(status, output).toBe(0);
        expect(output).toMatch(/No pending migrations to apply/i);
      });
    });

    describe("constraints (T3, AC-2)", () => {
      const insertHistory = (
        id: string,
        finish: string,
        date: string,
        cents: number | null,
      ) =>
        client.query(
          `INSERT INTO price_history (scryfall_id, finish, date, price_cents)
           VALUES ($1, $2, $3, $4)`,
          [id, finish, date, cents],
        );

      beforeAll(async () => {
        await insertHistory(ID_A, "foil", "2026-10-01", 500);
      });

      test("a second row with the same (scryfall_id, finish, date) fails 23505 on price_history_pkey", async () => {
        expect(
          await pgError(() => insertHistory(ID_A, "foil", "2026-10-01", 600)),
        ).toEqual({ code: "23505", constraint: "price_history_pkey" });
      });

      test("the same id and date with another finish, and the same id and finish with another date, both insert", async () => {
        await expect(
          insertHistory(ID_A, "normal", "2026-10-01", 400),
        ).resolves.toMatchObject({ rowCount: 1 });
        await expect(
          insertHistory(ID_A, "foil", "2026-10-02", 510),
        ).resolves.toMatchObject({ rowCount: 1 });
      });

      test.each([0, -1])(
        "price_cents %d fails 23514 on price_history_price_cents_check",
        async (cents) => {
          expect(
            await pgError(() =>
              insertHistory(ID_B, "foil", "2026-10-03", cents),
            ),
          ).toEqual({
            code: "23514",
            constraint: "price_history_price_cents_check",
          });
        },
      );

      test("price_cents 1 inserts", async () => {
        await expect(
          insertHistory(ID_B, "foil", "2026-10-03", 1),
        ).resolves.toMatchObject({ rowCount: 1 });
      });

      test("a null price_cents fails 23502", async () => {
        expect(
          (await pgError(() => insertHistory(ID_B, "foil", "2026-10-04", null)))
            .code,
        ).toBe("23502");
      });

      test.each([
        ["finish Foil", ID_B, "Foil"],
        ["finish nonfoil", ID_B, "nonfoil"],
        ["scryfall_id not-a-uuid", "not-a-uuid", "foil"],
      ])("%s fails 22P02", async (_name, id, finish) => {
        expect(
          (await pgError(() => insertHistory(id, finish, "2026-10-05", 100)))
            .code,
        ).toBe("22P02");
      });

      test("an omitted synced_at defaults to the insert time", async () => {
        const { rows } = await client.query<{ synced_at: Date; ms: number }>(
          `INSERT INTO price_history (scryfall_id, finish, date, price_cents)
           VALUES ($1, 'etched', '2026-10-06', 700)
           RETURNING synced_at,
                     abs(extract(epoch FROM synced_at - now())) * 1000 AS ms`,
          [ID_B],
        );
        expect(rows[0].synced_at).toBeInstanceOf(Date);
        // TIMESTAMPTZ(3) rounds the transaction time to the millisecond.
        expect(Number(rows[0].ms)).toBeLessThanOrEqual(1);
      });

      test("a price_sync_runs status of stale fails 22P02", async () => {
        expect(
          (
            await pgError(() =>
              client.query(
                `INSERT INTO price_sync_runs (trigger, status) VALUES ('cron', 'stale')`,
              ),
            )
          ).code,
        ).toBe("22P02");
      });

      test("a price_sync_runs row with only trigger and status gets zero counts and a started_at", async () => {
        const { rows } = await client.query(
          `INSERT INTO price_sync_runs (trigger, status) VALUES ('bulk', 'running')
           RETURNING rows_written, rows_pruned, unmapped_uuids,
                     started_at IS NOT NULL AS started, finished_at`,
        );
        expect(rows).toEqual([
          {
            rows_written: 0,
            rows_pruned: 0,
            unmapped_uuids: 0,
            started: true,
            finished_at: null,
          },
        ]);
      });

      test("a duplicate mtgjson_uuid fails 23505", async () => {
        const insert = () =>
          client.query(
            `INSERT INTO mtgjson_identifiers (mtgjson_uuid, scryfall_id) VALUES ($1, $2)`,
            ["5f8287b1-5bb6-5f4c-ad17-316a40d5bb0c", ID_A],
          );
        await insert();
        expect(await pgError(insert)).toEqual({
          code: "23505",
          constraint: "mtgjson_identifiers_pkey",
        });
      });
    });

    // S0.1 ADV.2 (S0.1d25): a failure inside 0001 leaves nothing behind, and
    // the README's recovery (resolve --rolled-back, then deploy) works.
    describe("a failing 0001 is all or nothing (ADV.2)", () => {
      let failing: ScratchDatabase;
      let dir: string;

      beforeAll(async () => {
        failing = await createScratchDatabase(serverUrl, "mox_s01_fail");
        dir = mkdtempSync(path.join(tmpdir(), "mox-s01-fail-"));
        cpSync(
          path.join(__dirname, "migrations"),
          path.join(dir, "migrations"),
          {
            recursive: true,
          },
        );
        const file = path.join(
          dir,
          "migrations",
          "0001_price_history",
          "migration.sql",
        );
        const original = readFileSync(file, "utf8");
        // The failing statement goes inside the transaction, before COMMIT.
        const planted = original.replace(
          /\nCOMMIT;\n$/,
          "\nSELECT 1/0;\n\nCOMMIT;\n",
        );
        expect(planted).not.toBe(original);
        writeFileSync(file, planted);
        // A config with no imports: only the migrations path differs. The
        // URL is the scratch database, checked local by prismaCli.
        writeFileSync(
          path.join(dir, "prisma.config.mjs"),
          `export default {
  schema: ${JSON.stringify(path.join(__dirname, "schema.prisma"))},
  migrations: { path: ${JSON.stringify(path.join(dir, "migrations"))} },
  datasource: { url: process.env.POSTGRES_URL_NON_POOLING },
};
`,
        );
      });

      afterAll(async () => {
        if (failing) await dropScratchDatabase(serverUrl, failing.name);
        if (dir) rmSync(dir, { recursive: true, force: true });
      });

      test("deploy fails, no F0 type, table or setting is left, and resolve --rolled-back then deploy recovers", async () => {
        const bad = prismaCli(
          [
            "migrate",
            "deploy",
            "--config",
            path.join(dir, "prisma.config.mjs"),
          ],
          failing.url,
        );
        expect(bad.status, bad.output).not.toBe(0);

        await withClient(failing.url, async (c) => {
          const types = await c.query(
            `SELECT typname FROM pg_type
              WHERE typname = ANY($1::text[])`,
            [Object.keys(ENUM_VALUES)],
          );
          expect(types.rows).toEqual([]);
          const tables = await c.query(
            `SELECT relname FROM pg_class WHERE relname = ANY($1::text[])`,
            [[...NEW_TABLES, "price_history_price_cents_check"]],
          );
          expect(tables.rows).toEqual([]);
          const { rows } = await c.query(
            `SELECT migration_name, finished_at IS NOT NULL AS finished
               FROM _prisma_migrations ORDER BY started_at`,
          );
          expect(rows).toEqual([
            { migration_name: "0000_baseline", finished: true },
            { migration_name: "0001_price_history", finished: false },
          ]);
        });

        // Re-running deploy as is refuses (P3009): the README says stop.
        const again = prismaCli(
          [
            "migrate",
            "deploy",
            "--config",
            path.join(dir, "prisma.config.mjs"),
          ],
          failing.url,
        );
        expect(again.status).not.toBe(0);
        expect(again.output).toMatch(/P3009/);

        // The README's recovery, with the real migration file.
        const resolved = prismaCli(
          ["migrate", "resolve", "--rolled-back", "0001_price_history"],
          failing.url,
        );
        expect(resolved.status, resolved.output).toBe(0);
        const fixed = prismaCli(["migrate", "deploy"], failing.url);
        expect(fixed.status, fixed.output).toBe(0);
        expect(fixed.output).toMatch(/0001_price_history/);
        await withClient(failing.url, async (c) => {
          const { rows } = await c.query(
            `SELECT count(*)::int AS n FROM pg_class
              WHERE relkind = 'r' AND relname = ANY($1::text[]) AND relrowsecurity`,
            [NEW_TABLES],
          );
          expect(rows).toEqual([{ n: 3 }]);
        });
      });
    });

    // S0.1 ADV.6: Josh's production sequence (README, Production), rehearsed
    // on a database built the way production was: 0000's SQL applied outside
    // Migrate, V1 rows present, no _prisma_migrations table.
    describe("the README's production steps, rehearsed locally (ADV.6, T14)", () => {
      let prod: ScratchDatabase;
      let dir: string;
      let schema0000: string;
      const V1_ROWS = {
        card: ["card-1", "Esper Sentinel", "mh2", "Modern Horizons 2", "12"],
        snapshot: ["snap-1", "card-1", 59.17, 120.5],
      };

      beforeAll(async () => {
        prod = await createScratchDatabase(serverUrl, "mox_s01_prod");
        dir = mkdtempSync(path.join(tmpdir(), "mox-s01-prod-"));
        const baselineSql = readFileSync(
          path.join(__dirname, "migrations", "0000_baseline", "migration.sql"),
          "utf8",
        );
        await withClient(prod.url, async (c) => {
          await c.query(baselineSql);
          await c.query(
            `INSERT INTO tracked_cards (id, name, set, set_name, collector_number)
             VALUES ($1, $2, $3, $4, $5)`,
            V1_ROWS.card,
          );
          await c.query(
            `INSERT INTO price_snapshots (id, card_id, usd, usd_foil)
             VALUES ($1, $2, $3, $4)`,
            V1_ROWS.snapshot,
          );
        });
        // README step (a)'s reference: the S1.1 merge's schema. CI checks out
        // full history (fetch-depth: 0) so this commit is present.
        schema0000 = path.join(dir, "schema-0000.prisma");
        writeFileSync(
          schema0000,
          execFileSync("git", ["show", "9a2837b:prisma/schema.prisma"], {
            cwd: path.join(__dirname, ".."),
            encoding: "utf8",
          }),
        );
      });

      afterAll(async () => {
        if (prod) await dropScratchDatabase(serverUrl, prod.name);
        if (dir) rmSync(dir, { recursive: true, force: true });
      });

      const v1Rows = (url: string) =>
        withClient(url, async (c) => ({
          cards: (await c.query("SELECT * FROM tracked_cards ORDER BY id"))
            .rows,
          snapshots: (
            await c.query("SELECT * FROM price_snapshots ORDER BY id")
          ).rows,
        }));

      test("(a) diff, (b) resolve, (c0) status, (c) deploy, (d) status and diff behave as the README says", async () => {
        const before = await v1Rows(prod.url);
        expect(before.cards).toHaveLength(1);

        const a = prismaCli(
          [
            "migrate",
            "diff",
            "--from-config-datasource",
            "--to-schema",
            schema0000,
            "--exit-code",
          ],
          prod.url,
        );
        expect(a.status, a.output).toBe(0);
        expect(a.output).toMatch(/No difference detected/);

        const b = prismaCli(
          ["migrate", "resolve", "--applied", "0000_baseline"],
          prod.url,
        );
        expect(b.status, b.output).toBe(0);

        // (c0): the pre-check shows exactly 0001_price_history pending.
        const c0 = prismaCli(["migrate", "status"], prod.url);
        expect(c0.output).toMatch(
          /Following migration have not yet been applied:\s+0001_price_history\s/,
        );
        expect(c0.output).not.toMatch(/000[2-9]_/);

        const c = prismaCli(["migrate", "deploy"], prod.url);
        expect(c.status, c.output).toBe(0);
        expect(c.output).toMatch(/Applying migration `0001_price_history`/);
        expect(c.output).not.toMatch(/Applying migration `0000_baseline`/);

        const d1 = prismaCli(["migrate", "status"], prod.url);
        expect(d1.status, d1.output).toBe(0);
        expect(d1.output).toMatch(/Database schema is up to date/);
        const d2 = prismaCli(
          [
            "migrate",
            "diff",
            "--from-config-datasource",
            "--to-schema",
            "prisma/schema.prisma",
            "--exit-code",
          ],
          prod.url,
        );
        expect(d2.status, d2.output).toBe(0);

        const twice = prismaCli(["migrate", "deploy"], prod.url);
        expect(twice.status, twice.output).toBe(0);
        expect(twice.output).toMatch(/No pending migrations to apply/i);

        expect(await v1Rows(prod.url)).toEqual(before);
        await withClient(prod.url, async (c2) => {
          const { rows } = await c2.query(
            `SELECT migration_name, applied_steps_count, finished_at IS NOT NULL AS finished
               FROM _prisma_migrations ORDER BY started_at`,
          );
          expect(rows).toEqual([
            {
              migration_name: "0000_baseline",
              applied_steps_count: 0,
              finished: true,
            },
            {
              migration_name: "0001_price_history",
              applied_steps_count: 1,
              finished: true,
            },
          ]);
        });
      });
    });
  },
);
