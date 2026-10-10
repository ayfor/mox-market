// T19 (AC-13): the prod-migrate guard's decision table (S1.1d16).
import { describe, expect, test } from "vitest";
import {
  assertMigrateAllowed,
  hostsOf,
  isLocalHostParam,
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
  test("hostsOf lower-cases, drops a trailing dot and returns null when unparsable", () => {
    expect(hostsOf("postgresql://u:p@DB.X.Supabase.CO.:5432/db")).toEqual({
      hosts: ["db.x.supabase.co"],
      hostParams: [],
      hostaddrs: [],
    });
    expect(hostsOf("nope")).toBeNull();
  });

  test("hostsOf adds every host parameter, keys in any case, values comma-split and decoded", () => {
    expect(
      hostsOf(
        "postgresql://u:p@localhost:5432/x?HOST=A.supabase.co&ho%73t=b.example,C.Example.&hostaddr=10.0.0.5&host=%2Ftmp",
      ),
    ).toEqual({
      hosts: ["localhost", "a.supabase.co", "b.example", "c.example", "/tmp"],
      hostParams: ["a.supabase.co", "b.example", "c.example", "/tmp"],
      hostaddrs: ["10.0.0.5"],
    });
  });

  test("hostsOf keeps empty pieces so callers can fail closed", () => {
    expect(hostsOf("postgresql://u:p@localhost/x?host=")?.hosts).toEqual([
      "localhost",
      "",
    ]);
    expect(hostsOf("postgresql:///x?host=/var/run/postgresql")?.hosts).toEqual([
      "/var/run/postgresql",
    ]);
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

// ADV.1: Prisma's schema engine and pg connect to `?host=` over the hostname.
describe("host query parameters (ADV.1)", () => {
  test.each([
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/postgres?host=db.abc.supabase.co",
    ],
    [
      "migrate reset --force",
      "postgresql://u:p@localhost:5432/postgres?sslmode=disable&host=aws-0-us-east-1.pooler.supabase.com",
    ],
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/postgres?HOST=db.abc.supabase.co",
    ],
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/postgres?ho%73t=db.abc.supabase.co",
    ],
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/postgres?host=localhost,db.abc.supabase.co",
    ],
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/postgres?host=localhost%2Cdb.abc.supabase.co",
    ],
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/postgres?host=db.abc.supabase.co&host=localhost",
    ],
    [
      "migrate deploy",
      "postgresql://u:p@db.abc.supabase.co,localhost/postgres",
    ],
    ["migrate deploy", "postgresql:///postgres?host=db.abc.supabase.co"],
    ["studio", "postgresql://u:p@localhost/x?host=DB.ABC.SUPABASE.CO."],
  ])("`%s` with %s is refused", (cmd, url) => {
    expect(run(cmd, url)).toThrow(/ALLOW_PROD_MIGRATE=1/);
  });

  test("`db push --url=<localhost ?host=pooler>` is refused even with a localhost config URL", () => {
    expect(() =>
      assertMigrateAllowed({
        argv: [
          "db",
          "push",
          "--url=postgresql://u:p@localhost/x?host=aws-0-us-east-1.pooler.supabase.com",
        ],
        url: LOCAL,
        env: {},
      }),
    ).toThrow(MigrateGuardError);
  });

  test("the refusal names the parameter's host, never the URL", () => {
    let error: unknown;
    try {
      assertMigrateAllowed({
        argv: ["migrate", "deploy"],
        url: "postgresql://u:s3cret@localhost:5432/postgres?host=db.abc.supabase.co",
        env: {},
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MigrateGuardError);
    expect((error as MigrateGuardError).host).toBe("db.abc.supabase.co");
    expect((error as Error).message).not.toContain("s3cret");
    expect((error as Error).message).not.toContain("postgresql://");
  });

  // CODEX.1: a host parameter may name only a local target, so the flag no
  // longer unlocks a Supabase host hidden behind `localhost`.
  test("ALLOW_PROD_MIGRATE=1 does not unlock a Supabase host named by ?host=", () => {
    expect(
      run(
        "migrate deploy",
        "postgresql://u:p@localhost:5432/postgres?host=db.abc.supabase.co",
        { ALLOW_PROD_MIGRATE: "1" },
      ),
    ).toThrow(/host query parameter sends it to db\.abc\.supabase\.co/);
  });

  test.each([
    [
      "hostaddr",
      "postgresql://u:p@localhost:5432/postgres?hostaddr=10.0.0.5",
      /hostaddr/,
    ],
    [
      "HOSTADDR",
      "postgresql://u:p@localhost:5432/postgres?HOSTADDR=127.0.0.1",
      /hostaddr/,
    ],
    [
      "an empty host parameter",
      "postgresql://u:p@localhost:5432/postgres?host=",
      /empty/,
    ],
    [
      "a trailing comma in the host list",
      "postgresql://u:p@localhost:5432/postgres?host=localhost,",
      /empty/,
    ],
  ])("%s is refused even with ALLOW_PROD_MIGRATE=1", (_label, url, why) => {
    expect(run("migrate deploy", url)).toThrow(why);
    expect(run("migrate deploy", url, { ALLOW_PROD_MIGRATE: "1" })).toThrow(
      MigrateGuardError,
    );
  });

  test.each([
    "postgresql://u:p@localhost:5432/postgres?host=localhost",
    "postgresql://u:p@localhost:5432/postgres?host=127.0.0.1&sslmode=disable",
    "postgresql://u:p@localhost:5432/postgres?host=/var/run/postgresql",
    "postgresql:///postgres?host=%2Ftmp",
  ])("a local host parameter is allowed: %s", (url) => {
    expect(run("migrate deploy", url)).not.toThrow();
  });

  test("exempt commands are not checked", () => {
    expect(
      run(
        "generate",
        "postgresql://u:p@localhost/x?host=db.abc.supabase.co&hostaddr=1.2.3.4",
      ),
    ).not.toThrow();
  });
});

// CODEX.1 (Codex review on PR #7): a `host` parameter naming a remote host
// that is not Supabase hid the real target behind `localhost`, so writable
// commands reached it without the flag. A host parameter may now name only
// localhost, 127.0.0.1 or a socket directory, flag or not.
describe("host parameters naming a remote host (CODEX.1)", () => {
  const REMOTE = "postgresql://u:s3cret@localhost/db?host=prod.example.com";

  test.each([
    ["migrate reset --force", REMOTE],
    ["db push --force-reset", REMOTE],
    ["migrate deploy", REMOTE],
    ["db execute --file x.sql", REMOTE],
    ["studio", REMOTE],
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/db?HOST=prod.example.com",
    ],
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/db?ho%73t=prod.example.com",
    ],
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/db?host=localhost,prod.example.com",
    ],
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/db?host=localhost%2Cprod.example.com",
    ],
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/db?host=prod.example.com&host=localhost",
    ],
    ["migrate deploy", "postgresql://u:p@localhost:5432/db?host=10.0.0.5"],
    ["migrate deploy", "postgresql://u:p@localhost:5432/db?host=::1"],
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/db?host=localhost.example.com",
    ],
    [
      "migrate deploy",
      "postgresql://u:p@localhost:5432/db?host=127.0.0.1.nip.io",
    ],
    ["migrate deploy", "postgresql:///db?host=prod.example.com"],
    [
      "migrate deploy",
      "postgresql://u:p@prod.example.com:5432/db?host=prod.example.com",
    ],
  ])("`%s` with %s is refused, with or without the flag", (cmd, url) => {
    expect(run(cmd, url)).toThrow(/host query parameter/);
    expect(run(cmd, url, { ALLOW_PROD_MIGRATE: "1" })).toThrow(
      /host query parameter/,
    );
  });

  test("the refusal names the parameter's host and command, never the URL or password", () => {
    let error: unknown;
    try {
      assertMigrateAllowed({
        argv: ["migrate", "reset", "--force"],
        url: REMOTE,
        env: {},
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MigrateGuardError);
    const e = error as MigrateGuardError;
    expect(e.host).toBe("prod.example.com");
    expect(e.command).toBe("migrate reset");
    expect(e.message).toContain("prod.example.com");
    expect(e.message).toContain("migrate reset");
    expect(e.message).not.toContain("s3cret");
    expect(e.message).not.toContain("postgresql://");
  });

  test("a --url value with a remote host parameter is refused under a localhost config URL", () => {
    expect(() =>
      assertMigrateAllowed({
        argv: ["db", "push", `--url=${REMOTE}`],
        url: LOCAL,
        env: { ALLOW_PROD_MIGRATE: "1" },
      }),
    ).toThrow(/host query parameter/);
  });

  test("a shadow URL with a remote host parameter is refused for migrate dev, naming the shadow database", () => {
    expect(() =>
      assertMigrateAllowed({
        argv: ["migrate", "dev"],
        url: LOCAL,
        shadowUrl: "postgresql://u:p@localhost/shadow?host=prod.example.com",
        env: {},
      }),
    ).toThrow(/prod\.example\.com \(its shadow database\)/);
  });

  test("a shadow-free command ignores a remote host parameter on the shadow URL", () => {
    expect(() =>
      assertMigrateAllowed({
        argv: ["migrate", "deploy"],
        url: LOCAL,
        shadowUrl: "postgresql://u:p@localhost/shadow?host=prod.example.com",
        env: {},
      }),
    ).not.toThrow();
  });

  test("exempt commands are still not checked", () => {
    expect(run("generate", REMOTE)).not.toThrow();
    expect(run("validate", REMOTE)).not.toThrow();
  });

  // Scope (AC-13): the guard protects production, which is Supabase. A
  // non-Supabase host the URL shows openly stays outside it; agents are bound
  // by AGENTS.md's hostname check, which prints that host.
  test("a non-Supabase host in the URL itself is outside the guard's scope", () => {
    expect(
      run("migrate deploy", "postgresql://u:p@prod.example.com:5432/db"),
    ).not.toThrow();
  });

  test.each([
    ["localhost", true],
    ["LOCALHOST", true],
    ["127.0.0.1", true],
    ["/var/run/postgresql", true],
    ["/tmp", true],
    ["::1", false],
    ["prod.example.com", false],
    ["localhost.example.com", false],
    ["127.0.0.1.nip.io", false],
    ["", false],
  ])("isLocalHostParam(%j) is %s", (host, expected) => {
    expect(isLocalHostParam(host)).toBe(expected);
  });
});

// ADV.2: commands that open a shadow database check its URL too.
describe("shadow database URL (ADV.2)", () => {
  const shadow =
    (cmd: string, shadowUrl: string | undefined, env = {}) =>
    () =>
      assertMigrateAllowed({ argv: split(cmd), url: LOCAL, shadowUrl, env });

  const USES_SHADOW = [
    "migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma",
    "migrate diff --from-schema prisma/schema.prisma --to-migrations prisma/migrations",
    "migrate diff --from-migrations=prisma/migrations --to-config-datasource",
    "migrate dev",
    "migrate dev --create-only",
    "migrate",
    "migrate frobnicate",
    "mcp",
    "dev",
    "frobnicate",
  ];

  test.each(USES_SHADOW)(
    "`%s` with a Supabase shadow URL is refused",
    (cmd) => {
      expect(shadow(cmd, DIRECT)).toThrow(/its shadow database/);
      expect(shadow(cmd, POOLER)).toThrow(MigrateGuardError);
    },
  );

  test.each(USES_SHADOW)(
    "`%s` with a Supabase shadow URL is allowed with ALLOW_PROD_MIGRATE=1",
    (cmd) => {
      expect(shadow(cmd, DIRECT, { ALLOW_PROD_MIGRATE: "1" })).not.toThrow();
    },
  );

  test.each(USES_SHADOW)(
    "`%s` with a local or unset shadow URL is allowed",
    (cmd) => {
      expect(shadow(cmd, LOOPBACK)).not.toThrow();
      expect(shadow(cmd, undefined)).not.toThrow();
    },
  );

  test.each([
    "migrate deploy",
    "migrate resolve --applied 0000_baseline",
    "migrate status",
    "migrate reset --force",
    "db push",
    "db execute --file x.sql",
    "studio",
    "migrate diff --from-empty --to-schema prisma/schema.prisma --script",
    "migrate diff --from-config-datasource --to-schema prisma/schema.prisma",
  ])(
    "`%s` never opens a shadow database, so its shadow URL is not checked",
    (cmd) => {
      expect(shadow(cmd, DIRECT)).not.toThrow();
    },
  );

  test("a shadow URL with ?host=<supabase> is refused for migrate dev", () => {
    expect(
      shadow(
        "migrate dev",
        "postgresql://u:p@localhost:5432/shadow?host=db.abc.supabase.co",
      ),
    ).toThrow(MigrateGuardError);
  });

  test("an unparsable shadow URL is refused for migrate dev", () => {
    expect(shadow("migrate dev", "not a url")).toThrow(/does not parse/);
  });

  test("`migrate diff --from-migrations` with a Supabase config URL and no shadow URL stays allowed", () => {
    expect(
      run(
        "migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma",
        DIRECT,
      ),
    ).not.toThrow();
  });
});

describe("command labels never carry a flag value", () => {
  test("`db --url <supabase> push` is refused without echoing the URL", () => {
    let message = "";
    try {
      assertMigrateAllowed({
        argv: ["db", "--url", DIRECT, "push"],
        url: LOCAL,
        env: {},
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("migrate guard: refused");
    expect(message).toContain("db (unknown)");
    expect(message).not.toContain("s3cret");
    expect(message).not.toContain("postgresql://");
  });
});
