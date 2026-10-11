// T12 (AC-3, AC-9; S0.3d5): prismaDb adapts a Prisma client to S0.2's Db.
// Row-returning statements go through $queryRawUnsafe, the rest through
// $executeRawUnsafe, values spread as positional parameters; every SQL text
// the sync sends is classified as expected; no SQL literal in the writer's
// modules interpolates anything.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test, vi } from "vitest";
import { fixtureFiles, STANDARD_IDENTIFIERS } from "./__fixtures__/build";
import { FakeDb } from "./__fixtures__/fake-db";
import { prismaDb, returnsRows, type RawSqlClient } from "./prisma-db";
import { createFixtureSource } from "./source";
import {
  LOAD_IDENTIFIERS_SQL,
  MARK_STALE_RUNS_SQL,
  PRUNE_SQL,
  SET_RUN_SOURCE_SQL,
  UPSERT_PRICES_SQL,
} from "./store";
import { runDailySync } from "./sync";

function fakeClient(rows: unknown = [], count = 0) {
  const client = {
    $queryRawUnsafe: vi.fn(async () => rows),
    $executeRawUnsafe: vi.fn(async () => count),
  };
  return client satisfies RawSqlClient;
}

describe("prismaDb (T12)", () => {
  test.each([
    ['SELECT pg_database_size(current_database())::text AS "bytes"'],
    ["  \n SELECT 1"],
    ["select 1"],
    ["WITH x AS (SELECT 1) SELECT * FROM x"],
    [`INSERT INTO "price_sync_runs" ("trigger") VALUES ($1) RETURNING "id"`],
  ])(
    "%s goes through $queryRawUnsafe; rowCount is the rows' length",
    async (text) => {
      const client = fakeClient([{ id: 1 }, { id: 2 }]);
      const result = await prismaDb(client).query(text, ["a", 2]);
      expect(client.$queryRawUnsafe).toHaveBeenCalledWith(text, "a", 2);
      expect(client.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(result).toEqual({ rowCount: 2, rows: [{ id: 1 }, { id: 2 }] });
    },
  );

  test.each([
    [UPSERT_PRICES_SQL],
    [PRUNE_SQL],
    [MARK_STALE_RUNS_SQL],
    [SET_RUN_SOURCE_SQL],
    [`UPDATE "x" SET "y" = $1`],
  ])(
    "%s goes through $executeRawUnsafe; rowCount is its count, rows empty",
    async (text) => {
      const client = fakeClient([], 7);
      const ids = ["u1", "u2"];
      const result = await prismaDb(client).query(text, [ids, null, 3]);
      expect(client.$executeRawUnsafe).toHaveBeenCalledWith(text, ids, null, 3);
      expect(client.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(result).toEqual({ rowCount: 7, rows: [] });
    },
  );

  test("no values → no extra arguments", async () => {
    const client = fakeClient([]);
    await prismaDb(client).query(LOAD_IDENTIFIERS_SQL);
    expect(client.$queryRawUnsafe).toHaveBeenCalledWith(LOAD_IDENTIFIERS_SQL);
  });

  test("a non-array answer from $queryRawUnsafe reads as no rows", async () => {
    const client = fakeClient(null);
    await expect(prismaDb(client).query("SELECT 1")).resolves.toEqual({
      rowCount: 0,
      rows: [],
    });
  });

  test("a rejected call rejects unchanged", async () => {
    const error = new Error("P2010 raw query failed");
    const query = {
      $queryRawUnsafe: vi.fn(() => Promise.reject(error)),
      $executeRawUnsafe: vi.fn(() => Promise.reject(error)),
    };
    await expect(prismaDb(query).query("SELECT 1")).rejects.toBe(error);
    await expect(prismaDb(query).query(PRUNE_SQL, [])).rejects.toBe(error);
  });

  test("every statement a full sync sends is classified as expected", async () => {
    const db = new FakeDb({ identifiers: STANDARD_IDENTIFIERS });
    const result = await runDailySync({
      db,
      source: createFixtureSource(fixtureFiles()),
      now: () => new Date("2026-10-05T17:00:00.000Z"),
      log: { warn: () => undefined, error: () => undefined },
    });
    expect(result.status).toBe("ok");
    const texts = [...new Set(db.statements.map((s) => s.text))];
    const rowsExpected = texts.filter(
      (t) =>
        /^SELECT/.test(t) ||
        /^INSERT INTO "price_sync_runs"[\s\S]*RETURNING/.test(t),
    );
    expect(rowsExpected).toHaveLength(3); // size, identifiers, run insert
    for (const text of texts) {
      expect(returnsRows(text), text).toBe(rowsExpected.includes(text));
    }
    expect(texts).toEqual(
      expect.arrayContaining([
        MARK_STALE_RUNS_SQL,
        SET_RUN_SOURCE_SQL,
        LOAD_IDENTIFIERS_SQL,
        UPSERT_PRICES_SQL,
        PRUNE_SQL,
      ]),
    );
  });
});

/** Template literals with a substitution whose text reads as SQL. */
function interpolatedSqlIn(text: string): string[] {
  const source = ts.createSourceFile(
    "x.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const SQL =
    /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|WHERE|SET|VALUES|ON CONFLICT)\b/;
  const visit = (node: ts.Node) => {
    if (ts.isTemplateExpression(node) && SQL.test(node.getText(source))) {
      found.push(node.getText(source).slice(0, 80));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("no interpolated SQL (T12)", () => {
  test.each(["store.ts", "sync.ts", "prisma-db.ts", "sync-handler.ts"])(
    "%s has no ${ inside any SQL literal",
    (name) => {
      const text = readFileSync(path.join(__dirname, name), "utf8");
      expect(interpolatedSqlIn(text)).toEqual([]);
    },
  );

  test("the scan flags an interpolated SQL literal, and passes a constant one and a plain message", () => {
    expect(
      interpolatedSqlIn(
        'const id = 1; const q = `DELETE FROM "t" WHERE "id" = ${id}`;',
      ),
    ).toHaveLength(1);
    expect(
      interpolatedSqlIn('const q = `DELETE FROM "t" WHERE "id" = $1`;'),
    ).toEqual([]);
    expect(
      interpolatedSqlIn("const n = 1; const m = `wrote ${n} rows`;"),
    ).toEqual([]);
  });
});
