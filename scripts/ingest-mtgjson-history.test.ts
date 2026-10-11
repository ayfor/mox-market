// T14 (AC-4, AC-6, AC-9; S0.2d18, S0.2d24): the ingest CLI as a child
// process (tsx, cwd the repo root). Every case runs with a scrubbed
// environment: no database URL unless the case sets one, ALLOW_PROD_INGEST
// never set, and no case passes --production. Fixtures are written to a temp
// directory for --source-dir; nothing touches the network or a database.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  fixtureFiles,
  STANDARD_CARDS,
} from "../src/lib/mtgjson/__fixtures__/build";
import { ALL_PRICES_FILE } from "../src/lib/mtgjson/consts";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = "scripts/ingest-mtgjson-history.ts";
const SCRUBBED = [
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL",
  "ALLOW_PROD_INGEST",
  "POSTGRES_SSL_ROOT_CERT",
  "PGHOST",
  "PGHOSTADDR",
];

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the CLI; `env` adds variables to a scrubbed copy of this process's. */
function cli(
  args: readonly string[],
  env: Record<string, string> = {},
  cwd = ROOT,
): Promise<Run> {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SCRUBBED.includes(key) || key.startsWith("VITEST")) continue;
    childEnv[key] = value;
  }
  Object.assign(childEnv, env);
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [TSX, path.join(ROOT, SCRIPT), ...args],
      { cwd, env: childEnv },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

let fixtures: string;
beforeAll(() => {
  fixtures = mkdtempSync(path.join(tmpdir(), "mtgjson-cli-"));
  for (const [name, bytes] of Object.entries(fixtureFiles())) {
    writeFileSync(path.join(fixtures, name), bytes);
  }
});
afterAll(() => {
  rmSync(fixtures, { recursive: true, force: true });
});

const TIMEOUT = 30_000;

describe("the ingest CLI (T14)", () => {
  test(
    "--help exits 0 and lists every flag",
    { timeout: TIMEOUT },
    async () => {
      const run = await cli(["--help"]);
      expect(run.code).toBe(0);
      for (const flag of [
        "--dry-run",
        "--production",
        "--identifiers-only",
        "--source-dir",
        "--basis-sample",
        "--seed",
        "--help",
      ]) {
        expect(run.stdout).toContain(flag);
      }
    },
  );

  test("an unknown flag exits 2", { timeout: TIMEOUT }, async () => {
    const run = await cli(["--force"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/usage error/);
  });

  test(
    "--basis-sample 25 without --dry-run exits 2",
    { timeout: TIMEOUT },
    async () => {
      const run = await cli(["--basis-sample", "25", "--source-dir", fixtures]);
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(/--basis-sample runs only with --dry-run/);
    },
  );

  test(
    "--dry-run --source-dir <fixtures> exits 0 and prints the report",
    { timeout: TIMEOUT },
    async () => {
      const run = await cli(["--dry-run", "--source-dir", fixtures]);
      expect(run.stderr).not.toMatch(/run error/);
      expect(run.code).toBe(0);
      expect(run.stdout).toContain("target database: none (dry-run)");
      expect(run.stdout).toContain("MTGJson ingest report");
      expect(run.stdout).toMatch(
        /rows by finish: normal \d+, foil \d+, etched \d+/,
      );
    },
  );

  test(
    "a Meta.json version 4.9.0 exits 2 before any database write",
    { timeout: TIMEOUT },
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "mtgjson-cli-v4-"));
      try {
        for (const [name, bytes] of Object.entries(
          fixtureFiles(STANDARD_CARDS, {
            meta: { date: "2026-10-05", version: "4.9.0" },
          }),
        )) {
          writeFileSync(path.join(dir, name), bytes);
        }
        const run = await cli(["--source-dir", dir], {
          POSTGRES_URL_NON_POOLING:
            "postgresql://postgres:postgres@localhost:1/none",
        });
        expect(run.code).toBe(2);
        expect(run.stderr).toMatch(/before any database write/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test(
    "--source-dir missing a file exits 2 naming it",
    { timeout: TIMEOUT },
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "mtgjson-cli-missing-"));
      try {
        for (const [name, bytes] of Object.entries(fixtureFiles())) {
          writeFileSync(path.join(dir, name), bytes);
        }
        unlinkSync(path.join(dir, ALL_PRICES_FILE));
        const run = await cli(["--dry-run", "--source-dir", dir]);
        expect(run.code).toBe(2);
        expect(run.stderr).toContain(`${ALL_PRICES_FILE} is missing`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test(
    "a Supabase URL without the opt-ins exits 2 with 'refusing' and no password anywhere",
    { timeout: TIMEOUT },
    async () => {
      const run = await cli(["--source-dir", fixtures], {
        POSTGRES_URL_NON_POOLING:
          "postgresql://postgres:pw-XYZZY-123@db.example.supabase.co:5432/postgres",
      });
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(/refusing/);
      expect(run.stdout + run.stderr).not.toContain("pw-XYZZY-123");
      expect(run.stdout).not.toContain("target database:");
    },
  );

  test.each([
    [["postgresql://u:pw-XYZZY@db.example.invalid/db"]],
    [["--dry-run", "--source-dir", "postgresql://u:pw-XYZZY@h/db"]],
  ])(
    "a connection string in argv exits 2 and is echoed nowhere (ADV.13): %j",
    { timeout: TIMEOUT },
    async (args) => {
      const run = await cli(args);
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(/^usage error: /);
      expect(run.stdout + run.stderr).not.toContain("pw-XYZZY");
    },
  );

  test(
    "run from scripts/, --help and a dry-run still work (ADV.5)",
    { timeout: TIMEOUT },
    async () => {
      const scripts = path.join(ROOT, "scripts");
      const help = await cli(["--help"], {}, scripts);
      expect(help.code).toBe(0);
      const dry = await cli(
        ["--dry-run", "--source-dir", fixtures],
        {},
        scripts,
      );
      expect(dry.stderr).not.toMatch(/run error/);
      expect(dry.code).toBe(0);
      expect(dry.stdout).toContain("MTGJson ingest report");
    },
  );

  describe("hostaddr behind a Supabase name", () => {
    let server: Server;
    let connections = 0;
    let port = 0;
    beforeAll(async () => {
      server = createServer((socket) => {
        connections += 1;
        socket.destroy();
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      port = (server.address() as { port: number }).port;
    });
    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    test(
      "exits 2 and a stub server on 127.0.0.1 records zero connections",
      { timeout: TIMEOUT },
      async () => {
        const run = await cli(["--source-dir", fixtures], {
          POSTGRES_URL_NON_POOLING: `postgresql://postgres:pw@db.example.supabase.co:${port}/postgres?hostaddr=127.0.0.1`,
        });
        expect(run.code).toBe(2);
        expect(run.stderr).toMatch(
          /refusing to run: the database URL sets hostaddr/,
        );
        expect(connections).toBe(0);
      },
    );
  });
});
