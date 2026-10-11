// sanitizeErrorMessage (S0.2d14; ADV.13): every line the CLI prints and every
// run-row error passes through it, so a connection string pasted in the
// wrong place never reaches a terminal or the database in full. Pure.
import { describe, expect, test, vi } from "vitest";
import { STANDARD_IDENTIFIERS } from "./__fixtures__/build";
import { FakeDb } from "./__fixtures__/fake-db";
import { STALE_RUN_MS } from "./consts";
import {
  LOAD_IDENTIFIERS_SQL,
  loadIdentifierIndex,
  MARK_STALE_RUNS_SQL,
  markStaleRuns,
  RUN_ERROR_MAX_CHARS,
  sanitizeErrorMessage,
  SET_RUN_SOURCE_SQL,
  setRunSource,
  SOURCE_VERSION_MAX_CHARS,
  STALE_RUN_MESSAGE,
} from "./store";
import { IdentifierIndex } from "./transform";

describe("sanitizeErrorMessage (ADV.13)", () => {
  test.each([
    ["Unexpected argument 'postgresql://u:pw-XYZZY@db.example.invalid/db'"],
    // path.resolve collapses the scheme's double slash.
    ["Meta.json is missing from /Users/x/postgresql:/u:pw-XYZZY@h/db"],
    ["connect failed for u:pw-XYZZY@h:5432/db"],
    ["dial postgres://u:pw-XYZZY@h:5432/db?sslmode=require now"],
    ["mixed postgresql:///u:pw-XYZZY@h/db and u:pw-XYZZY@h"],
  ])("redacts the credentials in %s", (text) => {
    const clean = sanitizeErrorMessage(text);
    expect(clean).not.toContain("pw-XYZZY");
    expect(clean).toContain("[redacted url]");
  });

  test.each([
    "SourceFormatError: AllPrices.json.gz: malformed JSON (Unexpected token at 12:30)",
    "Error: unexpected end of file",
    "contact josh@example.com",
  ])("leaves ordinary text alone: %s", (text) => {
    expect(sanitizeErrorMessage(text)).toBe(text);
  });

  test("cuts to RUN_ERROR_MAX_CHARS after redacting", () => {
    expect(sanitizeErrorMessage("x".repeat(5_000))).toHaveLength(
      RUN_ERROR_MAX_CHARS,
    );
  });
});

// T11 (S0.3d9, S0.3d10; AC-3, AC-8, AC-9): the daily sync's three store
// functions send constant SQL with every value as a parameter.
describe("the daily sync's store functions (T11)", () => {
  test("markStaleRuns sends MARK_STALE_RUNS_SQL with STALE_RUN_MS and the fixed message, and returns the count", async () => {
    const db = new FakeDb({ staleRuns: 3 });
    await expect(markStaleRuns(db)).resolves.toBe(3);
    expect(db.statements).toEqual([
      {
        text: MARK_STALE_RUNS_SQL,
        values: [STALE_RUN_MS, STALE_RUN_MESSAGE],
      },
    ]);
    expect(STALE_RUN_MESSAGE).toBe("abandoned: still running after 1 hour");
    expect(MARK_STALE_RUNS_SQL).toMatch(/"status" = 'running'/);
    expect(MARK_STALE_RUNS_SQL).toMatch(
      /"started_at" < now\(\) - \(\$1::int8 \* interval '1 millisecond'\)/,
    );
    // Any trigger: no trigger filter.
    expect(MARK_STALE_RUNS_SQL).not.toMatch(/"trigger"/);
  });

  test("markStaleRuns passes an injected age as a parameter, never in the text", async () => {
    const db = new FakeDb();
    await markStaleRuns(db, 1234);
    expect(db.statements[0].values[0]).toBe(1234);
    expect(db.statements[0].text).not.toContain("1234");
  });

  test.each([
    [
      "a calendar date and a version",
      { date: "2026-10-05", version: "5.3.0+20261005" },
      [7, "2026-10-05", "5.3.0+20261005"],
    ],
    [
      "a non-calendar date (sent as null)",
      { date: "2026-02-30", version: "5.3.0" },
      [7, null, "5.3.0"],
    ],
    [
      "another format (sent as null)",
      { date: "10/05/2026", version: null },
      [7, null, null],
    ],
    [
      "a long version (cut to 100 characters)",
      { date: null, version: "5.".padEnd(250, "x") },
      [7, null, "5.".padEnd(250, "x").slice(0, SOURCE_VERSION_MAX_CHARS)],
    ],
  ])("setRunSource with %s", async (_label, source, values) => {
    const db = new FakeDb();
    await setRunSource(db, 7, source);
    expect(db.statements).toEqual([{ text: SET_RUN_SOURCE_SQL, values }]);
    expect(SOURCE_VERSION_MAX_CHARS).toBe(100);
  });

  test("no value ever appears in the three statements' text", () => {
    for (const text of [
      MARK_STALE_RUNS_SQL,
      SET_RUN_SOURCE_SQL,
      LOAD_IDENTIFIERS_SQL,
    ]) {
      expect(text).not.toMatch(/\$\{/);
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
    expect(SET_RUN_SOURCE_SQL).toMatch(/\$1::int4/);
    expect(SET_RUN_SOURCE_SQL).toMatch(/\$2::date/);
    expect(SET_RUN_SOURCE_SQL).toMatch(/\$3::text/);
  });

  test("loadIdentifierIndex feeds every row to IdentifierIndex.add, counting invalid rows instead of throwing", async () => {
    const valid = STANDARD_IDENTIFIERS;
    const db = new FakeDb({
      identifiers: [
        ...valid,
        // A row the index refuses (not a UUID): counted, not thrown.
        {
          mtgjsonUuid: "not-a-uuid",
          scryfallId: "20000000-0000-4000-8000-000000000001",
          side: null,
          edhrecRank: null,
        },
      ],
    });
    const add = vi.spyOn(IdentifierIndex.prototype, "add");
    const index = await loadIdentifierIndex(db);
    expect(db.statements).toEqual([{ text: LOAD_IDENTIFIERS_SQL, values: [] }]);
    expect(add).toHaveBeenCalledTimes(valid.length + 1);
    expect(index.size).toBe(valid.length);
    expect(index.stats.invalidIdentifiers).toBe(1);
    // The preferred face for a shared Scryfall id is side a (C2-A.6).
    const faceA = index.get(
      STANDARD_IDENTIFIERS.find((r) => r.side === "a")!.mtgjsonUuid,
    )!;
    expect(index.isPreferred(faceA)).toBe(true);
    add.mockRestore();
  });

  test("loadIdentifierIndex lower-cases the UUIDs it reads", async () => {
    const row = STANDARD_IDENTIFIERS[0];
    const db = new FakeDb({
      identifiers: [
        {
          ...row,
          mtgjsonUuid: row.mtgjsonUuid.toUpperCase(),
          scryfallId: row.scryfallId.toUpperCase(),
        },
      ],
    });
    const index = await loadIdentifierIndex(db);
    expect(index.get(row.mtgjsonUuid)?.scryfallId).toBe(row.scryfallId);
  });
});
