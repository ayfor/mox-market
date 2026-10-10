// T18 (AC-11): the generated baseline, checked as text. Byte equality with a
// fresh diff is shown once in the plan's Session Log, because the diff from
// empty changes as soon as S0.1 edits the schema.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const MIGRATIONS = path.resolve(__dirname, "migrations");
const sql = readFileSync(
  path.join(MIGRATIONS, "0000_baseline", "migration.sql"),
  "utf8",
);

describe("0000_baseline", () => {
  test("creates both V1 tables, the index and the cascading FK", () => {
    expect(sql).toContain('CREATE TABLE "tracked_cards"');
    expect(sql).toContain('CREATE TABLE "price_snapshots"');
    expect(sql).toContain(
      'CREATE INDEX "price_snapshots_card_id_timestamp_idx" ON "price_snapshots"("card_id", "timestamp");',
    );
    expect(sql).toMatch(
      /ADD CONSTRAINT "price_snapshots_card_id_fkey" FOREIGN KEY \("card_id"\) REFERENCES "tracked_cards"\("id"\) ON DELETE CASCADE/,
    );
  });

  test("is purely additive: no DROP, RENAME or ALTER COLUMN", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bRENAME\b/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
  });

  test("is pure SQL (no CLI banner leaked in from stdout)", () => {
    expect(sql).not.toMatch(
      /Loaded Prisma config|prisma\.config\.ts|Update available/,
    );
    expect(sql.trimStart().startsWith("-- CreateSchema")).toBe(true);
  });

  test("migration_lock.toml names postgresql", () => {
    const lock = readFileSync(
      path.join(MIGRATIONS, "migration_lock.toml"),
      "utf8",
    );
    expect(lock).toMatch(/^provider = "postgresql"$/m);
  });

  test("exactly one migration directory starts 0000_", () => {
    const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs.filter((d) => d.startsWith("0000_"))).toEqual([
      "0000_baseline",
    ]);
  });
});
