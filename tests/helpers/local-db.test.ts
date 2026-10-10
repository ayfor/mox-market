// T21 (AC-11): the host check every integration test shares.
import { describe, expect, test } from "vitest";
import {
  assertLocalDatabaseUrl,
  classifyConnectError,
  LocalDatabaseRejectedError,
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
    // ADV.1: pg connects to ?host= over the URL hostname.
    [
      "a Supabase ?host= behind localhost",
      "postgresql://postgres@localhost:5432/x?host=db.abc.supabase.co",
    ],
    [
      "an upper-case ?HOST=",
      "postgresql://postgres@localhost:5432/x?HOST=db.abc.supabase.co",
    ],
    [
      "a percent-encoded host key",
      "postgresql://postgres@localhost:5432/x?ho%73t=db.abc.supabase.co",
    ],
    [
      "a remote host in a ?host= list",
      "postgresql://postgres@localhost:5432/x?host=localhost,db.abc.supabase.co",
    ],
    [
      "a remote ?hostaddr=",
      "postgresql://postgres@localhost:5432/x?hostaddr=10.0.0.5",
    ],
    [
      "an empty ?host= (pg falls back to PGHOST)",
      "postgresql://postgres@localhost:5432/x?host=",
    ],
    [
      "a remote host in the hostname list",
      "postgresql://postgres@localhost,db.abc.supabase.co:5432/x",
    ],
    ["a URL with no host", "postgresql:///x"],
    ["an unparsable URL", "not a url"],
    ["an empty URL", ""],
    ["no URL", undefined],
  ])("refuses %s", (_label, url) => {
    expect(() => assertLocalDatabaseUrl(url)).toThrow(NonLocalDatabaseError);
  });

  test.each([
    "postgresql://postgres@localhost:5432/x?host=localhost",
    "postgresql://postgres@localhost:5432/x?host=127.0.0.1&sslmode=disable",
    "postgresql://postgres@localhost:5432/x?host=/var/run/postgresql",
    "postgresql://postgres@localhost:5432/x?hostaddr=127.0.0.1",
    "postgresql:///x?host=%2Ftmp",
  ])("accepts the local host parameter in %s", (url) => {
    expect(() => assertLocalDatabaseUrl(url)).not.toThrow();
  });

  test("the refusal names the parameter's host and never echoes credentials", () => {
    let message = "";
    try {
      assertLocalDatabaseUrl(
        "postgresql://user:s3cret@localhost:5432/x?host=db.abc.supabase.co",
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("db.abc.supabase.co");
    expect(message).not.toContain("s3cret");
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
    expect(() =>
      withDatabase(
        "postgresql://u:p@localhost:5432/postgres?host=db.abc.supabase.co",
        "x",
      ),
    ).toThrow(NonLocalDatabaseError);
  });

  test("scratch names are identifier-safe and carry the pid and a timestamp", () => {
    const name = scratchDatabaseName("mox_baseline");
    expect(name).toMatch(/^mox_baseline_\d+_\d+$/);
    expect(() => scratchDatabaseName("bad-prefix; DROP")).toThrow();
  });
});

// ADV.6: only a connection-level failure counts as "unreachable".
describe("classifyConnectError", () => {
  const withCode = (code: string, message = `connect ${code}`) =>
    Object.assign(new Error(message), { code });

  test.each([
    ["ECONNREFUSED", withCode("ECONNREFUSED")],
    ["ETIMEDOUT", withCode("ETIMEDOUT")],
    ["ENOTFOUND", withCode("ENOTFOUND")],
    ["EHOSTUNREACH", withCode("EHOSTUNREACH")],
    [
      "57P03 (starting up)",
      withCode("57P03", "the database system is starting up"),
    ],
    [
      "an AggregateError from dual-stack localhost",
      Object.assign(new AggregateError([withCode("ECONNREFUSED")], ""), {
        code: "ECONNREFUSED",
      }),
    ],
    [
      "macOS's EAGAIN on ::1 beside ECONNREFUSED on 127.0.0.1",
      Object.assign(
        new AggregateError([withCode("EAGAIN"), withCode("ECONNREFUSED")], ""),
        { code: "EAGAIN" },
      ),
    ],
    ["pg's connect timeout", new Error("timeout expired")],
    ["a dropped socket", new Error("Connection terminated unexpectedly")],
  ])("%s is unreachable", (_label, error) => {
    expect(classifyConnectError(error).kind).toBe("unreachable");
  });

  test.each([
    ["28P01", 'password authentication failed for user "postgres"'],
    ["28000", 'role "postgres" does not exist'],
    ["3D000", 'database "mox_market" does not exist'],
  ])("pg code %s is a rejection, not unreachable", (code, message) => {
    expect(classifyConnectError(withCode(code, message))).toEqual({
      kind: "rejected",
      code,
      detail: message,
    });
  });

  test("an AggregateError is a rejection when any attempt was refused by a server", () => {
    const error = Object.assign(
      new AggregateError(
        [
          withCode("ECONNREFUSED"),
          withCode("28P01", "password authentication failed"),
        ],
        "",
      ),
      { code: "ECONNREFUSED" },
    );
    expect(classifyConnectError(error)).toMatchObject({
      kind: "rejected",
      code: "28P01",
    });
  });

  test("an error with no code and no connection message is a rejection", () => {
    expect(
      classifyConnectError(
        new Error("The server does not support SSL connections"),
      ),
    ).toMatchObject({ kind: "rejected", code: "unknown" });
  });

  test.each(["28P01", "28000", "3D000"])(
    "LocalDatabaseRejectedError for %s names the code and .env, not 'unreachable'",
    (code) => {
      const error = new LocalDatabaseRejectedError(code, "detail");
      expect(error.code).toBe(code);
      expect(error.message).toContain(code);
      expect(error.message).toContain(".env");
      expect(error.message).not.toContain("unreachable");
    },
  );
});
