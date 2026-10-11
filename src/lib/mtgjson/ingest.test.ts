// T8 (AC-4, AC-6; S0.2d5, S0.2d18) the dry-run and the version checks, and
// T11 (AC-9; S0.2d15) the budget, all on fixture sources and a fake Db: no
// network, no database. The production target here is a plain object (pure
// input, S0.2d24); its database factory is a spy that is never allowed to
// connect.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  allIdentifiersJson,
  allPricesJson,
  fixtureFiles,
  gz,
  manyCards,
  META,
  NOW,
  RUN_DATE,
  shift,
  STANDARD_CARDS,
  type CardFixture,
} from "./__fixtures__/build";
import { FakeDb } from "./__fixtures__/fake-db";
import { ALL_IDENTIFIERS_FILE, ALL_PRICES_FILE, META_FILE } from "./consts";
import type { IngestDb } from "./db";
import {
  EXIT,
  IngestInterruptedError,
  NothingToWriteError,
  runBulkIngest,
  type IngestDeps,
} from "./ingest";
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
      keptNoWindowRows: 0,
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

const ALL_KINDS = ["dry-run", "local", "production"] as const;
const targetOf = (kind: (typeof ALL_KINDS)[number]): IngestTarget =>
  kind === "dry-run"
    ? { kind: "dry-run" }
    : kind === "local"
      ? LOCAL
      : PRODUCTION;

describe("a source with nothing to store never ends ok (ADV.1)", () => {
  test.each(ALL_KINDS)(
    "AllPrices with no data object is refused before any database call (%s)",
    async (kind) => {
      const files = fixtureFiles();
      files[ALL_PRICES_FILE] = gz(JSON.stringify({ meta: META }));
      const { deps: d, dbFactory } = deps(files, null);
      const run = runBulkIngest(
        { target: targetOf(kind), identifiersOnly: false },
        d,
      );
      await expect(run).rejects.toBeInstanceOf(IngestRefusedError);
      await expect(run).rejects.toThrow(
        /AllPrices\.json\.gz: no data object; stopped before any database write/,
      );
      expect(dbFactory).not.toHaveBeenCalled();
    },
  );

  test.each([false, true])(
    "AllIdentifiers with no data object is refused (identifiersOnly=%s)",
    async (identifiersOnly) => {
      const files = fixtureFiles();
      files[ALL_IDENTIFIERS_FILE] = gz(JSON.stringify({ meta: META }));
      const { deps: d, dbFactory } = deps(files, null);
      await expect(
        runBulkIngest({ target: LOCAL, identifiersOnly }, d),
      ).rejects.toThrow(/AllIdentifiers\.json\.gz: no data object/);
      expect(dbFactory).not.toHaveBeenCalled();
    },
  );

  test("a data object that does not follow meta is refused", async () => {
    const files = fixtureFiles();
    const text = allPricesJson(STANDARD_CARDS);
    files[ALL_PRICES_FILE] = gz(
      text.replace(/^\{"meta":(\{[^}]*\}),/, '{"meta":$1,"other":1,'),
    );
    const { deps: d, dbFactory } = deps(files, null);
    await expect(
      runBulkIngest({ target: LOCAL, identifiersOnly: false }, d),
    ).rejects.toThrow(/no data object after meta \(found "other"\)/);
    expect(dbFactory).not.toHaveBeenCalled();
  });

  test.each(["local", "production"] as const)(
    "AllPrices with an empty data object ends the run row error: no price statement, no prune, no ok (%s)",
    async (kind) => {
      const files = fixtureFiles();
      files[ALL_PRICES_FILE] = gz(JSON.stringify({ meta: META, data: {} }));
      const db = new FakeDb();
      const { deps: d } = deps(files, db);
      const run = runBulkIngest(
        { target: targetOf(kind), identifiersOnly: false },
        d,
      );
      await expect(run).rejects.toBeInstanceOf(NothingToWriteError);
      expect(db.matching(/INSERT INTO "price_history"/)).toEqual([]);
      expect(db.matching(/^DELETE/)).toEqual([]);
      expect(db.matching(/^ANALYZE/)).toEqual([]);
      const finish = db.matching(/^UPDATE "price_sync_runs"/);
      expect(finish).toHaveLength(1);
      expect(finish[0].values[1]).toBe("error");
      expect(finish[0].values[6]).toMatch(
        /^NothingToWriteError: no price rows emitted \(0 price entries/,
      );
      expect(db.ended).toBe(true);
    },
  );

  test("every AllPrices UUID unmapped ends the run row error with no prune", async () => {
    const files = fixtureFiles();
    files[ALL_IDENTIFIERS_FILE] = gz(allIdentifiersJson(manyCards(3, 1)));
    const db = new FakeDb();
    const { deps: d } = deps(files, db);
    await expect(
      runBulkIngest({ target: LOCAL, identifiersOnly: false }, d),
    ).rejects.toThrow(
      /no price rows emitted \(\d+ price entries, \d+ unmapped\)/,
    );
    expect(db.matching(/^DELETE/)).toEqual([]);
    expect(
      db.matching(/^UPDATE "price_sync_runs"/).map((s) => s.values[1]),
    ).toEqual(["error"]);
  });

  test("a dry-run over an empty data object warns that a write run would end error", async () => {
    const files = fixtureFiles();
    files[ALL_PRICES_FILE] = gz(JSON.stringify({ meta: META, data: {} }));
    const { deps: d } = deps(files, null);
    const { exitCode, report } = await runBulkIngest(
      { target: { kind: "dry-run" }, identifiersOnly: false },
      d,
    );
    expect(exitCode).toBe(EXIT.ok);
    expect(report.warnings).toEqual([
      "no price rows emitted: a write run with these files would end error",
    ]);
  });

  test.each(
    ALL_KINDS.flatMap((k) => [[k, false] as const, [k, true] as const]),
  )(
    "AllIdentifiers whose entries lack identifiers.scryfallId is refused, identifiers not loaded (%s, identifiersOnly=%s)",
    async (kind, identifiersOnly) => {
      const files = fixtureFiles();
      files[ALL_IDENTIFIERS_FILE] = gz(
        allIdentifiersJson(STANDARD_CARDS).replaceAll(
          '"scryfallId"',
          '"scryfallID"',
        ),
      );
      const { deps: d, dbFactory } = deps(files, null);
      const run = runBulkIngest({ target: targetOf(kind), identifiersOnly }, d);
      await expect(run).rejects.toBeInstanceOf(IngestRefusedError);
      await expect(run).rejects.toThrow(
        /AllIdentifiers\.json\.gz: identifiers not loaded \(0 usable entries; 9 invalid\)/,
      );
      expect(dbFactory).not.toHaveBeenCalled();
    },
  );
});

describe("source dates (ADV.2)", () => {
  const dated = (date: unknown) => ({ date, version: META.version });
  const files = (meta: unknown, data: unknown = meta) =>
    fixtureFiles(STANDARD_CARDS, {
      meta: dated(meta),
      identifiersMeta: dated(data),
      pricesMeta: dated(data),
    });

  test("path C refuses an AllPrices more than one day older than runDate, before any database call", async () => {
    const { deps: d, dbFactory } = deps(files("2026-10-01"), null);
    const run = runBulkIngest(
      { target: PRODUCTION, identifiersOnly: false },
      d,
    );
    await expect(run).rejects.toBeInstanceOf(IngestRefusedError);
    await expect(run).rejects.toThrow(
      /AllPrices\.json\.gz is dated 2026-10-01, more than one day before runDate 2026-10-05\. Path C loads only a current source/,
    );
    expect(dbFactory).not.toHaveBeenCalled();
  });

  test.each(["dry-run", "local"] as const)(
    "the same files still run on %s, with the warning",
    async (kind) => {
      const { deps: d } = deps(files("2026-10-01"));
      const { exitCode, report } = await runBulkIngest(
        { target: targetOf(kind), identifiersOnly: false },
        d,
      );
      expect(exitCode).toBe(EXIT.ok);
      expect(report.warnings).toEqual([
        "AllPrices.json.gz is dated 2026-10-01, more than one day before runDate 2026-10-05",
      ]);
    },
  );

  test("path C refuses a Meta.json dated differently from AllPrices", async () => {
    const { deps: d, dbFactory } = deps(files("2026-10-04", RUN_DATE), null);
    await expect(
      runBulkIngest({ target: PRODUCTION, identifiersOnly: false }, d),
    ).rejects.toThrow(
      /Meta\.json is dated 2026-10-04, AllPrices\.json\.gz 2026-10-05/,
    );
    expect(dbFactory).not.toHaveBeenCalled();
  });

  test.each([null, "latest", "2026-02-30"])(
    "path C refuses an AllPrices meta.date of %s",
    async (date) => {
      const { deps: d, dbFactory } = deps(files(date), null);
      await expect(
        runBulkIngest({ target: PRODUCTION, identifiersOnly: false }, d),
      ).rejects.toThrow(/is not a calendar date; path C needs a dated source/);
      expect(dbFactory).not.toHaveBeenCalled();
    },
  );

  test("path C accepts files dated one day before runDate (MTGJson publishes after the UTC day starts)", async () => {
    const db = new FakeDb();
    const { deps: d } = deps(files("2026-10-04"), db);
    const { exitCode, report } = await runBulkIngest(
      { target: PRODUCTION, identifiersOnly: false },
      d,
    );
    expect(exitCode).toBe(EXIT.ok);
    expect(report.warnings).toEqual([]);
  });

  test("--identifiers-only on path C refuses a Meta.json mismatch but not age", async () => {
    const refused = deps(files("2026-10-04", RUN_DATE), null);
    await expect(
      runBulkIngest(
        { target: PRODUCTION, identifiersOnly: true },
        refused.deps,
      ),
    ).rejects.toThrow(
      /Meta\.json is dated 2026-10-04, AllIdentifiers\.json\.gz 2026-10-05/,
    );
    expect(refused.dbFactory).not.toHaveBeenCalled();
    const { deps: d } = deps(files("2026-09-20"), new FakeDb());
    const { exitCode } = await runBulkIngest(
      { target: PRODUCTION, identifiersOnly: true },
      d,
    );
    expect(exitCode).toBe(EXIT.ok);
  });
});

describe("interrupts, and a run row that cannot be finished (ADV.4)", () => {
  test("a fault whose finish also fails rejects with the original error and logs, redacted, that the row stays running", async () => {
    const db = new FakeDb({
      failOn: [
        {
          match: /INSERT INTO "price_history"/,
          nth: 2,
          error: new Error("connection lost to postgres://u:pw-1@h/db"),
        },
        {
          match: /^UPDATE "price_sync_runs"/,
          nth: 1,
          error: new Error("Connection terminated at u:pw-2@h:5432/db"),
        },
      ],
    });
    const log = vi.fn();
    const { deps: d } = deps(fixtureFiles(), db, { chunkRows: 3, log });
    const run = runBulkIngest({ target: LOCAL, identifiersOnly: false }, d);
    await expect(run).rejects.toThrow(/^connection lost to/);
    const lines = log.mock.calls.map((c) => String(c[0]));
    const line = lines.find((l) => /could not be finished/.test(l));
    expect(line).toMatch(
      /^the run row could not be finished, so it stays running until S0\.3 marks it error\. Cause: Error: Connection terminated at \[redacted url\]$/,
    );
    expect(lines.join("\n")).not.toMatch(/pw-1|pw-2/);
    expect(db.matching(/^UPDATE "price_sync_runs"/)).toHaveLength(1);
    expect(db.ended).toBe(true);
  });

  test("an abort after the first price chunk finishes the row error (interrupted), with no prune", async () => {
    const controller = new AbortController();
    let priceChunks = 0;
    const db = new FakeDb({
      onStatement: (s) => {
        if (/INSERT INTO "price_history"/.test(s.text) && ++priceChunks === 1) {
          controller.abort("SIGINT");
        }
      },
    });
    const onRunStarted = vi.fn();
    const { deps: d } = deps(fixtureFiles(), db, {
      chunkRows: 3,
      signal: controller.signal,
      onRunStarted,
    });
    const run = runBulkIngest({ target: LOCAL, identifiersOnly: false }, d);
    await expect(run).rejects.toBeInstanceOf(IngestInterruptedError);
    expect(onRunStarted).toHaveBeenCalledWith(1);
    expect(db.matching(/INSERT INTO "price_history"/)).toHaveLength(1);
    expect(db.matching(/^DELETE/)).toEqual([]);
    const finish = db.matching(/^UPDATE "price_sync_runs"/);
    expect(finish).toHaveLength(1);
    expect(finish[0].values[1]).toBe("error");
    expect(finish[0].values[6]).toBe(
      "IngestInterruptedError: interrupted by SIGINT",
    );
  });

  test("an abort before the run row is never wrapped as a refusal and calls no factory", async () => {
    const controller = new AbortController();
    controller.abort("SIGTERM");
    const { deps: d, dbFactory } = deps(fixtureFiles(), null, {
      signal: controller.signal,
    });
    await expect(
      runBulkIngest({ target: LOCAL, identifiersOnly: false }, d),
    ).rejects.toThrow(/^interrupted by SIGTERM$/);
    expect(dbFactory).not.toHaveBeenCalled();
  });
});

describe("runDate at the UTC date boundary on a Toronto clock (ADV.6)", () => {
  const savedTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Toronto";
  });
  afterAll(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  const card = (prices: Record<string, number>): CardFixture => ({
    ...manyCards(1, 1)[0],
    retail: { normal: prices },
  });

  test("the harness really is on Toronto time (22:30 ET on 2026-10-05)", () => {
    const now = new Date("2026-10-06T02:30:00Z");
    expect(now.getDate()).toBe(5);
    expect(now.getHours()).toBe(22);
  });

  test("NOW 2026-10-06T02:30Z runs as 2026-10-06: window from 2026-09-06, 2026-09-05 not emitted, prune at 2026-10-06", async () => {
    const db = new FakeDb();
    const { deps: d } = deps(
      fixtureFiles([
        card({ "2026-09-05": 2, "2026-09-06": 2, "2026-10-06": 2 }),
      ]),
      db,
      { now: () => new Date("2026-10-06T02:30:00Z") },
    );
    const { report } = await runBulkIngest(
      { target: LOCAL, identifiersOnly: false },
      d,
    );
    expect(report.runDate).toBe("2026-10-06");
    expect([...report.prices!.rowsByDate.keys()].sort()).toEqual([
      "2026-09-06",
      "2026-10-06",
    ]);
    const [insert] = db.matching(/INSERT INTO "price_history"/);
    expect(insert.values[2]).toEqual(["2026-09-06", "2026-10-06"]);
    const [prune] = db.matching(/^DELETE FROM "price_history"/);
    expect(prune.values[0]).toBe("2026-10-06");
  });

  test.each([
    ["2026-10-06T00:00:00.000Z", "2026-10-06"],
    ["2026-10-05T23:59:59.999Z", "2026-10-05"],
  ])("NOW %s runs as %s", async (now, runDate) => {
    const { deps: d } = deps(fixtureFiles([card({ [RUN_DATE]: 2 })]), null, {
      now: () => new Date(now),
    });
    const { report } = await runBulkIngest(
      { target: { kind: "dry-run" }, identifiersOnly: false },
      d,
    );
    expect(report.runDate).toBe(runDate);
    expect(shift(report.runDate, -30)).toBe(
      runDate === "2026-10-06" ? "2026-09-06" : "2026-09-05",
    );
  });
});

describe("budget stops outside the price stage, and the final size (ADV.8, ADV.12)", () => {
  const run = async (
    sizes: number[],
    cards: readonly CardFixture[],
    identifiersOnly = false,
  ) => {
    const db = new FakeDb({ sizes, empty: true });
    const log = vi.fn();
    const { deps: d } = deps(fixtureFiles(cards), db, { chunkRows: 1, log });
    const result = await runBulkIngest({ target: LOCAL, identifiersOnly }, d);
    return { db, result, log };
  };

  test("a stop during the identifier stage: 50 identifier chunks, no price chunk, the prune, budget_stop, exit 3", async () => {
    const { db, result } = await run(
      [100_000_000, 450_000_001],
      manyCards(60, 1),
    );
    expect(result.exitCode).toBe(EXIT.budgetStop);
    expect(db.matching(/INSERT INTO "mtgjson_identifiers"/)).toHaveLength(50);
    expect(db.matching(/INSERT INTO "price_history"/)).toHaveLength(0);
    expect(db.matching(/^DELETE FROM "price_history"/)).toHaveLength(1);
    expect(db.matching(/^ANALYZE/).map((s) => s.text)).toEqual([
      'ANALYZE "price_history", "mtgjson_identifiers"',
    ]);
    const finish = db.matching(/^UPDATE "price_sync_runs"/);
    expect(finish).toHaveLength(1);
    expect(finish[0].values[1]).toBe("budget_stop");
  });

  test("the same stop on --identifiers-only: no DELETE, ANALYZE on mtgjson_identifiers only", async () => {
    const { db, result } = await run(
      [100_000_000, 450_000_001],
      manyCards(60, 1),
      true,
    );
    expect(result.exitCode).toBe(EXIT.budgetStop);
    expect(db.matching(/INSERT INTO "mtgjson_identifiers"/)).toHaveLength(50);
    expect(db.matching(/^DELETE/)).toEqual([]);
    expect(db.matching(/^ANALYZE/).map((s) => s.text)).toEqual([
      'ANALYZE "mtgjson_identifiers"',
    ]);
    expect(db.matching(/^UPDATE "price_sync_runs"/)[0].values[1]).toBe(
      "budget_stop",
    );
  });

  test("a final size over 450 MB after the last re-check ends budget_stop, exit 3", async () => {
    // 10 identifier + 110 price chunks: the re-checks after chunks 50 and 100
    // read 399 MB; 20 trailing chunks later the final read is over 450 MB.
    const { db, result, log } = await run(
      [100_000_000, 399_000_000, 399_000_000, 450_000_001],
      manyCards(10, 11),
    );
    expect(result.exitCode).toBe(EXIT.budgetStop);
    expect(db.matching(/unnest/)).toHaveLength(120);
    const finish = db.matching(/^UPDATE "price_sync_runs"/);
    expect(finish[0].values[1]).toBe("budget_stop");
    expect(finish[0].values[5]).toBe(450_000_001);
    expect(log).toHaveBeenCalledWith(
      "warning: database is 450.0 MB at the end of the run, over 450.0 MB: budget_stop",
    );
  });

  test("a final size over 400 MB warns once and ends ok", async () => {
    const { result } = await run(
      [100_000_000, 399_000_000, 399_000_000, 400_000_001],
      manyCards(10, 11),
    );
    expect(result.exitCode).toBe(EXIT.ok);
    expect(result.report.warnings).toEqual([
      "database is 400.0 MB at the end of the run, over 400.0 MB",
    ]);
  });

  test("a run that already warned over 400 MB at a re-check does not warn again at the end", async () => {
    const { result } = await run(
      [100_000_000, 420_000_000, 420_000_000, 420_000_000],
      manyCards(10, 11),
    );
    expect(result.report.warnings).toHaveLength(2);
    expect(result.report.warnings.join("\n")).not.toMatch(/end of the run/);
  });
});

describe("ANALYZE and the integrity pass (ADV.16, ADV.17)", () => {
  test("a bulk run ANALYZEs both tables after the prune; --identifiers-only only mtgjson_identifiers", async () => {
    const bulk = new FakeDb();
    await runBulkIngest(
      { target: LOCAL, identifiersOnly: false },
      deps(fixtureFiles(), bulk).deps,
    );
    const prune = bulk.indexesOf(/^DELETE FROM "price_history"/);
    const analyze = bulk.indexesOf(/^ANALYZE/);
    expect(analyze).toHaveLength(1);
    expect(analyze[0]).toBeGreaterThan(prune[0]);
    expect(bulk.statements[analyze[0]].text).toBe(
      'ANALYZE "price_history", "mtgjson_identifiers"',
    );
    const ids = new FakeDb();
    await runBulkIngest(
      { target: LOCAL, identifiersOnly: true },
      deps(fixtureFiles(), ids).deps,
    );
    expect(ids.matching(/^ANALYZE/).map((s) => s.text)).toEqual([
      'ANALYZE "mtgjson_identifiers"',
    ]);
  });

  test.each([false, true])(
    "a truncated AllIdentifiers is refused by the integrity pass before it is parsed (identifiersOnly=%s)",
    async (identifiersOnly) => {
      const files = fixtureFiles();
      const bytes = files[ALL_IDENTIFIERS_FILE];
      files[ALL_IDENTIFIERS_FILE] = bytes.subarray(0, bytes.length - 10);
      const { deps: d, dbFactory, source } = deps(files, null);
      const run = runBulkIngest({ target: LOCAL, identifiersOnly }, d);
      await expect(run).rejects.toBeInstanceOf(IngestRefusedError);
      await expect(run).rejects.toThrow(/unexpected end of file/);
      expect(dbFactory).not.toHaveBeenCalled();
      // Opened once, for its meta: the integrity pass refused it before the
      // identifier parse could.
      expect(
        source.opened.filter((name) => name === ALL_IDENTIFIERS_FILE),
      ).toHaveLength(1);
    },
  );
});
