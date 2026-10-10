// T8 (AC-5, AC-4, AC-6, AC-8): the toolchain pins.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

describe("toolchain", () => {
  test(".nvmrc pins Node 22", () => {
    expect(readFileSync(path.join(ROOT, ".nvmrc"), "utf8").trim()).toBe("22");
  });

  test("engines.node is ^22.13.0 (S1.1d3)", () => {
    expect(pkg.engines).toEqual({ node: "^22.13.0" });
  });

  test("scripts: test, test:report and lint", () => {
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts["test:report"]).toBe("node scripts/test-report.mjs");
    expect(pkg.scripts.lint).toBe("eslint .");
  });

  test("vitest is pinned exactly to 4.1.11 (C1.49 = A)", () => {
    expect(pkg.devDependencies.vitest).toBe("4.1.11");
  });

  test("eslint 9 and eslint-config-next 16.1.6", () => {
    expect(pkg.devDependencies["eslint-config-next"]).toBe("16.1.6");
    expect(pkg.devDependencies.eslint).toMatch(/^\^9\./);
  });

  test("the lockfile resolves vitest 4.1.11", () => {
    const lock = JSON.parse(
      readFileSync(path.join(ROOT, "package-lock.json"), "utf8"),
    );
    expect(lock.packages["node_modules/vitest"].version).toBe("4.1.11");
  });
});
