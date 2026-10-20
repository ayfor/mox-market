// T1 (S0.2d2; AC-1 to AC-11, the contract S0.3 imports): F0's ops constants
// at exactly F0's values, none of them borrowed from RECOMMENDATION_PARAMS,
// and PARAMS_VERSION unmoved.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { PARAMS_VERSION } from "../recommendation/params";
import * as consts from "./consts";

const F0_CONSTANTS = {
  MTGJSON_BASE_URL: "https://mtgjson.com/api/v5/",
  MTGJSON_SCHEMA_MAJOR: "5.",
  HISTORY_WINDOW_DAYS: 30,
  GATE_MAX_EDHREC_RANK: 5000,
  GATE_MIN_PRICE_CENTS: 100,
  UPSERT_CHUNK_ROWS: 5000,
  DB_FREE_TIER_BYTES: 500_000_000,
  DB_WARN_BYTES: 400_000_000,
  DB_STOP_BYTES: 450_000_000,
  BULK_MIN_FREE_BYTES: 340_000_000,
  STALE_RUN_MS: 3_600_000,
};

describe("F0 ops constants (T1)", () => {
  test.each(Object.entries(F0_CONSTANTS))("%s is F0's value", (name, value) => {
    expect((consts as Record<string, unknown>)[name]).toStrictEqual(value);
  });

  test("BUDGET_RECHECK_CHUNKS is F0's 'every 50 chunks'", () => {
    expect(consts.BUDGET_RECHECK_CHUNKS).toBe(50);
  });

  test("the four file names are MTGJson's", () => {
    expect([
      consts.META_FILE,
      consts.ALL_IDENTIFIERS_FILE,
      consts.ALL_PRICES_FILE,
      consts.ALL_PRICES_TODAY_FILE,
    ]).toEqual([
      "Meta.json",
      "AllIdentifiers.json.gz",
      "AllPrices.json.gz",
      "AllPricesToday.json.gz",
    ]);
  });

  test("the report's per-row projections are positive integers", () => {
    for (const value of [
      consts.PROJECTED_BYTES_PER_PRICE_ROW,
      consts.PROJECTED_BYTES_PER_IDENTIFIER_ROW,
    ]) {
      expect(Number.isSafeInteger(value) && value > 0).toBe(true);
    }
  });

  test("nothing in src/lib/mtgjson imports RECOMMENDATION_PARAMS", () => {
    const dir = path.resolve(__dirname);
    for (const file of [
      "consts.ts",
      "transform.ts",
      "store.ts",
      "ingest.ts",
      "parse.ts",
      "source.ts",
      "target.ts",
      "db.ts",
      "report.ts",
      "basis.ts",
    ]) {
      const text = readFileSync(path.join(dir, file), "utf8");
      const imports =
        text.match(/^import[\s\S]*?from\s+["'][^"']+["'];?$/gm) ?? [];
      for (const statement of imports) {
        expect(statement, file).not.toMatch(
          /RECOMMENDATION_PARAMS|recommendation\/params/,
        );
      }
    }
  });

  // S3.1 moved the pin from 46ec1cd7 (S3.1d4: TIER2_ENABLED and two F3
  // params); F0's constants still never join RECOMMENDATION_PARAMS.
  test("PARAMS_VERSION is unchanged by F0 (S3.1's pin)", () => {
    expect(PARAMS_VERSION).toBe("208c90c2");
  });
});
