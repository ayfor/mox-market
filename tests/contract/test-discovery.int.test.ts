// ADV.4 (AC-4, AC-6): every test file in the repo runs. Vitest collects only
// what a project's include matches, and tsc type-checks only what
// tsconfig.vitest.json includes, so a test file outside either passes silently
// (`npm test` and `npm run test:report` stay green). This walks the tree, asks
// Vitest what it collects (`vitest list --filesOnly --json`) and asks tsc what
// it checks (`--listFilesOnly`), and fails on any gap.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = realpathSync(path.resolve(__dirname, "..", ".."));

/** Any file a test runner could mean as a test, in any extension. */
const TEST_FILE = /\.(test|spec)(-d)?\.[cm]?[jt]sx?$/;

/** Never searched: dependencies, build output, generated code, VCS and tool dirs. */
const SKIP_DIRS = new Set([
  "node_modules",
  "coverage",
  "out",
  "build",
  "src/generated",
  // The report script's own fixtures: red and broken on purpose (T11).
  "scripts/__fixtures__",
]);

const toPosix = (p: string) => p.split(path.sep).join("/");

function testFilesUnder(root: string, dir = ""): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(rel)) return [];
        return testFilesUnder(root, rel);
      }
      return TEST_FILE.test(entry.name) ? [rel] : [];
    },
  );
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("VITEST")) delete env[key];
  return env;
}

function node(root: string, args: string[]) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: childEnv(),
    encoding: "utf8",
    timeout: 50_000,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

/** File (relative, posix) → Vitest project name, for every file Vitest collects. */
function collected(root: string): Map<string, string> {
  const { status, stdout, output } = node(root, [
    path.join(root, "node_modules", "vitest", "vitest.mjs"),
    "list",
    "--filesOnly",
    "--json",
  ]);
  expect(status, output).toBe(0);
  const rows = JSON.parse(stdout) as { file: string; projectName: string }[];
  return new Map(
    rows.map((r) => [toPosix(path.relative(root, r.file)), r.projectName]),
  );
}

/** Every file in tsconfig.vitest.json's program (relative, posix). */
function typeProgram(root: string): Set<string> {
  const { status, stdout, output } = node(root, [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    "tsconfig.vitest.json",
    "--listFilesOnly",
  ]);
  expect(status, output).toBe(0);
  return new Set(
    stdout
      .split("\n")
      .filter(Boolean)
      .map((f) => toPosix(path.relative(root, path.resolve(root, f)))),
  );
}

function gaps(root: string) {
  const files = testFilesUnder(root).sort();
  const vitest = collected(root);
  const program = typeProgram(root);
  return {
    vitest,
    /** On disk, but no Vitest project collects it. */
    uncollected: files.filter((f) => !vitest.has(f)),
    /** Collected as a type test, but tsc never checks it. */
    unchecked: files.filter(
      (f) => /\.test-d\.ts$/.test(f) && vitest.has(f) && !program.has(f),
    ),
  };
}

describe("test discovery", () => {
  test("the matcher recognises every test-file form and nothing else", () => {
    for (const name of [
      "a.test.ts",
      "a.test.tsx",
      "a.int.test.ts",
      "a.test-d.ts",
      "a.spec.ts",
      "a.spec.tsx",
      "a.test.mts",
      "a.test.cts",
      "a.test.js",
      "a.test.mjs",
      "a.spec-d.ts",
    ])
      expect(TEST_FILE.test(name), name).toBe(true);
    for (const name of [
      "test-report.mjs",
      "testing.ts",
      "setup-dom.ts",
      "vitest.config.mts",
      "a.test.ts.snap",
    ])
      expect(TEST_FILE.test(name), name).toBe(false);
  });

  test("every test file in the repo is collected by a Vitest project, and every type test is type-checked", () => {
    const { vitest, uncollected, unchecked } = gaps(ROOT);
    expect(vitest.size).toBeGreaterThan(0);
    expect(
      uncollected,
      "no Vitest project collects these: name them *.test.ts, *.test.tsx, *.int.test.ts or *.test-d.ts under src, prisma, scripts or tests",
    ).toEqual([]);
    expect(
      unchecked,
      "tsconfig.vitest.json does not include these type tests, so tsc never checks them",
    ).toEqual([]);
  });

  test("each file runs in the project its name implies", () => {
    for (const [file, project] of collected(ROOT)) {
      const expected = /\.int\.test\.ts$/.test(file)
        ? "integration"
        : /\.test\.tsx$/.test(file)
          ? "component"
          : "unit";
      expect(project, file).toBe(expected);
    }
  });

  // A throwaway copy of the test config with probe files at paths no test
  // uses today: proves the includes reach every root and that a stray name
  // or location is reported, and that a failing probe turns the run red.
  test("probe files: tests/ and prisma/ are collected, strays are reported, and failures go red", () => {
    // realpath: macOS tmpdir is a symlink, and tsc and Vitest print real paths.
    const dir = realpathSync(
      mkdtempSync(path.join(tmpdir(), "mox-discovery-")),
    );
    try {
      for (const file of [
        "vitest.config.mts",
        "tsconfig.json",
        "tsconfig.vitest.json",
        "src/test/setup-dom.ts",
      ]) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        copyFileSync(path.join(ROOT, file), path.join(dir, file));
      }
      symlinkSync(
        path.join(ROOT, "node_modules"),
        path.join(dir, "node_modules"),
        "dir",
      );
      const probes: Record<string, string> = {
        "tests/contract/probe.test.tsx": [
          'import { expect, test } from "vitest";',
          'test("component probe", () => { expect(typeof document).toBe("undefined"); });',
        ].join("\n"),
        "prisma/probe.test-d.ts": [
          'import { expectTypeOf, test } from "vitest";',
          'test("type probe", () => { expectTypeOf<string>().toEqualTypeOf<number>(); });',
        ].join("\n"),
        "scripts/probe.int.test.ts": [
          'import { expect, test } from "vitest";',
          'test("integration probe", () => { expect(1).toBe(1); });',
        ].join("\n"),
        "docs/probe.test.ts":
          'import { test } from "vitest"; test("stray", () => {});',
        "src/probe.spec.ts":
          'import { test } from "vitest"; test("stray", () => {});',
        "tests/probe.test.mts":
          'import { test } from "vitest"; test("stray", () => {});',
      };
      for (const [file, body] of Object.entries(probes)) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), `${body}\n`);
      }

      const { vitest, uncollected, unchecked } = gaps(dir);
      expect(Object.fromEntries(vitest)).toEqual({
        "tests/contract/probe.test.tsx": "component",
        "prisma/probe.test-d.ts": "unit",
        "scripts/probe.int.test.ts": "integration",
      });
      expect(uncollected).toEqual([
        "docs/probe.test.ts",
        "src/probe.spec.ts",
        "tests/probe.test.mts",
      ]);
      expect(unchecked).toEqual([]);

      // The failing component probe (jsdom has a document) and the failing
      // type probe both make the run red.
      const run = node(dir, [
        path.join(dir, "node_modules", "vitest", "vitest.mjs"),
        "run",
      ]);
      const output = run.output.replace(/\x1b\[[0-9;]*m/g, "");
      expect(run.status, output).not.toBe(0);
      expect(output).toMatch(
        /FAIL\s+\|component\|\s+tests\/contract\/probe\.test\.tsx > component probe/,
      );
      expect(output).toMatch(
        /FAIL\s+\|unit\|\s+prisma\/probe\.test-d\.ts > type probe/,
      );
      expect(output).toMatch(/Type Errors\s+1 failed/);
      expect(output).toMatch(/Test Files\s+2 failed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
