// T17 (AC-11, AC-12): 0000_baseline deploys into an empty local Postgres and
// matches the schema. Runs against a scratch database on the server named by
// POSTGRES_URL_NON_POOLING (localhost only), dropped afterwards. Unreachable
// server: fails when CI=true, skips with a warning otherwise (S1.1d14).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assertLocalDatabaseUrl,
  isReachable,
  scratchDatabaseName,
  UNREACHABLE_WARNING,
  withClient,
  withDatabase,
} from "../tests/helpers/local-db";

const ROOT = path.resolve(__dirname, "..");
const PRISMA_CLI = path.join(
  ROOT,
  "node_modules",
  "prisma",
  "build",
  "index.js",
);
const IN_CI = process.env.CI === "true";
const serverUrl = process.env.POSTGRES_URL_NON_POOLING;

// The host check runs before any connection attempt (AGENTS.md Databases limit).
if (serverUrl) assertLocalDatabaseUrl(serverUrl);
const reachable = serverUrl ? await isReachable(serverUrl, 3_000) : false;
// Written straight to stderr: Vitest does not surface console output from a
// file whose tests all skip, and the skip reason must be visible.
if (!reachable && !IN_CI) process.stderr.write(`⚠ ${UNREACHABLE_WARNING}\n`);

function prisma(args: string[], url: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("VITEST") ||
      key === "DATABASE_URL" ||
      key === "ALLOW_PROD_MIGRATE"
    ) {
      delete env[key];
    }
  }
  env.POSTGRES_URL_NON_POOLING = url;
  env.POSTGRES_PRISMA_URL = url;
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 50_000,
  });
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

describe.runIf(IN_CI && !reachable)(
  "baseline migration (CI without a database)",
  () => {
    test("the postgres:16 service must be reachable in CI", () => {
      expect.fail(
        `${UNREACHABLE_WARNING} (POSTGRES_URL_NON_POOLING ${serverUrl ? "set" : "unset"})`,
      );
    });
  },
);

describe.skipIf(!reachable)(
  reachable
    ? "0000_baseline against an empty local Postgres"
    : `0000_baseline against an empty local Postgres (skipped: ${UNREACHABLE_WARNING})`,
  () => {
    const scratch = scratchDatabaseName("mox_baseline");
    let scratchUrl = "";

    beforeAll(async () => {
      scratchUrl = withDatabase(serverUrl!, scratch);
      await withClient(serverUrl!, (c) =>
        c.query(`CREATE DATABASE "${scratch}"`),
      );
    });

    afterAll(async () => {
      if (!serverUrl) return;
      await withClient(serverUrl, (c) =>
        c.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`),
      );
    });

    test("migrate deploy applies 0000_baseline", () => {
      const { status, output } = prisma(["migrate", "deploy"], scratchUrl);
      expect(status, output).toBe(0);
      expect(output).toContain("0000_baseline");
    });

    test("both V1 tables exist in public", async () => {
      const rows = await withClient(scratchUrl, (c) =>
        c.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name IN ('tracked_cards', 'price_snapshots')
          ORDER BY table_name`,
        ),
      );
      expect(rows.rows.map((r) => r.table_name)).toEqual([
        "price_snapshots",
        "tracked_cards",
      ]);
    });

    test("price_snapshots_card_id_timestamp_idx covers (card_id, timestamp)", async () => {
      const rows = await withClient(scratchUrl, (c) =>
        c.query<{ column_name: string }>(
          `SELECT a.attname AS column_name
           FROM pg_index i
           JOIN pg_class ic ON ic.oid = i.indexrelid
           JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          WHERE ic.relname = 'price_snapshots_card_id_timestamp_idx'
          ORDER BY k.ord`,
        ),
      );
      expect(rows.rows.map((r) => r.column_name)).toEqual([
        "card_id",
        "timestamp",
      ]);
    });

    test("price_snapshots_card_id_fkey references tracked_cards(id) ON DELETE CASCADE", async () => {
      const rows = await withClient(scratchUrl, (c) =>
        c.query<{
          child: string;
          parent: string;
          child_cols: string;
          parent_cols: string;
          on_delete: string;
        }>(
          `SELECT con.conrelid::regclass::text AS child,
                con.confrelid::regclass::text AS parent,
                (SELECT string_agg(attname, ',') FROM pg_attribute
                  WHERE attrelid = con.conrelid AND attnum = ANY (con.conkey)) AS child_cols,
                (SELECT string_agg(attname, ',') FROM pg_attribute
                  WHERE attrelid = con.confrelid AND attnum = ANY (con.confkey)) AS parent_cols,
                con.confdeltype AS on_delete
           FROM pg_constraint con
          WHERE con.conname = 'price_snapshots_card_id_fkey' AND con.contype = 'f'`,
        ),
      );
      expect(rows.rows).toEqual([
        {
          child: "price_snapshots",
          parent: "tracked_cards",
          child_cols: "card_id",
          parent_cols: "id",
          on_delete: "c",
        },
      ]);
    });

    test("_prisma_migrations records 0000_baseline as finished", async () => {
      const rows = await withClient(scratchUrl, (c) =>
        c.query<{
          migration_name: string;
          finished: boolean;
          rolled_back: boolean;
        }>(
          `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
           FROM _prisma_migrations ORDER BY migration_name`,
        ),
      );
      expect(rows.rows).toEqual([
        { migration_name: "0000_baseline", finished: true, rolled_back: false },
      ]);
    });

    test("migrate diff against the schema reports no difference (rehearses Josh's step a)", () => {
      const { status, output } = prisma(
        [
          "migrate",
          "diff",
          "--from-config-datasource",
          "--to-schema",
          "prisma/schema.prisma",
          "--exit-code",
        ],
        scratchUrl,
      );
      expect(status, output).toBe(0);
    });

    test("a second deploy is a no-op", () => {
      const { status, output } = prisma(["migrate", "deploy"], scratchUrl);
      expect(status, output).toBe(0);
      expect(output).toMatch(/No pending migrations to apply/i);
    });
  },
);
