// T10 (AC-9; S0.2d16, S0.2d18, S0.2d24): the target guard and the argument
// parser, pure. argv and env go in as values; no process environment is set,
// nothing connects, and the production branch is proven with inputs only.
import { describe, expect, test } from "vitest";
import {
  FLAGS,
  IngestRefusedError,
  parseCliArgs,
  resolveTarget,
  targetLine,
  usage,
  UsageError,
} from "./target";

const PEM =
  "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----";
const write = { dryRun: false, production: false };
const prod = { dryRun: false, production: true };
const url = (host: string, extra = "") =>
  `postgresql://postgres:s3cr3t-pw@${host}:5432/postgres${extra}`;

/** The refusal message, or "allowed: <kind>". */
function outcome(
  options: { dryRun: boolean; production: boolean },
  env: Record<string, string | undefined>,
  allow?: string,
): string {
  try {
    return `allowed: ${resolveTarget(options, env, allow).kind}`;
  } catch (error) {
    expect(error).toBeInstanceOf(IngestRefusedError);
    const message = (error as Error).message;
    expect(message).not.toContain("s3cr3t-pw");
    expect(message).not.toMatch(/postgres:s3cr3t/);
    return message;
  }
}

describe("path B: local hosts (T10)", () => {
  test.each(["localhost", "127.0.0.1"])("%s → local", (host) => {
    const target = resolveTarget(
      write,
      { POSTGRES_URL_NON_POOLING: url(host) },
      undefined,
    );
    expect(target.kind).toBe("local");
    expect(targetLine(target)).toBe(
      `target database: ${host}:5432/postgres (local)`,
    );
  });

  // ADV.14: pg dials the raw string, so a local host the guard would
  // normalize is refused rather than printed as something it is not.
  test.each(["LOCALHOST", "localhost.", "Localhost", "127.0.0.1."])(
    "%s is refused: a local host must be written exactly",
    (host) => {
      expect(outcome(write, { POSTGRES_URL_NON_POOLING: url(host) })).toMatch(
        /write a local host exactly as localhost or 127\.0\.0\.1/,
      );
      expect(
        outcome(
          prod,
          { POSTGRES_URL_NON_POOLING: url(host), POSTGRES_SSL_ROOT_CERT: PEM },
          "1",
        ),
      ).toMatch(/write a local host exactly/);
    },
  );

  test("the printed target line never carries credentials", () => {
    const target = resolveTarget(
      write,
      { POSTGRES_URL_NON_POOLING: url("localhost") },
      undefined,
    );
    expect(targetLine(target)).not.toContain("s3cr3t");
    expect(targetLine(target)).not.toContain("postgres:");
  });

  test("--dry-run reads no URL at all", () => {
    expect(
      resolveTarget(
        { dryRun: true, production: false },
        { POSTGRES_URL_NON_POOLING: "garbage" },
        undefined,
      ),
    ).toEqual({
      kind: "dry-run",
    });
  });
});

describe("path C: non-local hosts need both opt-ins and a PEM root (T10)", () => {
  const remotes = [
    "db.x.supabase.co",
    "aws-0-x.pooler.supabase.com",
    "10.0.0.5",
    "example.com",
  ];

  test.each(remotes)(
    "%s is refused without --production and ALLOW_PROD_INGEST=1",
    (host) => {
      const env = {
        POSTGRES_URL_NON_POOLING: url(host),
        POSTGRES_SSL_ROOT_CERT: PEM,
      };
      expect(outcome(write, env)).toMatch(
        /refusing.*needs both --production and ALLOW_PROD_INGEST=1/,
      );
      expect(outcome(write, env, "1")).toMatch(/refusing/);
      expect(outcome(prod, env)).toMatch(/refusing/);
      for (const flag of ["true", "yes", " 1", "1 ", "0", ""]) {
        expect(outcome(prod, env, flag)).toMatch(/refusing/);
      }
      expect(outcome(prod, env, "1")).toBe("allowed: production");
    },
  );

  test("--production carries the PEM root it parsed", () => {
    const target = resolveTarget(
      prod,
      {
        POSTGRES_URL_NON_POOLING: url("db.x.supabase.co"),
        POSTGRES_SSL_ROOT_CERT: PEM,
      },
      "1",
    );
    expect(target).toMatchObject({
      kind: "production",
      display: "db.x.supabase.co:5432/postgres",
    });
    expect(target.kind === "production" && target.caCert).toContain(
      "BEGIN CERTIFICATE",
    );
    expect(targetLine(target)).toBe(
      "target database: db.x.supabase.co:5432/postgres (PRODUCTION)",
    );
  });

  test("--production without POSTGRES_SSL_ROOT_CERT is refused", () => {
    expect(
      outcome(prod, { POSTGRES_URL_NON_POOLING: url("db.x.supabase.co") }, "1"),
    ).toMatch(/needs POSTGRES_SSL_ROOT_CERT/);
  });

  test("--production with a non-PEM root is refused without echoing it", () => {
    const message = outcome(
      prod,
      {
        POSTGRES_URL_NON_POOLING: url("db.x.supabase.co"),
        POSTGRES_SSL_ROOT_CERT: "not-a-cert-XYZZY",
      },
      "1",
    );
    expect(message).toMatch(/not a PEM certificate/);
    expect(message).not.toContain("XYZZY");
  });

  test("--production with a local host is refused", () => {
    expect(
      outcome(
        prod,
        {
          POSTGRES_URL_NON_POOLING: url("localhost"),
          POSTGRES_SSL_ROOT_CERT: PEM,
        },
        "1",
      ),
    ).toMatch(/--production names a local host/);
  });

  test("ALLOW_PROD_INGEST only counts as the captured argument, never from env", () => {
    const env = {
      POSTGRES_URL_NON_POOLING: url("db.x.supabase.co"),
      POSTGRES_SSL_ROOT_CERT: PEM,
      ALLOW_PROD_INGEST: "1", // as if a .env copy had been loaded
    };
    expect(outcome(prod, env, undefined)).toMatch(/refusing/);
  });
});

describe("always refused, flags or not (T10)", () => {
  const cases: [string, string | undefined][] = [
    ["an unset URL", undefined],
    ["an empty URL", ""],
    ["a URL that does not parse", "postgresql://"],
    ["not a URL", "localhost:5432"],
    ["a non-postgres scheme", "mysql://u:s3cr3t-pw@localhost/db"],
    ["an empty host", "postgresql:///db"],
    ["hostaddr", url("localhost", "?hostaddr=127.0.0.1")],
    [
      "hostaddr behind a Supabase name",
      url("db.x.supabase.co", "?hostaddr=127.0.0.1"),
    ],
    ["a host parameter", url("localhost", "?host=db.x.supabase.co")],
    ["a local host parameter", url("localhost", "?host=localhost")],
    ["::1", "postgresql://u:s3cr3t-pw@[::1]:5432/db"],
    ["a socket directory", "postgresql://u:s3cr3t-pw@%2Ftmp/db"],
  ];

  test.each(cases)("%s", (_label, value) => {
    for (const [options, allow] of [
      [write, undefined],
      [prod, "1"],
    ] as const) {
      const message = outcome(
        options,
        { POSTGRES_URL_NON_POOLING: value, POSTGRES_SSL_ROOT_CERT: PEM },
        allow,
      );
      expect(message).toMatch(/^refusing to run: /);
    }
  });
});

describe("the target line is what pg dials (T10, ADV.14)", () => {
  const remote = "postgres.ref:s3cr3t-pw@aws-0-x.pooler.supabase.com";
  test.each([
    ["?port=6543", "port"],
    ["?PORT=6543", "port"],
    ["?dbname=other", "dbname"],
    ["?database=other", "database"],
    ["?user=other", "user"],
    ["?options=-c%20search_path%3Dx", "options"],
    ["?sslmode=require&Port=6543&user=x", "port, user"],
  ])("a %s query parameter is refused, local or remote", (query, keys) => {
    for (const [options, env, allow] of [
      [write, { POSTGRES_URL_NON_POOLING: url("localhost", query) }, undefined],
      [
        prod,
        {
          POSTGRES_URL_NON_POOLING: `postgresql://${remote}:5432/postgres${query}`,
          POSTGRES_SSL_ROOT_CERT: PEM,
        },
        "1",
      ],
    ] as const) {
      expect(outcome(options, env, allow)).toContain(
        `the database URL sets ${keys} as a query parameter`,
      );
    }
  });

  test("TLS and other harmless parameters are still allowed", () => {
    const target = resolveTarget(
      prod,
      {
        POSTGRES_URL_NON_POOLING: `postgresql://${remote}:5432/postgres?sslmode=require&application_name=x`,
        POSTGRES_SSL_ROOT_CERT: PEM,
      },
      "1",
    );
    expect(targetLine(target)).toBe(
      "target database: aws-0-x.pooler.supabase.com:5432/postgres (PRODUCTION)",
    );
  });

  test.each([
    [
      "no port",
      "postgresql://u:s3cr3t-pw@localhost/postgres",
      /must name its port/,
    ],
    [
      "no database",
      "postgresql://u:s3cr3t-pw@localhost:5432/",
      /must name its database/,
    ],
    [
      "no database or slash",
      "postgresql://u:s3cr3t-pw@localhost:5432",
      /must name its database/,
    ],
  ])(
    "a URL with %s is refused, whatever PGPORT and PGDATABASE say",
    (_label, value, why) => {
      expect(
        outcome(write, {
          POSTGRES_URL_NON_POOLING: value,
          PGPORT: "6543",
          PGDATABASE: "other",
        }),
      ).toMatch(why);
    },
  );

  test("path C refuses a URL without its port too (the runbook's URL names it)", () => {
    expect(
      outcome(
        prod,
        {
          POSTGRES_URL_NON_POOLING: `postgresql://${remote}/postgres`,
          POSTGRES_SSL_ROOT_CERT: PEM,
        },
        "1",
      ),
    ).toMatch(/must name its port/);
  });

  test("the runbook's password-free path C URL is accepted and displayed as dialed", () => {
    const target = resolveTarget(
      prod,
      {
        POSTGRES_URL_NON_POOLING:
          "postgresql://postgres.ref@aws-0-ca-central-1.pooler.supabase.com:5432/postgres",
        POSTGRES_SSL_ROOT_CERT: PEM,
      },
      "1",
    );
    expect(targetLine(target)).toBe(
      "target database: aws-0-ca-central-1.pooler.supabase.com:5432/postgres (PRODUCTION)",
    );
  });

  test("a remote host is displayed as written, not normalized", () => {
    const target = resolveTarget(
      prod,
      {
        POSTGRES_URL_NON_POOLING:
          "postgresql://u:s3cr3t-pw@DB.Example.Supabase.co:5432/postgres",
        POSTGRES_SSL_ROOT_CERT: PEM,
      },
      "1",
    );
    expect(targetLine(target)).toContain(
      "DB.Example.Supabase.co:5432/postgres",
    );
  });
});

describe("arguments (T10, S0.2d18)", () => {
  test("parses every flag", () => {
    expect(
      parseCliArgs([
        "--dry-run",
        "--source-dir",
        ".cache/mtgjson",
        "--basis-sample",
        "25",
        "--seed",
        "7",
      ]),
    ).toEqual({
      dryRun: true,
      production: false,
      identifiersOnly: false,
      sourceDir: ".cache/mtgjson",
      basisSample: 25,
      seed: 7,
      help: false,
    });
    expect(parseCliArgs(["--identifiers-only"]).identifiersOnly).toBe(true);
    expect(parseCliArgs(["--production"]).production).toBe(true);
    expect(parseCliArgs(["--help"]).help).toBe(true);
  });

  test.each([
    ["an unknown flag", ["--force"]],
    ["a positional", ["prices"]],
    ["--dry-run with --production", ["--dry-run", "--production"]],
    ["--basis-sample without --dry-run", ["--basis-sample", "25"]],
    ["--basis-sample 0", ["--dry-run", "--basis-sample", "0"]],
    ["--basis-sample 101", ["--dry-run", "--basis-sample", "101"]],
    ["--basis-sample 2.5", ["--dry-run", "--basis-sample", "2.5"]],
    ["--basis-sample x", ["--dry-run", "--basis-sample", "x"]],
    [
      "--basis-sample with --identifiers-only",
      ["--dry-run", "--identifiers-only", "--basis-sample", "5"],
    ],
    ["--seed without --basis-sample", ["--dry-run", "--seed", "3"]],
    ["--seed -1", ["--dry-run", "--basis-sample", "3", "--seed", "-1"]],
    ["an empty --source-dir", ["--dry-run", "--source-dir", " "]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseCliArgs(argv)).toThrow(UsageError);
  });

  test.each([
    "postgresql://u:pw-XYZZY@db.example.invalid/db",
    "postgres://u:pw-XYZZY@h:5432/db",
    "/Users/josh/u:pw-XYZZY@h",
  ])("--source-dir %s is refused without echoing it (ADV.13)", (value) => {
    expect(() => parseCliArgs(["--dry-run", "--source-dir", value])).toThrow(
      UsageError,
    );
    try {
      parseCliArgs(["--dry-run", "--source-dir", value]);
    } catch (error) {
      expect((error as Error).message).toBe(
        "--source-dir takes a directory path, not a URL (the value is not shown)",
      );
    }
  });

  test("the help text lists every flag", () => {
    const text = usage();
    for (const name of Object.keys(FLAGS)) expect(text).toContain(`--${name}`);
  });
});
