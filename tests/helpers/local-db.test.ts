// T21 (AC-11): the host check every integration test shares.
import { describe, expect, test } from "vitest";
import {
  assertLocalDatabaseUrl,
  NonLocalDatabaseError,
  scratchDatabaseName,
  withDatabase,
} from "./local-db";

describe("assertLocalDatabaseUrl", () => {
  test.each([
    "postgresql://postgres:postgres@localhost:5432/mox_market",
    "postgres://postgres:postgres@127.0.0.1:5432/mox_market",
    "postgresql://postgres@LOCALHOST/mox_market",
  ])("accepts %s", (url) => {
    expect(() => assertLocalDatabaseUrl(url)).not.toThrow();
  });

  test.each([
    [
      "a Supabase direct host",
      "postgresql://u:p@db.abc.supabase.co:5432/postgres",
    ],
    [
      "a Supabase pooler host",
      "postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    ],
    ["a private IP", "postgresql://u:p@10.0.0.5:5432/postgres"],
    [
      "a localhost lookalike",
      "postgresql://u:p@localhost.evil.example:5432/postgres",
    ],
    ["a non-postgres scheme", "mysql://u:p@localhost:3306/x"],
    ["an unparsable URL", "not a url"],
    ["an empty URL", ""],
    ["no URL", undefined],
  ])("refuses %s", (_label, url) => {
    expect(() => assertLocalDatabaseUrl(url)).toThrow(NonLocalDatabaseError);
  });

  test("the refusal never echoes credentials", () => {
    let message = "";
    try {
      assertLocalDatabaseUrl(
        "postgresql://user:s3cret@db.abc.supabase.co:5432/postgres",
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("db.abc.supabase.co");
    expect(message).not.toContain("s3cret");
  });
});

describe("withDatabase and scratchDatabaseName", () => {
  test("swaps only the database name", () => {
    expect(
      withDatabase(
        "postgresql://postgres:postgres@localhost:5432/mox_market?sslmode=disable",
        "x_1",
      ),
    ).toBe("postgresql://postgres:postgres@localhost:5432/x_1?sslmode=disable");
  });

  test("refuses a non-local server", () => {
    expect(() =>
      withDatabase("postgresql://u:p@db.abc.supabase.co:5432/postgres", "x"),
    ).toThrow(NonLocalDatabaseError);
  });

  test("scratch names are identifier-safe and carry the pid and a timestamp", () => {
    const name = scratchDatabaseName("mox_baseline");
    expect(name).toMatch(/^mox_baseline_\d+_\d+$/);
    expect(() => scratchDatabaseName("bad-prefix; DROP")).toThrow();
  });
});
