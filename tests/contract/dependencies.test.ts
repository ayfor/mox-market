// T27 (story Description, C1.51): the V1 residue is gone; Headless UI stays.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const all = { ...pkg.dependencies, ...pkg.devDependencies };

describe("V1 residue", () => {
  test.each(["recharts", "zustand", "@vercel/postgres"])(
    "package.json has no %s",
    (name) => {
      expect(all).not.toHaveProperty(name);
    },
  );

  test.each([
    "src/lib/currency.ts",
    "src/lib/card-cache.ts",
    "src/store/watchlist.ts",
  ])("%s is gone", (file) => {
    expect(existsSync(path.join(ROOT, file))).toBe(false);
  });

  test("@headlessui/react stays (C1.30's CardCombobox)", () => {
    expect(pkg.dependencies).toHaveProperty("@headlessui/react");
  });
});
