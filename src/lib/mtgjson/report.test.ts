// T9 (AC-6; S0.2d19): the report's stable labels, the 31 window dates with
// gaps marked MISSING, the staleness warning, and nothing secret in it.
import { describe, expect, test } from "vitest";
import {
  fixtureFiles,
  META,
  NOW,
  RUN_DATE,
  STANDARD_CARDS,
  WINDOW_START,
} from "./__fixtures__/build";
import { FakeDb } from "./__fixtures__/fake-db";
import {
  PROJECTED_BYTES_PER_IDENTIFIER_ROW,
  PROJECTED_BYTES_PER_PRICE_ROW,
} from "./consts";
import type { IngestDb } from "./db";
import { runBulkIngest, type IngestReport } from "./ingest";
import {
  formatReport,
  missingDates,
  projectedBytes,
  rowsPerDay,
} from "./report";
import { createFixtureSource } from "./source";
import type { IngestTarget } from "./target";
import { windowDates } from "./transform";

const PRODUCTION: IngestTarget = {
  kind: "production",
  url: "postgresql://postgres:hunter2secret@db.example.supabase.co:5432/postgres",
  display: "db.example.supabase.co:5432/postgres",
  caCert: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
};

async function reportFor(
  target: IngestTarget = { kind: "dry-run" },
  files = fixtureFiles(),
  identifiersOnly = false,
): Promise<IngestReport> {
  const db = new FakeDb();
  const { report } = await runBulkIngest(
    { target, identifiersOnly },
    {
      source: createFixtureSource(files),
      now: () => NOW,
      dbFactory: async () => db as unknown as IngestDb,
      peakRssBytes: () => 279_000_000,
    },
  );
  return report;
}

describe("the ingest report (T9, AC-6)", () => {
  test("has a stable label for every AC-6 field", async () => {
    const text = formatReport(await reportFor());
    for (const label of [
      "rows by finish: normal 15, foil 3, etched 3 (total 21)",
      "distinct series: 7",
      "distinct printings: 6",
      "gate: rank only 2, price only 3, both 2, dropped 2, no valid price 0",
      "unmappedUuids: 1",
      "scryfallCollisions: 1",
      "collisionLosses: 0",
      "invalidPrices: 0",
      "invalidDates: 0",
      "duplicateUuids: 0",
      "rows per date:",
      "projected bytes:",
      "peak RSS: 279.0 MB",
      "duration:",
      "source meta:",
      `  AllPrices.json.gz: date ${META.date}, version ${META.version}`,
      `  Meta.json: date ${META.date}, version ${META.version}`,
      `  AllIdentifiers.json.gz: date ${META.date}, version ${META.version}`,
      "identifiers: read 9, stored 9, printings 8, invalidIdentifiers 0",
      `run date (UTC): ${RUN_DATE} (window ${WINDOW_START} to ${RUN_DATE})`,
    ]) {
      expect(text).toContain(label);
    }
  });

  test("lists all 31 window dates, marks gaps MISSING and lists them", async () => {
    const report = await reportFor();
    const text = formatReport(report);
    const dates = windowDates(RUN_DATE);
    for (const date of dates)
      expect(text).toMatch(new RegExp(`^  ${date}  `, "m"));
    expect(text).toContain(`  ${WINDOW_START}  7`);
    expect(text).toContain("  2026-09-06  MISSING");
    expect(missingDates(report)).toHaveLength(28);
    expect(text).toMatch(/^ {2}missing dates: 2026-09-06, 2026-09-07, /m);
    expect(rowsPerDay(report)).toEqual({ date: RUN_DATE, rows: 7 });
    expect(text).toContain(`rows/day (newest date ${RUN_DATE}): 7`);
  });

  test("projects bytes from the per-row constants, in MB", async () => {
    const report = await reportFor();
    expect(projectedBytes(21, 9)).toEqual({
      prices: 21 * PROJECTED_BYTES_PER_PRICE_ROW,
      identifiers: 9 * PROJECTED_BYTES_PER_IDENTIFIER_ROW,
      total:
        21 * PROJECTED_BYTES_PER_PRICE_ROW +
        9 * PROJECTED_BYTES_PER_IDENTIFIER_ROW,
    });
    expect(formatReport(report)).toMatch(
      new RegExp(
        `projected bytes: price rows 21 x ${PROJECTED_BYTES_PER_PRICE_ROW} B = 0\\.0 MB`,
      ),
    );
  });

  test("warns when AllPrices' date is more than one day before runDate", async () => {
    const old = { date: "2026-10-03", version: META.version };
    const text = formatReport(
      await reportFor(
        { kind: "dry-run" },
        fixtureFiles(STANDARD_CARDS, { meta: old, pricesMeta: old }),
      ),
    );
    expect(text).toMatch(/warning|warnings:/);
    expect(text).toContain(
      "AllPrices.json.gz is dated 2026-10-03, more than one day before runDate 2026-10-05",
    );
    const fresh = formatReport(await reportFor());
    expect(fresh).toContain("warnings: none");
  });

  test("a write run adds rows written, rows pruned, db bytes and the status", async () => {
    const text = formatReport(
      await reportFor({
        kind: "local",
        url: "postgresql://localhost/x",
        display: "localhost:5432/x",
      }),
    );
    expect(text).toContain("write: status ok, run id 1");
    expect(text).toMatch(
      /rows written: 21 \(price rows 21, identifier rows 9\)/,
    );
    expect(text).toContain("rows pruned: 0");
    expect(text).toMatch(/db bytes: before 100\.0 MB, after 100\.0 MB/);
  });

  test("--identifiers-only reports identifier counts and no price section", async () => {
    const text = formatReport(
      await reportFor({ kind: "dry-run" }, fixtureFiles(), true),
    );
    expect(text).toContain("mode: dry-run (identifiers only)");
    expect(text).not.toContain("rows by finish");
    expect(text).toMatch(/projected bytes: identifiers 9 x/);
  });

  test("never contains a URL, a password or ALLOW_PROD_INGEST", async () => {
    for (const target of [{ kind: "dry-run" } as IngestTarget, PRODUCTION]) {
      const text = formatReport(await reportFor(target));
      expect(text).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);
      expect(text).not.toContain("hunter2secret");
      expect(text).not.toContain("postgres:");
      expect(text).not.toContain("ALLOW_PROD_INGEST");
      expect(text).not.toContain("BEGIN CERTIFICATE");
    }
  });
});
