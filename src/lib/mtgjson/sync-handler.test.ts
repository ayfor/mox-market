// T3 (AC-1, AC-3, AC-9; S0.3d6, S0.3d8, S0.3d16): createSyncHandler with an
// injected database, source and clock, behind the no-database barrier. Status
// to HTTP, the JSON body (dbBytes a number), Cache-Control, one log line per
// run, sanitized errors with the secret redacted, and the per-run download
// directory removed on every outcome.
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi, type Mock } from "vitest";
import { fixtureFiles, STANDARD_IDENTIFIERS } from "./__fixtures__/build";
import { FakeDb, type FakeDbOptions } from "./__fixtures__/fake-db";
import { createFixtureSource, type MtgjsonSource } from "./source";
import type { SyncDeps, SyncResult } from "./sync";
import {
  createSyncHandler,
  redactSecret,
  SYNC_TEMP_PREFIX,
  type SyncHandlerDeps,
} from "./sync-handler";

const SECRET = "c0ffee-sync-secret-for-tests-only-0123456789abcdef";
const NOW = new Date("2026-10-05T17:00:00.000Z");
const authorized = () =>
  new Request("http://localhost/api/prices/sync-mtgjson", {
    headers: { Authorization: `Bearer ${SECRET}` },
  });

/** Temp directories the handler made, with their existence during the run. */
function tempTracker() {
  const made: string[] = [];
  const existedDuringRun: boolean[] = [];
  return {
    made,
    existedDuringRun,
    makeTempDir: async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), SYNC_TEMP_PREFIX));
      made.push(dir);
      return dir;
    },
  };
}

function handlerWith(
  dbOptions: FakeDbOptions = { identifiers: STANDARD_IDENTIFIERS },
  overrides: Partial<SyncHandlerDeps> = {},
) {
  const db = new FakeDb(dbOptions);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const temp = tempTracker();
  const sources: string[] = [];
  const handler = createSyncHandler({
    secret: () => SECRET,
    loadDb: async () => db,
    createSource: (dir: string): MtgjsonSource => {
      sources.push(dir);
      temp.existedDuringRun.push(existsSync(dir));
      return createFixtureSource(fixtureFiles());
    },
    makeTempDir: temp.makeTempDir,
    now: () => NOW,
    log,
    ...overrides,
  });
  return { handler, db, log, temp, sources };
}

const linesOf = (log: { info: Mock; warn: Mock; error: Mock }) => [
  ...log.info.mock.calls.map((c) => String(c[0])),
  ...log.warn.mock.calls.map((c) => String(c[0])),
  ...log.error.mock.calls.map((c) => String(c[0])),
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("status to HTTP and the body (T3)", () => {
  test("ok → 200, JSON with the run row's fields, dbBytes a number, no-store, one info line", async () => {
    const { handler, db, log } = handlerWith();
    const res = await handler(authorized());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toEqual({
      status: "ok",
      runId: 1,
      sourceDate: "2026-10-05",
      sourceVersion: "5.3.0+20261005",
      rowsWritten: 7,
      rowsPruned: 0,
      unmappedUuids: 1,
      dbBytes: 100_000_000,
      staleRunsMarked: 0,
      phasesMs: expect.any(Object),
    });
    expect(typeof body.dbBytes).toBe("number");
    for (const value of Object.values(body.phasesMs)) {
      expect(typeof value).toBe("number");
    }
    expect(Object.keys(body.phasesMs).sort()).toEqual(
      ["fetch", "identifiers", "parse", "prune", "total", "upserts"].sort(),
    );
    expect(db.matching(/unnest/)).toHaveLength(1);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info.mock.calls[0][0]).toMatch(/run 1 ok: .*rows_written=7/);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  test.each([
    ["source_stale", 200, "info"],
    ["budget_stop", 200, "warn"],
    ["ok", 200, "info"],
    ["error", 500, "error"],
  ] as const)("%s → %s, logged with %s", async (status, http, level) => {
    const result: SyncResult = {
      status,
      runId: 9,
      sourceDate: "2026-10-05",
      sourceVersion: "5.3.0",
      rowsWritten: 0,
      rowsPruned: 4,
      unmappedUuids: 0,
      dbBytes: status === "error" ? null : 123,
      staleRunsMarked: 0,
      phasesMs: {
        fetch: 1,
        identifiers: 2,
        parse: 3,
        upserts: 4,
        prune: 5,
        total: 15,
      },
      error: status === "error" ? "SyncRefusedError: nope" : null,
      priceStats: null,
    };
    const { handler, log } = handlerWith(undefined, {
      runSync: async () => result,
    });
    const res = await handler(authorized());
    expect(res.status).toBe(http);
    const body = await res.json();
    expect(body.status).toBe(status);
    expect(body.runId).toBe(9);
    expect(body).not.toHaveProperty("priceStats");
    if (status === "error") {
      expect(body.error).toBe("SyncRefusedError: nope");
    } else {
      expect(body).not.toHaveProperty("error");
    }
    const other = (["info", "warn", "error"] as const).filter(
      (l) => l !== level,
    );
    expect(log[level]).toHaveBeenCalledTimes(1);
    for (const l of other) expect(log[l]).not.toHaveBeenCalled();
  });

  test("a real budget_stop run → 200", async () => {
    const { handler, db } = handlerWith({
      identifiers: STANDARD_IDENTIFIERS,
      sizes: [450_000_001],
    });
    const res = await handler(authorized());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("budget_stop");
    expect(db.matching(/unnest/)).toHaveLength(0);
  });

  test("a real error run (empty identifiers) → 500 with the summary and a sanitized error", async () => {
    const { handler } = handlerWith({ identifiers: [] });
    const res = await handler(authorized());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "error",
      runId: 1,
      rowsWritten: 0,
      dbBytes: null,
    });
    expect(body.error).toMatch(/identifiers not loaded/);
  });
});

describe("the database fails first (T3)", () => {
  test("the first query rejects (a paused Supabase) → 500 { status: error, runId: null }, no run row, one error line", async () => {
    const { handler, db, log } = handlerWith({
      failOn: {
        match: /^UPDATE/,
        nth: 1,
        error: new Error(
          `Can't reach database server at postgresql://user:pw-XYZZY@db.example.invalid:5432/postgres (${SECRET})`,
        ),
      },
    });
    const res = await handler(authorized());
    expect(res.status).toBe(500);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body).toEqual({
      status: "error",
      runId: null,
      error: expect.any(String),
    });
    expect(db.matching(/INSERT INTO "price_sync_runs"/)).toHaveLength(0);
    expect(log.error).toHaveBeenCalledTimes(1);
    for (const line of [text, ...linesOf(log)]) {
      expect(line).not.toContain("pw-XYZZY");
      expect(line).not.toContain(SECRET);
    }
    expect(body.error).toContain("[redacted url]");
    expect(body.error).toContain("[redacted]");
  });

  test("loading the client throws (POSTGRES_PRISMA_URL unset, a TLS root that is not PEM) → 500 runId null, no temp directory", async () => {
    const { handler, log, temp } = handlerWith(undefined, {
      loadDb: async () => {
        throw new Error("POSTGRES_PRISMA_URL unset");
      },
    });
    const res = await handler(authorized());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      status: "error",
      runId: null,
      error: "Error: POSTGRES_PRISMA_URL unset",
    });
    expect(temp.made).toEqual([]);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  test("a TLS failure mid-run is sanitized in the body, the log and the run row", async () => {
    const { handler, db, log } = handlerWith({
      identifiers: STANDARD_IDENTIFIERS,
      failOn: {
        match: /unnest/,
        nth: 1,
        error: new Error(
          `self-signed certificate in certificate chain for postgres://u:pw-XYZZY@h:6543/db token=${SECRET}`,
        ),
      },
    });
    const res = await handler(authorized());
    expect(res.status).toBe(500);
    const text = await res.text();
    const finish = db.matching(/"rows_written" = \$3::int4/)[0];
    for (const line of [text, ...linesOf(log), String(finish.values[6])]) {
      expect(line).not.toContain("pw-XYZZY");
      expect(line).not.toContain(SECRET);
    }
  });
});

describe("the per-run download directory (T3, S0.3d6)", () => {
  test.each([
    ["ok", { identifiers: STANDARD_IDENTIFIERS }],
    ["error", { identifiers: [] }],
  ] as const)(
    "exists during the run and is removed after %s",
    async (_label, options) => {
      const { handler, temp, sources } = handlerWith(options);
      await handler(authorized());
      expect(temp.made).toHaveLength(1);
      expect(sources).toEqual(temp.made);
      expect(temp.existedDuringRun).toEqual([true]);
      expect(existsSync(temp.made[0])).toBe(false);
      expect(path.basename(temp.made[0])).toMatch(/^mox-mtgjson-/);
      expect(path.dirname(temp.made[0])).toBe(os.tmpdir());
    },
  );

  test("is removed after a thrown fault, which answers 500 with no run row", async () => {
    const { handler, temp, log } = handlerWith(undefined, {
      runSync: async () => {
        throw new Error("unexpected");
      },
    });
    const res = await handler(authorized());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      status: "error",
      runId: null,
      error: "Error: unexpected",
    });
    expect(temp.made).toHaveLength(1);
    expect(existsSync(temp.made[0])).toBe(false);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  test("two concurrent requests use different directories", async () => {
    const { handler, temp } = handlerWith();
    const [a, b] = await Promise.all([
      handler(authorized()),
      handler(authorized()),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(temp.made).toHaveLength(2);
    expect(temp.made[0]).not.toBe(temp.made[1]);
    for (const dir of temp.made) expect(existsSync(dir)).toBe(false);
  });

  test("a directory that cannot be created → 500 runId null, no run", async () => {
    const runSync = vi.fn<(deps: SyncDeps) => Promise<SyncResult>>();
    const { handler } = handlerWith(undefined, {
      makeTempDir: async () => {
        throw new Error("ENOSPC: no space left on device");
      },
      runSync,
    });
    const res = await handler(authorized());
    expect(res.status).toBe(500);
    expect((await res.json()).runId).toBeNull();
    expect(runSync).not.toHaveBeenCalled();
  });

  test("a removal failure is logged as a warning and the response stands", async () => {
    const { handler, log, temp } = handlerWith(undefined, {
      removeTempDir: async () => {
        throw new Error("EBUSY");
      },
    });
    const res = await handler(authorized());
    expect(res.status).toBe(200);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatch(/not removed/);
    for (const dir of temp.made)
      await rm(dir, { recursive: true, force: true });
  });
});

describe("the guard runs first (T3, AC-1)", () => {
  test.each([
    ["unset", undefined, `Bearer ${SECRET}`, 500],
    ["the placeholder", "replace-me", "Bearer replace-me", 500],
    ["set, wrong header", SECRET, "Bearer nope", 401],
    ["set, no header", SECRET, null, 401],
  ])(
    "CRON_SECRET %s → %s, no database, no directory, no source",
    async (_label, secret, header, status) => {
      const loadDb = vi.fn(async () => new FakeDb());
      const createSource = vi.fn();
      const temp = tempTracker();
      const handler = createSyncHandler({
        secret: () => secret,
        loadDb,
        createSource,
        makeTempDir: temp.makeTempDir,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });
      const headers: Record<string, string> =
        header === null ? {} : { Authorization: header };
      const res = await handler(
        new Request("http://localhost/api/prices/sync-mtgjson", { headers }),
      );
      expect(res.status).toBe(status);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(loadDb).not.toHaveBeenCalled();
      expect(createSource).not.toHaveBeenCalled();
      expect(temp.made).toEqual([]);
      const text = await res.text();
      expect(text).not.toContain(SECRET);
    },
  );
});

describe("redactSecret", () => {
  test("replaces every occurrence and leaves other text alone", () => {
    expect(redactSecret("a SECRET b SECRET", "SECRET")).toBe(
      "a [redacted] b [redacted]",
    );
    expect(redactSecret("nothing here", "SECRET")).toBe("nothing here");
    expect(redactSecret("text", "")).toBe("text");
  });
});
