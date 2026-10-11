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

// T19 (S0.2d3; AC-5): stream-json and stream-chain are runtime
// dependencies (S0.3's sync route parses AllPricesToday), tsx runs the
// ingest script, gzip is node:zlib, and nothing else decompresses.
describe("S0.2 dependencies (T19)", () => {
  test("stream-json ^3 and stream-chain ^4 are dependencies", () => {
    expect(pkg.dependencies["stream-json"]).toMatch(/^\^3\./);
    expect(pkg.dependencies["stream-chain"]).toMatch(/^\^4\./);
    expect(pkg.devDependencies).not.toHaveProperty("stream-json");
  });

  test("tsx is a devDependency", () => {
    expect(pkg.devDependencies.tsx).toMatch(/^\^4\./);
    expect(pkg.dependencies).not.toHaveProperty("tsx");
  });

  test.each([
    "@types/stream-json",
    "xz",
    "lzma-native",
    "lzma",
    "node-xz",
    "pako",
    "fflate",
    "zlib",
    "gunzip-maybe",
    "unzipper",
    "decompress",
  ])("%s is absent", (name) => {
    expect(all).not.toHaveProperty(name);
  });
});
