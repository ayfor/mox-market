// T19 (AC-13): the prod-migrate guard's decision table (S1.1d16).
import { describe, expect, test } from "vitest";
import {
  assertMigrateAllowed,
  hostOf,
  isSupabaseHost,
  MigrateGuardError,
} from "./migrate-guard";

const DIRECT =
  "postgresql://postgres:s3cret@db.abcdefgh.supabase.co:5432/postgres";
const POOLER =
  "postgresql://postgres.abc:s3cret@aws-0-us-east-1.pooler.supabase.com:5432/postgres";
const LOCAL = "postgresql://postgres:postgres@localhost:5432/mox_market";
const LOOPBACK = "postgresql://postgres:postgres@127.0.0.1:5432/mox_market";

const split = (cmd: string) => cmd.split(" ").filter(Boolean);
const run =
  (
    cmd: string,
    url: string | undefined,
    env: Record<string, string | undefined> = {},
  ) =>
  () =>
    assertMigrateAllowed({ argv: split(cmd), url, env });

const GUARDED = [
  "migrate deploy",
  "migrate dev",
  "migrate reset --force",
  "migrate resolve --applied 0000_baseline",
  "migrate status",
  "migrate diff --from-config-datasource --to-schema prisma/schema.prisma",
  "migrate diff --from-schema prisma/schema.prisma --to-config-datasource --script",
  "migrate diff --from-config-datasource=true --to-schema prisma/schema.prisma",
  "migrate frobnicate",
  "migrate",
  "db push",
  "db execute --file x.sql",
  "db pull",
  "db seed",
  "db frobnicate",
  "studio",
  "dev",
  "mcp",
  "init",
  "frobnicate",
  "migrate deploy --help",
  "migrate deploy -v",
];

const EXEMPT = [
  "generate",
  "validate",
  "format",
  "version",
  "debug",
  "-v",
  "--version",
  "-h",
  "--help",
  "",
  "migrate diff --from-empty --to-schema prisma/schema.prisma --script",
  "migrate diff --from-schema a.prisma --to-schema b.prisma",
  "migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma",
];

describe("guarded commands against Supabase hosts", () => {
  describe.each([
    ["direct host", DIRECT],
    ["pooler host", POOLER],
  ])("%s", (_label, url) => {
    test.each(GUARDED)("refuses `%s` without the flag", (cmd) => {
      expect(run(cmd, url)).toThrow(MigrateGuardError);
    });

    test.each(GUARDED)("allows `%s` with ALLOW_PROD_MIGRATE=1", (cmd) => {
      expect(run(cmd, url, { ALLOW_PROD_MIGRATE: "1" })).not.toThrow();
    });

    test.each(["true", "yes", "0", "", " 1", "1 ", "01", "TRUE"])(
      "ALLOW_PROD_MIGRATE=%j does not unlock it",
      (value) => {
        expect(
          run("migrate deploy", url, { ALLOW_PROD_MIGRATE: value }),
        ).toThrow(MigrateGuardError);
      },
    );
  });

  test("the message names the host, the command and ALLOW_PROD_MIGRATE=1, never the URL or password", () => {
    let error: unknown;
    try {
      assertMigrateAllowed({
        argv: ["migrate", "resolve", "--applied", "0000_baseline"],
        url: DIRECT,
        env: {},
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MigrateGuardError);
    const e = error as MigrateGuardError;
    expect(e.name).toBe("MigrateGuardError");
    expect(e.message).toContain("db.abcdefgh.supabase.co");
    expect(e.message).toContain("migrate resolve");
    expect(e.message).toContain("ALLOW_PROD_MIGRATE=1");
    expect(e.message).not.toContain("s3cret");
    expect(e.message).not.toContain("postgresql://");
    expect(e.message).not.toContain("0000_baseline");
    expect(e.host).toBe("db.abcdefgh.supabase.co");
    expect(e.command).toBe("migrate resolve");
  });

  test.each([
    ["upper case", "postgresql://u:p@DB.ABC.SUPABASE.CO:5432/postgres"],
    [
      "mixed-case pooler",
      "postgresql://u:p@AWS-0-us-east-1.Pooler.Supabase.Com/postgres",
    ],
    ["no port", "postgresql://u:p@db.abc.supabase.co/postgres"],
    [
      "a query string",
      "postgresql://u:p@db.abc.supabase.co:5432/postgres?sslmode=require&pgbouncer=true",
    ],
    [
      "a trailing-dot FQDN",
      "postgresql://u:p@db.abc.supabase.co.:5432/postgres",
    ],
    [
      "the postgres:// scheme",
      "postgres://u:p@db.abc.supabase.co:6543/postgres",
    ],
  ])("matches a Supabase host with %s", (_label, url) => {
    expect(run("migrate deploy", url)).toThrow(MigrateGuardError);
  });
});

describe("exempt commands never connect", () => {
  test.each(EXEMPT)("allows `%s` against a Supabase host", (cmd) => {
    expect(run(cmd, DIRECT)).not.toThrow();
    expect(run(cmd, POOLER)).not.toThrow();
  });
});

describe("local and absent URLs", () => {
  test.each(GUARDED)("allows `%s` against localhost and 127.0.0.1", (cmd) => {
    expect(run(cmd, LOCAL)).not.toThrow();
    expect(run(cmd, LOOPBACK)).not.toThrow();
  });

  test.each(["migrate deploy", "db push", "studio"])(
    "allows `%s` when no URL is set",
    (cmd) => {
      expect(run(cmd, undefined)).not.toThrow();
      expect(run(cmd, "")).not.toThrow();
    },
  );
});

describe("lookalikes and unparsable URLs", () => {
  test.each([
    "postgresql://u:p@supabase.co.example.com:5432/postgres",
    "postgresql://u:p@notsupabase.co:5432/postgres",
    "postgresql://u:p@db.abc.supabase.com:5432/postgres",
    "postgresql://u:p@pooler.supabase.com.evil.example:5432/postgres",
  ])("does not match the lookalike %s", (url) => {
    expect(run("migrate deploy", url)).not.toThrow();
  });

  test.each([
    "not a url",
    "postgresql://u:p@:5432/x",
    "db.abc.supabase.co:5432",
  ])(
    "refuses a guarded command whose URL %j does not parse to a host",
    (url) => {
      expect(run("migrate deploy", url)).toThrow(MigrateGuardError);
    },
  );

  test("an unparsable URL on an exempt command is allowed", () => {
    expect(run("generate", "not a url")).not.toThrow();
  });
});

describe("--url overrides the config URL (C3.1)", () => {
  test("with a localhost config URL, `migrate dev --url=<supabase>` is refused", () => {
    expect(() =>
      assertMigrateAllowed({
        argv: [
          "migrate",
          "dev",
          "--url=postgresql://u:p@db.abc.supabase.co:5432/postgres",
        ],
        url: LOCAL,
        env: {},
      }),
    ).toThrow(MigrateGuardError);
  });

  test("with a localhost config URL, `db push --url <pooler>` is refused", () => {
    expect(() =>
      assertMigrateAllowed({
        argv: [
          "db",
          "push",
          "--url",
          "postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
        ],
        url: LOCAL,
        env: {},
      }),
    ).toThrow(MigrateGuardError);
  });

  test("with a Supabase config URL, `studio` and `db seed` are refused", () => {
    expect(run("studio", DIRECT)).toThrow(MigrateGuardError);
    expect(run("db seed", DIRECT)).toThrow(MigrateGuardError);
  });

  test("with a Supabase config URL, `studio --url <localhost>` is allowed", () => {
    expect(() =>
      assertMigrateAllowed({
        argv: ["studio", "--url", "postgresql://postgres@localhost:5432/x"],
        url: DIRECT,
        env: {},
      }),
    ).not.toThrow();
  });

  test("every --url value is checked, not just the first", () => {
    expect(() =>
      assertMigrateAllowed({
        argv: ["db", "push", "--url", LOCAL, "--url=" + POOLER],
        url: LOCAL,
        env: {},
      }),
    ).toThrow(MigrateGuardError);
  });

  test.each([
    ["at the end of argv", ["db", "push", "--url"]],
    ["followed by another flag", ["db", "push", "--url", "--force-reset"]],
    ["with an empty inline value", ["db", "push", "--url="]],
  ])("a --url %s with no value is refused", (_label, argv) => {
    expect(() => assertMigrateAllowed({ argv, url: LOCAL, env: {} })).toThrow(
      MigrateGuardError,
    );
  });

  test("--url with ALLOW_PROD_MIGRATE=1 is allowed", () => {
    expect(() =>
      assertMigrateAllowed({
        argv: ["db", "pull", "--url", DIRECT],
        url: LOCAL,
        env: { ALLOW_PROD_MIGRATE: "1" },
      }),
    ).not.toThrow();
  });
});

describe("host helpers", () => {
  test("hostOf lower-cases, drops a trailing dot and returns null when unparsable", () => {
    expect(hostOf("postgresql://u:p@DB.X.Supabase.CO.:5432/db")).toBe(
      "db.x.supabase.co",
    );
    expect(hostOf("nope")).toBeNull();
  });

  test.each([
    ["db.abc.supabase.co", true],
    ["aws-0-us-east-1.pooler.supabase.com", true],
    ["supabase.co", true],
    ["supabase.co.example.com", false],
    ["db.abc.supabase.com", false],
    ["localhost", false],
  ])("isSupabaseHost(%s) is %s", (host, expected) => {
    expect(isSupabaseHost(host)).toBe(expected);
  });
});
