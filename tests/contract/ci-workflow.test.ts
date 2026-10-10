// T15 (S1.1 AC-10): the GitHub Actions workflow. Text assertions, no YAML
// dependency. S1.3 T12 (AC-4): CI never writes a snapshot.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const ci = readFileSync(
  path.join(ROOT, ".github", "workflows", "ci.yml"),
  "utf8",
);

describe(".github/workflows/ci.yml", () => {
  test("triggers on pull_request", () => {
    expect(ci).toMatch(/^on:\s*\n(?:\s+.*\n)*?\s+pull_request:/m);
  });

  test("declares a postgres:16 service", () => {
    expect(ci).toMatch(
      /services:\s*\n\s+postgres:\s*\n\s+image:\s*postgres:16\s*$/m,
    );
    expect(ci).toMatch(/--health-cmd pg_isready/);
  });

  test.each(["POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"])(
    "%s points at localhost:5432",
    (name) => {
      const line = ci.match(new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, "m"));
      expect(line, `${name} missing`).not.toBeNull();
      expect(line![1]).toMatch(/^postgresql:\/\/[^@]+@localhost:5432\//);
    },
  );

  test("no database URL in the workflow points anywhere but localhost", () => {
    const hosts = [
      ...ci.matchAll(/postgres(?:ql)?:\/\/[^@\s]+@([^:/\s]+)/g),
    ].map((m) => m[1]);
    expect(hosts.length).toBeGreaterThan(0);
    expect(new Set(hosts)).toEqual(new Set(["localhost"]));
  });

  test("runs npm ci, migrate deploy, lint, build and test in that order", () => {
    const steps = [
      "run: npm ci",
      "run: npx prisma migrate deploy",
      "run: npm run lint",
      "run: npm run build",
      "run: npm test",
    ];
    const positions = steps.map((s) => ci.indexOf(s));
    expect(
      positions.every((p) => p >= 0),
      `missing step in ${JSON.stringify(positions)}`,
    ).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test("cancel-in-progress applies only to pull_request runs, never to pushes to main (ADV.8)", () => {
    const block = ci.match(/^concurrency:\s*\n((?:[ \t]+.*\n)+)/m);
    expect(block, "concurrency block missing").not.toBeNull();
    const cancel = block![1].match(/^\s+cancel-in-progress:\s*(.+?)\s*$/m);
    expect(cancel, "cancel-in-progress missing").not.toBeNull();
    expect(cancel![1]).toBe("${{ github.event_name == 'pull_request' }}");
    expect(ci.match(/cancel-in-progress:/g)).toHaveLength(1);
  });

  test("reads Node from .nvmrc and holds read-only permissions", () => {
    expect(ci).toMatch(/node-version-file:\s*\.nvmrc/);
    expect(ci).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
    expect(ci).not.toMatch(/CRON_SECRET|secrets\./);
  });
});

describe("CI never writes snapshots (S1.3 T12, AC-4)", () => {
  // GitHub Actions sets CI, so Vitest neither writes nor updates a snapshot
  // there: a stale or missing snapshot (the params guardrail) fails the run.
  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  const vitestConfig = readFileSync(
    path.join(ROOT, "vitest.config.mts"),
    "utf8",
  );
  const UPDATE_FLAG = /(?:^|\s)(?:-u|--update)(?:[=\s]|$)/;

  test("the update-flag pattern catches -u and --update", () => {
    for (const hit of [
      "vitest run -u",
      "vitest -u run",
      "vitest --update",
      "vitest run --update=all",
    ]) {
      expect(hit).toMatch(UPDATE_FLAG);
    }
    for (const miss of [
      "vitest run",
      "npm test",
      "vitest run --ui-off",
      "vitest --reporter=dot",
    ]) {
      expect(miss).not.toMatch(UPDATE_FLAG);
    }
  });

  test("the workflow's test step is exactly npm test", () => {
    const steps = ci.match(/^\s*-\s*run:\s*npm test\b.*$/gm) ?? [];
    expect(steps).toHaveLength(1);
    expect(steps[0].trim()).toBe("- run: npm test");
    expect(ci).not.toMatch(UPDATE_FLAG);
  });

  test("the workflow never overrides CI", () => {
    expect(ci).not.toMatch(/^\s*CI\s*:/m);
  });

  test("package.json's test script carries no update flag", () => {
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts.test).not.toMatch(UPDATE_FLAG);
  });

  test("vitest.config.mts sets no update option", () => {
    expect(vitestConfig).not.toMatch(/\bupdate\s*:/);
    expect(vitestConfig).not.toMatch(UPDATE_FLAG);
  });

  test("the workflow and package.json never set UPDATE_SNAPSHOT (ADV-1)", () => {
    expect(ci).not.toMatch(/UPDATE_SNAPSHOT/);
    expect(JSON.stringify(pkg)).not.toMatch(/UPDATE_SNAPSHOT/);
  });

  test("vitest.config.mts never loads UPDATE_SNAPSHOT from a .env file and drops it in CI (ADV-1)", () => {
    expect(vitestConfig).toMatch(
      /const SNAPSHOT_UPDATE_VAR = "UPDATE_SNAPSHOT";/,
    );
    expect(vitestConfig).toMatch(
      /if \(key === SNAPSHOT_UPDATE_VAR\) continue;\s*\n\s*if \(process\.env\[key\] === undefined\)/,
    );
    expect(vitestConfig).toMatch(
      /if \(IN_CI\) delete process\.env\[SNAPSHOT_UPDATE_VAR\];/,
    );
    // Only the guard names it: no other line sets or reads it.
    expect(vitestConfig.match(/UPDATE_SNAPSHOT/g)).toHaveLength(1);
  });
});
