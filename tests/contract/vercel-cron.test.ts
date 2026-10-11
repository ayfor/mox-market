// T16 (AC-10; S0.3d17): V1's writer is retired. vercel.json has exactly the
// one daily sync cron, the snapshot route's directory is gone, and nothing in
// src/, vercel.json or README.md names its path; the sync route exists and
// V1's read-only history route stays until the contract step.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const V1_PATH = ["prices", "snapshot"].join("/");

describe("vercel.json crons (T16)", () => {
  const config = JSON.parse(
    readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  ) as Record<string, unknown>;

  test("has exactly one cron: the daily sync at 17:00 UTC", () => {
    expect(config.crons).toEqual([
      { path: "/api/prices/sync-mtgjson", schedule: "0 17 * * *" },
    ]);
  });

  test("no other key mentions a cron", () => {
    const others = Object.entries(config).filter(([key]) => key !== "crons");
    expect(JSON.stringify(others)).not.toMatch(/cron/i);
  });
});

describe("the V1 writer is gone (T16)", () => {
  test("its route directory does not exist", () => {
    expect(
      existsSync(path.join(ROOT, "src", "app", "api", "prices", "snapshot")),
    ).toBe(false);
  });

  test(`nothing in src/, vercel.json or README.md references ${V1_PATH}`, () => {
    let out = "";
    try {
      out = execFileSync(
        "git",
        [
          "grep",
          "--untracked",
          "-n",
          V1_PATH,
          "--",
          "src",
          "vercel.json",
          "README.md",
        ],
        { cwd: ROOT, encoding: "utf8" },
      );
    } catch (error) {
      // git grep exits 1 when nothing matches.
      expect((error as { status?: number }).status).toBe(1);
    }
    expect(out).toBe("");
  });

  test("the sync route exists and V1's read-only history route still does", () => {
    for (const file of [
      "src/app/api/prices/sync-mtgjson/route.ts",
      "src/app/api/prices/history/route.ts",
    ]) {
      expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    }
  });
});
