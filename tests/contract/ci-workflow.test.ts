// T15 (AC-10): the GitHub Actions workflow. Text assertions, no YAML dependency.
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
