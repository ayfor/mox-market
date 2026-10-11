// T12 (AC-10; S0.1d10): S0.1's two integration files run as child Vitest
// processes with a scrubbed environment. With no reachable database they fail
// in CI and skip with a warning elsewhere; a non-local URL is refused before
// any connection attempt, in every environment. No database is needed here:
// every URL points at a closed local port or is refused outright.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { UNREACHABLE_WARNING } from "./local-db";
import { CI_UNREACHABLE_TEST, ROOT } from "./scratch-db";

const VITEST = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const FILES = [
  "prisma/price-history-migration.int.test.ts",
  "src/lib/price-history.int.test.ts",
];
const CLOSED_PORT = "postgresql://postgres:postgres@127.0.0.1:1/mox_market";
const out = mkdtempSync(path.join(tmpdir(), "mox-s01-guard-"));

afterAll(() => rmSync(out, { recursive: true, force: true }));

interface JsonReport {
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTotalTests: number;
  testResults: {
    name: string;
    status: string;
    message?: string;
    assertionResults: { title: string; status: string }[];
  }[];
}

let runs = 0;

/** One child Vitest run of FILES; env is the whole child environment. */
function childRun(env: Record<string, string | undefined>) {
  const base: Record<string, string> = {};
  // Only what a process needs to run; no database, CI or Vitest variable
  // leaks in from this run.
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "SHELL", "USER"]) {
    if (process.env[key] !== undefined) base[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) base[key] = value;
  }
  const outputFile = path.join(out, `run-${++runs}.json`);
  const result = spawnSync(
    process.execPath,
    [
      VITEST,
      "run",
      "--project",
      "integration",
      "--reporter=json",
      `--outputFile=${outputFile}`,
      ...FILES,
    ],
    {
      cwd: ROOT,
      env: base as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 55_000,
    },
  );
  let report: JsonReport | null = null;
  try {
    report = JSON.parse(readFileSync(outputFile, "utf8")) as JsonReport;
  } catch {
    report = null;
  }
  const messages = (report?.testResults ?? [])
    .map((r) => r.message ?? "")
    .join("\n");
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}\n${messages}`,
    stderr: result.stderr,
    report,
  };
}

describe("S0.1 integration setup (T12, AC-10)", () => {
  test("(a) CI=true and no reachable database: non-zero exit, the CI failure, and no test passes", () => {
    const run = childRun({
      CI: "true",
      POSTGRES_URL_NON_POOLING: CLOSED_PORT,
      POSTGRES_PRISMA_URL: CLOSED_PORT,
    });
    expect(run.status, run.output).not.toBe(0);
    expect(run.report, run.output).not.toBeNull();
    expect(run.report!.numPassedTests).toBe(0);
    expect(run.report!.numFailedTests).toBe(FILES.length);
    const failed = run
      .report!.testResults.flatMap((r) => r.assertionResults)
      .filter((a) => a.status === "failed")
      .map((a) => a.title);
    expect(failed).toEqual(FILES.map(() => CI_UNREACHABLE_TEST));
  });

  test("(b) CI unset and no reachable database: exit 0, every test skips, with the warning", () => {
    const run = childRun({
      POSTGRES_URL_NON_POOLING: CLOSED_PORT,
      POSTGRES_PRISMA_URL: CLOSED_PORT,
    });
    expect(run.status, run.output).toBe(0);
    expect(run.report!.numPassedTests).toBe(0);
    expect(run.report!.numFailedTests).toBe(0);
    expect(run.report!.numPendingTests).toBe(run.report!.numTotalTests);
    expect(run.report!.numTotalTests).toBeGreaterThan(20);
    expect(run.stderr).toContain(UNREACHABLE_WARNING);
  });

  test.each([
    [
      "a *.supabase.co host",
      "postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres",
      /refusing non-local database host db\.abcdefgh\.supabase\.co/,
    ],
    [
      "a localhost URL with ?host=db.x.supabase.co",
      "postgresql://postgres:pw@localhost:5432/postgres?host=db.x.supabase.co",
      /refusing non-local database host db\.x\.supabase\.co/,
    ],
    [
      "a localhost URL with hostaddr=",
      "postgresql://postgres:pw@localhost:5432/postgres?hostaddr=10.1.2.3",
      /refusing non-local database host 10\.1\.2\.3/,
    ],
  ])(
    "(c) %s: refused before any connection, in CI or not",
    (_name, url, refusal) => {
      for (const ci of ["true", undefined]) {
        const run = childRun({
          CI: ci,
          POSTGRES_URL_NON_POOLING: url,
          POSTGRES_PRISMA_URL: url,
        });
        expect(run.status, run.output).not.toBe(0);
        expect(run.output).toMatch(refusal);
        expect(run.output).not.toContain(UNREACHABLE_WARNING);
        expect(run.report?.numPassedTests ?? 0).toBe(0);
      }
    },
  );

  test("(c) a remote POSTGRES_PRISMA_URL alone is refused too", () => {
    const run = childRun({
      POSTGRES_URL_NON_POOLING: CLOSED_PORT,
      POSTGRES_PRISMA_URL:
        "postgresql://postgres:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    });
    expect(run.status, run.output).not.toBe(0);
    expect(run.output).toMatch(
      /refusing non-local database host aws-0-us-east-1\.pooler\.supabase\.com/,
    );
  });
});
