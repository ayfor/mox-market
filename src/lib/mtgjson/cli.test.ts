// The CLI's body as a function (S0.2d18): ADV.7 every exit code and its
// stderr line, ADV.15 the capture-then-load order of ALLOW_PROD_INGEST,
// ADV.13 no connection string echoed, ADV.5 the cache from the repo root,
// ADV.4 the interrupt handler. Pure inputs only (S0.2d24): --production
// appears as an argv value, never as a process; the database factory is a
// spy or a fake, and nothing connects or downloads.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fixtureFiles, NOW } from "./__fixtures__/build";
import { FakeDb } from "./__fixtures__/fake-db";
import {
  BUDGET_STOP_MESSAGE,
  defaultCacheDir,
  failureOf,
  interruptHandler,
  REPO_DOTENV,
  REPO_ROOT,
  runCli,
  type CliDeps,
} from "./cli";
import type { IngestDb } from "./db";
import {
  EXIT,
  IngestInterruptedError,
  NothingToWriteError,
  runBulkIngest,
} from "./ingest";
import { SourceFormatError } from "./parse";
import { createFixtureSource } from "./source";
import { IngestRefusedError, UsageError } from "./target";

const PEM =
  "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----";
const SUPABASE =
  "postgresql://postgres:pw-XYZZY@db.example.supabase.co:5432/postgres";
const LOCAL_URL = "postgresql://postgres:postgres@localhost:55432/mox_market";

function harness(overrides: Partial<CliDeps> & Pick<CliDeps, "argv">) {
  const out: string[] = [];
  const err: string[] = [];
  const env: Record<string, string | undefined> = { ...(overrides.env ?? {}) };
  const dbFactory = vi.fn(async (): Promise<IngestDb> => {
    throw new Error("the database factory must not be called");
  });
  const createSource = vi.fn(() => createFixtureSource(fixtureFiles()));
  const loadEnv = vi.fn();
  const deps: CliDeps = {
    inlineAllowProdIngest: undefined,
    loadEnv,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    now: () => NOW,
    dbFactory,
    createSource,
    ...overrides,
    env,
  };
  return {
    deps,
    env,
    out,
    err,
    dbFactory,
    createSource,
    loadEnv,
    run: () => runCli(deps),
    text: () => [...out, ...err].join("\n"),
  };
}

describe("failureOf: the exit-code table (ADV.7)", () => {
  test.each([
    [new IngestRefusedError("refusing to run: x"), EXIT.refused],
    [new UsageError("Unknown option '--force'"), EXIT.refused],
    [new IngestInterruptedError("SIGINT"), EXIT.error],
    [new NothingToWriteError("no price rows emitted"), EXIT.error],
    [
      new SourceFormatError("AllPrices.json.gz: malformed JSON (x)"),
      EXIT.error,
    ],
    [new Error("boom"), EXIT.error],
    ["a string", EXIT.error],
  ] as const)("%s → exit %s", (error, code) => {
    expect(failureOf(error).code).toBe(code);
  });

  test("a run error names its class, is sanitized and says a re-run is safe", () => {
    expect(
      failureOf(new Error("lost postgres://u:pw-XYZZY@h:5432/db")).message,
    ).toBe(
      "run error: Error: lost [redacted url]. Earlier chunks stay committed; a re-run is safe.",
    );
  });

  test("a refusal prints its own message, sanitized", () => {
    expect(
      failureOf(new IngestRefusedError("refusing u:pw-XYZZY@h:5432/db"))
        .message,
    ).toBe("refusing [redacted url]");
  });
});

describe("runCli (ADV.7, ADV.13, ADV.15)", () => {
  test("--help prints the usage and exits 0, loading no .env", async () => {
    const h = harness({ argv: ["--help"] });
    expect(await h.run()).toBe(EXIT.ok);
    expect(h.out.join("\n")).toContain("--identifiers-only");
    expect(h.loadEnv).not.toHaveBeenCalled();
  });

  test.each([
    [["postgresql://u:pw-XYZZY@db.example.invalid/db"]],
    [["--dry-run", "--source-dir", "postgresql://u:pw-XYZZY@h/db"]],
    [["--dry-run", "--source-dir=postgres://u:pw-XYZZY@h:5432/db"]],
  ])(
    "a connection string in argv exits 2 and is never echoed: %j",
    async (argv) => {
      const h = harness({ argv });
      expect(await h.run()).toBe(EXIT.refused);
      expect(h.err[0]).toMatch(/^usage error: /);
      expect(h.text()).not.toContain("pw-XYZZY");
      expect(h.createSource).not.toHaveBeenCalled();
    },
  );

  test("ALLOW_PROD_INGEST that only .env sets never arms path C (captured before the load)", async () => {
    const h = harness({
      argv: ["--production", "--source-dir", "/nonexistent"],
      env: { POSTGRES_URL_NON_POOLING: SUPABASE, POSTGRES_SSL_ROOT_CERT: PEM },
    });
    h.loadEnv.mockImplementation(() => {
      h.env.ALLOW_PROD_INGEST = "1";
    });
    expect(await h.run()).toBe(EXIT.refused);
    expect(h.loadEnv).toHaveBeenCalledTimes(1);
    expect(h.env.ALLOW_PROD_INGEST).toBe("1");
    expect(h.err.join("\n")).toMatch(
      /needs both --production and ALLOW_PROD_INGEST=1 set inline/,
    );
    expect(h.dbFactory).not.toHaveBeenCalled();
    expect(h.createSource).not.toHaveBeenCalled();
    expect(h.text()).not.toContain("pw-XYZZY");
  });

  test(".env loads before the guard reads the URL, so a URL it supplies is used", async () => {
    const h = harness({ argv: ["--source-dir", "/fixtures"] });
    h.loadEnv.mockImplementation(() => {
      h.env.POSTGRES_URL_NON_POOLING = LOCAL_URL;
    });
    const db = new FakeDb();
    const code = await runCli({
      ...h.deps,
      dbFactory: async () => db as unknown as IngestDb,
    });
    expect(code).toBe(EXIT.ok);
    expect(h.out[0]).toBe(
      "target database: localhost:55432/mox_market (local)",
    );
    expect(h.out.join("\n")).toContain("write: status ok");
  });

  test("exit 3 prints the report and the budget_stop line", async () => {
    const h = harness({
      argv: ["--dry-run", "--source-dir", "/fixtures"],
      runIngest: async (request, deps) => ({
        ...(await runBulkIngest(request, deps)),
        exitCode: EXIT.budgetStop,
      }),
    });
    expect(await h.run()).toBe(EXIT.budgetStop);
    expect(h.out.join("\n")).toContain("MTGJson ingest report");
    expect(h.err).toContain(BUDGET_STOP_MESSAGE);
    expect(BUDGET_STOP_MESSAGE).toMatch(/Stop and ask Bitey/);
  });

  test("exit 1: a run error after the run row started, sanitized", async () => {
    const h = harness({
      argv: ["--dry-run", "--source-dir", "/fixtures"],
      runIngest: async () => {
        throw new SourceFormatError(
          "AllPrices.json.gz: malformed JSON at postgres://u:pw-XYZZY@h/db",
        );
      },
    });
    expect(await h.run()).toBe(EXIT.error);
    expect(h.err.at(-1)).toBe(
      "run error: SourceFormatError: AllPrices.json.gz: malformed JSON at [redacted url]. Earlier chunks stay committed; a re-run is safe.",
    );
  });

  test("exit 2: a refusal from the ingest prints its message", async () => {
    const h = harness({
      argv: ["--dry-run", "--source-dir", "/fixtures"],
      runIngest: async () => {
        throw new IngestRefusedError('Meta.json: meta.version "4.9.0"');
      },
    });
    expect(await h.run()).toBe(EXIT.refused);
    expect(h.err.at(-1)).toBe('Meta.json: meta.version "4.9.0"');
  });

  test("an interrupt mid-run exits 1 with the row finished error (interrupted)", async () => {
    const controller = new AbortController();
    let priceChunks = 0;
    const db = new FakeDb({
      onStatement: (s) => {
        if (/INSERT INTO "price_history"/.test(s.text) && ++priceChunks === 1) {
          controller.abort("SIGINT");
        }
      },
    });
    const h = harness({
      argv: ["--source-dir", "/fixtures"],
      env: { POSTGRES_URL_NON_POOLING: LOCAL_URL },
      signal: controller.signal,
      dbFactory: async () => db as unknown as IngestDb,
      runIngest: (request, deps) =>
        runBulkIngest(request, { ...deps, chunkRows: 3 }),
    });
    expect(await h.run()).toBe(EXIT.error);
    expect(h.err.at(-1)).toBe(
      "run error: IngestInterruptedError: interrupted by SIGINT. Earlier chunks stay committed; a re-run is safe.",
    );
    expect(db.matching(/^UPDATE "price_sync_runs"/)[0].values[1]).toBe("error");
  });
});

describe("paths from the repository root, not the working directory (ADV.5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("defaultCacheDir() is <repo>/.cache/mtgjson even when the cwd is scripts/", () => {
    const repo = path.resolve(__dirname, "..", "..", "..");
    vi.spyOn(process, "cwd").mockReturnValue(path.join(repo, "scripts"));
    expect(REPO_ROOT).toBe(repo);
    expect(defaultCacheDir()).toBe(path.join(repo, ".cache", "mtgjson"));
    expect(REPO_DOTENV).toBe(path.join(repo, ".env"));
  });

  test("git ignores the default cache's files", () => {
    const file = path.relative(
      REPO_ROOT,
      path.join(defaultCacheDir(), "AllPrices.json.gz"),
    );
    expect(
      execFileSync("git", ["check-ignore", file], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }).trim(),
    ).toBe(file);
  });
});

describe("interruptHandler (ADV.4)", () => {
  const setup = (runStarted: boolean) => {
    const controller = new AbortController();
    const exit = vi.fn();
    const err = vi.fn();
    const handle = interruptHandler({
      controller,
      isRunStarted: () => runStarted,
      err,
      exit,
    });
    return { controller, exit, err, handle };
  };

  test("before the run row exists, it exits 2 at once: nothing was written", () => {
    const { controller, exit, err, handle } = setup(false);
    handle("SIGINT");
    expect(exit).toHaveBeenCalledWith(EXIT.refused);
    expect(err).toHaveBeenCalledWith(
      "SIGINT: stopped before any database write",
    );
    expect(controller.signal.aborted).toBe(false);
  });

  test("after it, the first signal aborts the run and the second exits 1", () => {
    const { controller, exit, err, handle } = setup(true);
    handle("SIGTERM");
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("SIGTERM");
    expect(exit).not.toHaveBeenCalled();
    expect(String(err.mock.calls[0][0])).toMatch(
      /finishing the run row as error/,
    );
    handle("SIGINT");
    expect(exit).toHaveBeenCalledWith(EXIT.error);
    expect(String(err.mock.calls[1][0])).toMatch(/stays running/);
  });
});
