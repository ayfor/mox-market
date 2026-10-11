// T8 (AC-4, AC-6; S0.2d5, S0.2d18) the dry-run and the version checks, and
// T11 (AC-9; S0.2d15) the budget, all on fixture sources and a fake Db: no
// network, no database. The production target here is a plain object (pure
// input, S0.2d24); its database factory is a spy that is never allowed to
// connect.
import { describe, expect, test, vi } from "vitest";
import {
  fixtureFiles,
  manyCards,
  META,
  NOW,
  RUN_DATE,
  STANDARD_CARDS,
} from "./__fixtures__/build";
import { FakeDb } from "./__fixtures__/fake-db";
import { ALL_PRICES_FILE, META_FILE } from "./consts";
import type { IngestDb } from "./db";
import { EXIT, runBulkIngest, type IngestDeps } from "./ingest";
import { createFixtureSource } from "./source";
import { IngestRefusedError, resolveTarget, type IngestTarget } from "./target";

const LOCAL: IngestTarget = {
  kind: "local",
  url: "postgresql://postgres:postgres@localhost:5432/mox_market",
  display: "localhost:5432/mox_market",
};
const PRODUCTION: IngestTarget = {
  kind: "production",
  url: "postgresql://postgres:secret@db.example.supabase.co:5432/postgres",
  display: "db.example.supabase.co:5432/postgres",
  caCert: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
};

function deps(
  files = fixtureFiles(),
  db: FakeDb | null = new FakeDb(),
  extra: Partial<IngestDeps> = {},
) {
  const source = createFixtureSource(files);
  const dbFactory = vi.fn(async (): Promise<IngestDb> => {
    if (db === null) throw new Error("the database factory must not be called");
    return db as unknown as IngestDb;
  });
  return {
    source,
    dbFactory,
    deps: {
      source,
      now: () => NOW,
      dbFactory,
      peakRssBytes: () => 123_000_000,
      ...extra,
    } satisfies IngestDeps,
  };
}

describe("path A, the dry-run (T8, AC-6)", () => {
  test.each([
    ["unset", {}],
    [
      "local",
      { POSTGRES_URL_NON_POOLING: LOCAL.kind === "local" ? LOCAL.url : "" },
    ],
    [
      "a Supabase host",
      {
        POSTGRES_URL_NON_POOLING:
          "postgresql://u:p@db.x.supabase.co:5432/postgres",
      },
    ],
  ])(
    "never calls the database factory with the URL %s",
    async (_label, env) => {
      const target = resolveTarget(
        { dryRun: true, production: false },
        env,
        undefined,
      );
      expect(target).toEqual({ kind: "dry-run" });
      const { deps: d, dbFactory } = deps(fixtureFiles(), null);
      const { exitCode, report } = await runBulkIngest(
        { target, identifiersOnly: false },
        d,
      );
      expect(exitCode).toBe(EXIT.ok);
      expect(dbFactory).not.toHaveBeenCalled();
      expect(report.write).toBeNull();
    },
  );

  test("the report carries every AC-6 field", async () => {
    const { deps: d } = deps(fixtureFiles(), null);
    const { report } = await runBulkIngest(
      { target: { kind: "dry-run" }, identifiersOnly: false },
      d,
    );
    const p = report.prices!;
    expect(p.rowsByFinish).toEqual({ normal: 15, foil: 3, etched: 3 });
    expect(p.distinctSeries).toBe(7);
    expect(p.distinctPrintings).toBe(6);
    expect(p.gate).toEqual({
      rankOnly: 2,
      priceOnly: 3,
      both: 2,
      dropped: 2,
      noValidPrice: 0,
    });
    expect(p.unmappedUuids).toBe(1);
    expect(p.scryfallCollisions).toBe(1);
    expect(p.invalidPrices).toBe(0);
    expect([...p.rowsByDate.keys()].sort()).toEqual([
      "2026-09-05",
      "2026-10-04",
      RUN_DATE,
    ]);
    expect(report.files).toEqual([
      { file: "Meta.json", ...META },
      { file: "AllIdentifiers.json.gz", ...META },
      { file: "AllPrices.json.gz", ...META },
    ]);
    expect(report.runDate).toBe(RUN_DATE);
    expect(report.peakRssBytes).toBe(123_000_000);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.identifiers.stored).toBe(9);
  });

  test("--identifiers-only --dry-run reports identifier counts only and never opens AllPrices", async () => {
    const { deps: d, source, dbFactory } = deps(fixtureFiles(), null);
    const { report } = await runBulkIngest(
      { target: { kind: "dry-run" }, identifiersOnly: true },
      d,
    );
    expect(report.prices).toBeNull();
    expect(report.identifiers.stored).toBe(9);
    expect(source.opened).not.toContain(ALL_PRICES_FILE);
    expect(dbFactory).not.toHaveBeenCalled();
  });
});

describe("version checks (T8, AC-4)", () => {
  const targets: IngestTarget[] = [{ kind: "dry-run" }, LOCAL, PRODUCTION];

  test.each([
    ["4.9.0", { date: RUN_DATE, version: "4.9.0" }],
    ["6.0.0", { date: RUN_DATE, version: "6.0.0" }],
    ['""', { date: RUN_DATE, version: "" }],
    ["5 (no dot)", { date: RUN_DATE, version: "5" }],
    ['" 5.2.2"', { date: RUN_DATE, version: " 5.2.2" }],
    ["missing", { date: RUN_DATE }],
  ])(
    "Meta.json version %s is refused before any database call",
    async (_label, meta) => {
      for (const target of targets) {
        const { deps: d, dbFactory } = deps(
          fixtureFiles(STANDARD_CARDS, {
            meta: meta as { date: unknown; version: unknown },
          }),
          null,
        );
        const run = runBulkIngest({ target, identifiersOnly: false }, d);
        await expect(run).rejects.toBeInstanceOf(IngestRefusedError);
        await expect(run).rejects.toThrow(/before any database write/);
        expect(dbFactory).not.toHaveBeenCalled();
      }
    },
  );

  test("AllIdentifiers' head meta 4.x is refused", async () => {
    for (const target of targets) {
      const { deps: d, dbFactory } = deps(
        fixtureFiles(STANDARD_CARDS, {
          identifiersMeta: { date: RUN_DATE, version: "4.6.1" },
        }),
        null,
      );
      await expect(
        runBulkIngest({ target, identifiersOnly: false }, d),
      ).rejects.toThrow(/AllIdentifiers\.json\.gz: meta\.version "4\.6\.1"/);
      expect(dbFactory).not.toHaveBeenCalled();
    }
  });

  test("AllPrices' head meta 4.x is refused while Meta.json says 5.x", async () => {
    for (const target of targets) {
      const { deps: d, dbFactory } = deps(
        fixtureFiles(STANDARD_CARDS, {
          pricesMeta: { date: RUN_DATE, version: "4.0.0" },
        }),
        null,
      );
      await expect(
        runBulkIngest({ target, identifiersOnly: false }, d),
      ).rejects.toThrow(/AllPrices\.json\.gz: meta\.version "4\.0\.0"/);
      expect(dbFactory).not.toHaveBeenCalled();
    }
  });

  test("a missing file is refused, naming it", async () => {
    const files: Partial<ReturnType<typeof fixtureFiles>> = fixtureFiles();
    delete files[ALL_PRICES_FILE];
    const { deps: d, dbFactory } = deps(
      files as ReturnType<typeof fixtureFiles>,
      null,
    );
    await expect(
      runBulkIngest({ target: LOCAL, identifiersOnly: false }, d),
    ).rejects.toThrow(/AllPrices\.json\.gz is missing/);
    expect(dbFactory).not.toHaveBeenCalled();
  });

  test("a truncated .gz is refused by the integrity pass before any database call", async () => {
    const files = fixtureFiles();
    files[ALL_PRICES_FILE] = files[ALL_PRICES_FILE].subarray(
      0,
      files[ALL_PRICES_FILE].length - 10,
    );
    const { deps: d, dbFactory } = deps(files, null);
    const run = runBulkIngest({ target: LOCAL, identifiersOnly: false }, d);
    await expect(run).rejects.toBeInstanceOf(IngestRefusedError);
    expect(dbFactory).not.toHaveBeenCalled();
  });

  test("a Meta.json dated differently from AllPrices is reported, not refused", async () => {
    const { deps: d } = deps(
      fixtureFiles(STANDARD_CARDS, {
        meta: { date: "2026-10-04", version: META.version },
      }),
      null,
    );
    const { report } = await runBulkIngest(
      { target: { kind: "dry-run" }, identifiersOnly: false },
      d,
    );
    expect(report.warnings.join("\n")).toMatch(
      /Meta\.json is dated 2026-10-04/,
    );
  });

  test("an AllPrices dated more than a day before runDate is warned about", async () => {
    const old = { date: "2026-10-03", version: META.version };
    const { deps: d } = deps(
      fixtureFiles(STANDARD_CARDS, { meta: old, pricesMeta: old }),
      null,
    );
    const { report } = await runBulkIngest(
      { target: { kind: "dry-run" }, identifiersOnly: false },
      d,
    );
    expect(report.warnings.join("\n")).toMatch(
      /more than one day before runDate/,
    );
  });
});

describe("the budget (T11, AC-9; S0.2d15)", () => {
  const precheck = async (size: number, empty: boolean) => {
    const db = new FakeDb({ sizes: [size], empty });
    const { deps: d } = deps(fixtureFiles(), db);
    const result = await runBulkIngest(
      { target: LOCAL, identifiersOnly: false },
      d,
    ).then(
      (r) => r.exitCode,
      (e: unknown) => e,
    );
    return { db, result };
  };

  test.each([
    [160_000_001, true, "refused"],
    [160_000_000, true, "allowed"],
    [300_000_000, false, "allowed"],
    [400_000_001, false, "refused"],
    [400_000_000, false, "allowed"],
  ] as const)(
    "size %s with price_history empty=%s is %s",
    async (size, empty, outcome) => {
      const { db, result } = await precheck(size, empty);
      if (outcome === "refused") {
        expect(result).toBeInstanceOf(IngestRefusedError);
        expect(db.matching(/^INSERT|^UPDATE|^DELETE/)).toEqual([]);
        expect(db.ended).toBe(true);
      } else {
        expect(result).toBe(EXIT.ok);
        expect(db.matching(/INSERT INTO "price_sync_runs"/)).toHaveLength(1);
      }
    },
  );

  test("the pre-check applies on the production target too (pure input, fake Db)", async () => {
    const db = new FakeDb({ sizes: [160_000_001], empty: true });
    const { deps: d } = deps(fixtureFiles(), db);
    await expect(
      runBulkIngest({ target: PRODUCTION, identifiersOnly: false }, d),
    ).rejects.toThrow(/a first run needs 340\.0 MB/);
    expect(db.matching(/^INSERT/)).toEqual([]);
  });

  /** 10 identifier chunks + 110 price chunks = 120 chunks of one row. */
  const recheck = async (
    sizes: number[],
    cards = manyCards(10, 11),
    identifiersOnly = false,
  ) => {
    const db = new FakeDb({ sizes, empty: true });
    const log = vi.fn();
    const { deps: d } = deps(fixtureFiles(cards), db, { chunkRows: 1, log });
    const result = await runBulkIngest({ target: LOCAL, identifiersOnly }, d);
    const upsert = /unnest/;
    const sizeReads = db
      .indexesOf(/pg_database_size/)
      .map(
        (at) =>
          db.statements.slice(0, at).filter((s) => upsert.test(s.text)).length,
      );
    return { db, result, sizeReads, log };
  };

  test("size is read after chunk 50 and 100 and not between", async () => {
    const { result, sizeReads, db } = await recheck([100_000_000]);
    expect(result.exitCode).toBe(EXIT.ok);
    expect(db.matching(/unnest/)).toHaveLength(120);
    // pre-check, after chunk 50, after chunk 100, then the finish
    expect(sizeReads).toEqual([0, 50, 100, 120]);
  });

  test("identifier chunks count toward the cadence", async () => {
    const cards = manyCards(60, 1).map((c) => ({ ...c, unpriced: true }));
    const { sizeReads, db } = await recheck([100_000_000], cards, true);
    expect(db.matching(/INSERT INTO "mtgjson_identifiers"/)).toHaveLength(60);
    expect(sizeReads).toEqual([0, 50, 60]);
  });

  test("450,000,000 at a re-check continues", async () => {
    const { result } = await recheck([100_000_000, 450_000_000]);
    expect(result.exitCode).toBe(EXIT.ok);
    expect(result.report.write?.status).toBe("ok");
  });

  test("450,000,001 at chunk 50 stops: no further upsert, the prune runs, the run row ends budget_stop, exit 3", async () => {
    const { result, db } = await recheck([
      100_000_000, 450_000_001, 450_000_002,
    ]);
    expect(result.exitCode).toBe(EXIT.budgetStop);
    expect(db.matching(/unnest/)).toHaveLength(50);
    const afterStop = db.statements.slice(
      db.indexesOf(/pg_database_size/)[1] + 1,
    );
    expect(afterStop.some((s) => /unnest/.test(s.text))).toBe(false);
    expect(
      afterStop.some((s) => /^DELETE FROM "price_history"/.test(s.text)),
    ).toBe(true);
    const finish = db.matching(/^UPDATE "price_sync_runs"/);
    expect(finish).toHaveLength(1);
    expect(finish[0].values[1]).toBe("budget_stop");
    expect(finish[0].values[5]).toBe(450_000_002);
    expect(result.report.write?.status).toBe("budget_stop");
  });

  test("over 400 MB at a re-check logs a warning and continues", async () => {
    const { result, log } = await recheck([
      100_000_000, 420_000_000, 300_000_000,
    ]);
    expect(result.exitCode).toBe(EXIT.ok);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^warning: database is 420\.0 MB after chunk 50/),
    );
    expect(result.report.warnings).toHaveLength(1);
  });
});

describe("write-run faults (T13's unit half, AC-10)", () => {
  test("a fault on the second price chunk ends the run row error and rejects", async () => {
    const db = new FakeDb({
      failOn: {
        match: /INSERT INTO "price_history"/,
        nth: 2,
        error: new Error("connection lost to postgres://u:pw@h/db"),
      },
    });
    const { deps: d } = deps(fixtureFiles(), db, { chunkRows: 3 });
    await expect(
      runBulkIngest({ target: LOCAL, identifiersOnly: false }, d),
    ).rejects.toThrow(/connection lost/);
    const finish = db.matching(/^UPDATE "price_sync_runs"/);
    expect(finish).toHaveLength(1);
    expect(finish[0].values[1]).toBe("error");
    expect(finish[0].values[6]).toBe(
      "Error: connection lost to [redacted url]",
    );
    expect(db.ended).toBe(true);
  });

  test("a database factory that fails (a certificate error) is a refusal with no run row", async () => {
    const source = createFixtureSource(fixtureFiles());
    const run = runBulkIngest(
      { target: PRODUCTION, identifiersOnly: false },
      {
        source,
        now: () => NOW,
        dbFactory: async () => {
          throw Object.assign(
            new Error("self-signed certificate in certificate chain"),
            {
              code: "SELF_SIGNED_CERT_IN_CHAIN",
            },
          );
        },
      },
    );
    await expect(run).rejects.toBeInstanceOf(IngestRefusedError);
    await expect(run).rejects.toThrow(/certificate/);
  });

  test("--basis-sample on a write target is refused", async () => {
    const { deps: d, dbFactory } = deps(fixtureFiles(), null);
    await expect(
      runBulkIngest(
        { target: LOCAL, identifiersOnly: false, basisSample: { size: 5 } },
        d,
      ),
    ).rejects.toBeInstanceOf(IngestRefusedError);
    expect(dbFactory).not.toHaveBeenCalled();
  });

  test("Meta.json is opened before anything else", async () => {
    const { deps: d, source } = deps(fixtureFiles(), null);
    await runBulkIngest(
      { target: { kind: "dry-run" }, identifiersOnly: false },
      d,
    );
    expect(source.opened[0]).toBe(META_FILE);
  });
});
