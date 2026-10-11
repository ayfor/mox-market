// T1 (AC-1; S0.1d3): 0001_price_history checked as text. Every statement is
// on an allowlist (the generated F0 DDL plus the two hand-added lines), and
// the raw file, comments included, carries nothing destructive. The checker
// is exercised against planted statements so a weakened rule is noticed.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const MIGRATIONS = path.resolve(__dirname, "migrations");
const sql = readFileSync(
  path.join(MIGRATIONS, "0001_price_history", "migration.sql"),
  "utf8",
);

/** F0 §Fields' enums, values in F0's order. */
const ENUMS = [
  `CREATE TYPE "card_finish" AS ENUM ('normal', 'foil', 'etched')`,
  `CREATE TYPE "price_sync_trigger" AS ENUM ('cron', 'bulk', 'identifiers')`,
  `CREATE TYPE "price_sync_status" AS ENUM ('running', 'ok', 'source_stale', 'budget_stop', 'error')`,
];
const TABLES = ["price_history", "mtgjson_identifiers", "price_sync_runs"];
const INDEX = `CREATE INDEX "price_sync_runs_status_finished_at_idx" ON "price_sync_runs"("status", "finished_at")`;
/** S0.1d3: the hand-added block, verbatim. */
const HAND_ADDED = [
  `ALTER TABLE "price_history" ADD CONSTRAINT "price_history_price_cents_check" CHECK ("price_cents" > 0)`,
  `ALTER TABLE "price_history" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02)`,
];

/** Statements with `--` comments stripped, whitespace-trimmed, empty ones dropped. */
function statements(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Which allowlist entry a statement is, or null. */
function allowlisted(statement: string): string | null {
  const flat = statement.replace(/\s+/g, " ");
  for (const e of [...ENUMS, INDEX, ...HAND_ADDED]) {
    if (flat === e) return e;
  }
  const table = flat.match(/^CREATE TABLE "(\w+)" \(/)?.[1];
  if (table !== undefined && TABLES.includes(table)) {
    // A CREATE TABLE body holds columns and constraints only: no second
    // statement can hide in it, because statements split on ';'.
    return `CREATE TABLE "${table}"`;
  }
  return null;
}

/** Everything that makes a migration non-additive or off-list. */
function migrationFindings(text: string): string[] {
  const findings: string[] = [];
  // Raw text, comments included, across line breaks (AC-1).
  if (/\bDROP\b/i.test(text)) findings.push("DROP");
  if (/\bRENAME\b/i.test(text)) findings.push("RENAME");
  if (/\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i.test(text))
    findings.push("ALTER COLUMN … TYPE");
  if (/\bALTER\s+TABLE\b[^;]*?\bDROP\b/i.test(text))
    findings.push("ALTER TABLE … DROP");
  if (/tracked_cards|price_snapshots/i.test(text))
    findings.push("names a V1 table");
  for (const statement of statements(text)) {
    if (allowlisted(statement) === null) {
      findings.push(`off-list: ${statement.replace(/\s+/g, " ").slice(0, 60)}`);
    }
  }
  return findings;
}

describe("0001_price_history (T1)", () => {
  test("every statement is on the allowlist, and each entry appears exactly once", () => {
    const seen = statements(sql).map(allowlisted);
    expect(seen).not.toContain(null);
    expect(seen).toEqual([
      ...ENUMS,
      ...TABLES.map((t) => `CREATE TABLE "${t}"`),
      INDEX,
      ...HAND_ADDED,
    ]);
  });

  test("is purely additive and names no V1 table", () => {
    expect(migrationFindings(sql)).toEqual([]);
  });

  test("the hand-added lines are verbatim", () => {
    for (const line of HAND_ADDED) expect(sql).toContain(`${line};`);
  });

  test("is pure SQL: starts with -- CreateEnum, no CLI banner", () => {
    expect(sql.trimStart().startsWith("-- CreateEnum")).toBe(true);
    expect(sql).not.toMatch(
      /Loaded Prisma config|prisma\.config\.ts|Update available|Prisma schema loaded/,
    );
  });

  test("price_history's key is (scryfall_id, finish, date) and it has no foreign key", () => {
    expect(sql).toContain(
      'CONSTRAINT "price_history_pkey" PRIMARY KEY ("scryfall_id","finish","date")',
    );
    expect(sql).not.toMatch(/FOREIGN KEY|REFERENCES/i);
  });

  test("migration directories are exactly 0000_baseline then 0001_price_history, one per prefix", () => {
    const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual(["0000_baseline", "0001_price_history"]);
    const prefixes = dirs.map((d) => d.slice(0, 4));
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe("the T1 checker notices what it must (negative cases)", () => {
  const planted = (extra: string) => `${sql}\n${extra}\n`;

  test.each([
    ["DROP TABLE x;", "DROP"],
    ["drop index y;", "DROP"],
    ['ALTER TABLE "t" RENAME COLUMN a TO b;', "RENAME"],
    ["ALTER TABLE t ALTER COLUMN c TYPE bigint;", "ALTER COLUMN … TYPE"],
    ["ALTER TABLE t ALTER COLUMN c\n  TYPE bigint;", "ALTER COLUMN … TYPE"],
    ["ALTER TABLE t\nALTER COLUMN c\nTYPE bigint;", "ALTER COLUMN … TYPE"],
    ["ALTER TABLE t DROP CONSTRAINT k;", "ALTER TABLE … DROP"],
    ["-- DROP a comment still counts", "DROP"],
    ['UPDATE "price_history" SET "price_cents" = 1;', "off-list"],
    [
      `INSERT INTO "price_sync_runs" ("trigger", "status") VALUES ('cron', 'ok');`,
      "off-list",
    ],
    ['ALTER TABLE "price_snapshots" ADD COLUMN x int;', "names a V1 table"],
    ['CREATE TABLE "other" ("a" INT);', "off-list"],
  ])("%j → %s", (extra, finding) => {
    const found = migrationFindings(planted(extra));
    expect(found.some((f) => f.startsWith(finding))).toBe(true);
  });

  test("an off-list statement is flagged even in otherwise clean SQL", () => {
    expect(migrationFindings("SELECT 1;")).toEqual(["off-list: SELECT 1"]);
  });
});
