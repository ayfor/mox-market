// T11 (AC-7, AC-6): report-on-red, end to end. Spawns the real script against
// the red, green and broken fixtures. No database.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "test-report.mjs");
const work = mkdtempSync(path.join(tmpdir(), "mox-report-int-"));

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

// The parent run's VITEST* variables would make the child think it is a
// worker of this run, so they are dropped.
function childEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
  );
}

function runFixture(name: "red" | "green" | "broken") {
  const out = path.join(work, `${name}.md`);
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--config",
      `scripts/__fixtures__/${name}/vitest.config.mts`,
      "--out",
      out,
    ],
    { cwd: ROOT, env: childEnv(), encoding: "utf8", timeout: 50_000 },
  );
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
    report: existsSync(out) ? readFileSync(out, "utf8") : undefined,
  };
}

describe("scripts/test-report.mjs", () => {
  test("red fixture: report written, exit 1, failing test named", () => {
    const { status, report, output } = runFixture("red");
    expect(report, output).toBeDefined();
    expect(status, output).toBe(1);
    expect(report).toContain("# Mox Market — Test Report");
    expect(report).toContain("❌ Failures");
    expect(report).toContain("deliberately red fixture test");
    expect(report).not.toContain("✅ All green");
  });

  test("green fixture: report written, exit 0, all green", () => {
    const { status, report, output } = runFixture("green");
    expect(report, output).toBeDefined();
    expect(status, output).toBe(0);
    expect(report).toContain("✅ All green");
    expect(report).not.toContain("❌");
  });

  test("broken fixture: an import failure is red even with zero assertions", () => {
    const { status, report, output } = runFixture("broken");
    expect(report, output).toBeDefined();
    expect(status, output).toBe(1);
    expect(report).toContain("❌ Failures");
    expect(report).toContain(
      "scripts/__fixtures__/broken/broken.fixture.test.ts",
    );
    expect(report).not.toContain("✅ All green");
  });

  test("no vitest JSON (config not found): a stub report is written and the exit is non-zero", () => {
    const out = path.join(work, "missing.md");
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--config",
        "scripts/__fixtures__/missing/vitest.config.mts",
        "--out",
        out,
      ],
      { cwd: ROOT, env: childEnv(), encoding: "utf8", timeout: 50_000 },
    );
    expect(result.status).not.toBe(0);
    expect(existsSync(out)).toBe(true);
    const stub = readFileSync(out, "utf8");
    expect(stub).toContain("vitest produced no results");
    expect(stub).not.toContain("All green");
  });

  test("an unknown argument exits 2 without running vitest", () => {
    const result = spawnSync(process.execPath, [SCRIPT, "--nope"], {
      cwd: ROOT,
      env: childEnv(),
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown argument: --nope");
  });
});
