// T15 (AC-7, AC-10, AC-11; S0.2d18): the CLI's path B end to end on a
// scratch database (localhost URL set inline for the child only). The CLI
// reads the real clock, so the fixtures are dated around today's UTC date.
// No --production, and ALLOW_PROD_INGEST is never set. Unreachable server:
// fails when CI=true, skips with a warning otherwise.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  fixtureFiles,
  standardCards,
  standardRows,
} from "../src/lib/mtgjson/__fixtures__/build";
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
const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRUBBED = [
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL",
  "ALLOW_PROD_INGEST",
  "POSTGRES_SSL_ROOT_CERT",
];

function cli(args: readonly string[], url: string) {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SCRUBBED.includes(key) || key.startsWith("VITEST")) continue;
    env[key] = value;
  }
  env.POSTGRES_URL_NON_POOLING = url;
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [TSX, "scripts/ingest-mtgjson-history.ts", ...args],
        { cwd: ROOT, env },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (stderr += c));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

describe.runIf(IN_CI && !server.reachable)(
  "the ingest CLI, path B (CI without a database)",
  () => {
    test(CI_UNREACHABLE_TEST, () => {
      expect.fail(
        `local Postgres unreachable in CI (${server.reachable ? "" : server.reason})`,
      );
    });
  },
);

describe.skipIf(!server.reachable)(
  "the ingest CLI, path B on a scratch database (T15)",
  () => {
    let scratch: ScratchDatabase;
    let client: pg.Client;
    let fixtures: string;
    const today = new Date().toISOString().slice(0, 10);

    beforeAll(async () => {
      scratch = await createScratchDatabase(server.url!, "mtgjson_cli");
      const deploy = prismaCli(["migrate", "deploy"], scratch.url);
      expect(deploy.status, deploy.output).toBe(0);
      client = new pg.Client({ connectionString: scratch.url });
      await client.connect();
      fixtures = mkdtempSync(path.join(tmpdir(), "mtgjson-cli-int-"));
      const meta = { date: today, version: "5.3.0+fixture" };
      for (const [name, bytes] of Object.entries(
        fixtureFiles(
          standardCards(today),
          { meta, identifiersMeta: meta, pricesMeta: meta },
          today,
        ),
      )) {
        writeFileSync(path.join(fixtures, name), bytes);
      }
    });

    afterAll(async () => {
      await client?.end().catch(() => undefined);
      if (fixtures) rmSync(fixtures, { recursive: true, force: true });
      if (scratch) await dropScratchDatabase(server.url!, scratch.name);
    });

    test(
      "a bulk run exits 0, prints the local target without credentials, and writes a bulk ok run",
      { timeout: 60_000 },
      async () => {
        const run = await cli(["--source-dir", fixtures], scratch.url);
        expect(run.stderr).not.toMatch(/run error|refusing/);
        expect(run.code).toBe(0);
        const url = new URL(scratch.url);
        expect(run.stdout).toContain(
          `target database: localhost:${url.port || "5432"}/${scratch.name} (local)`,
        );
        expect(run.stdout + run.stderr).not.toMatch(/postgres(ql)?:\/\//);
        if (url.password)
          expect(run.stdout + run.stderr).not.toContain(url.password);
        const count = await client.query(
          `SELECT count(*)::int AS n FROM price_history`,
        );
        expect(count.rows[0].n).toBe(standardRows(today).length);
        const runs = await client.query(
          `SELECT trigger::text, status::text, rows_written FROM price_sync_runs ORDER BY id`,
        );
        expect(runs.rows).toEqual([
          {
            trigger: "bulk",
            status: "ok",
            rows_written: standardRows(today).length,
          },
        ]);
      },
    );

    test(
      "a second run prints rows written: 0",
      { timeout: 60_000 },
      async () => {
        const run = await cli(["--source-dir", fixtures], scratch.url);
        expect(run.code).toBe(0);
        expect(run.stdout).toMatch(/^ {2}rows written: 0 \(/m);
      },
    );

    test(
      "--identifiers-only exits 0 with an identifiers run row",
      { timeout: 60_000 },
      async () => {
        const run = await cli(
          ["--identifiers-only", "--source-dir", fixtures],
          scratch.url,
        );
        expect(run.code).toBe(0);
        const runs = await client.query(
          `SELECT trigger::text, status::text FROM price_sync_runs ORDER BY id DESC LIMIT 1`,
        );
        expect(runs.rows[0]).toEqual({ trigger: "identifiers", status: "ok" });
      },
    );
  },
);
