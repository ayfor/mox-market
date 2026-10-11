// T9 (AC-5): docs/architecture/erd.md reflects prisma/schema.prisma. Keeps the
// ERD living: a migration that adds a model, column or relation fails this
// until the ERD is updated in the same branch. S0.1 T11 (AC-9; S0.1d19): five
// tables, the enum table, enum-typed attributes, and the V1 labels.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const SCALARS = new Set([
  "String",
  "Int",
  "BigInt",
  "Float",
  "Decimal",
  "Boolean",
  "DateTime",
  "Json",
  "Bytes",
]);

interface Model {
  name: string;
  table: string;
  columns: string[];
  /** Database enum name per enum-typed column. */
  enumColumns: Record<string, string>;
  /** Tables this model points at through a @relation(fields: …) */
  relationsTo: string[];
}

interface SchemaEnum {
  name: string;
  /** The @@map name, else the Prisma name. */
  dbName: string;
  values: string[];
}

function parseEnums(schema: string): SchemaEnum[] {
  return [...schema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(
    ([, name, body]) => {
      const values: string[] = [];
      for (const raw of body.split("\n")) {
        const line = raw.replace(/\/\/.*$/, "").trim();
        if (!line || line.startsWith("@@")) continue;
        values.push(line.split(/\s+/)[0]);
      }
      const dbName = body.match(/@@map\("([^"]+)"\)/)?.[1] ?? name;
      return { name, dbName, values };
    },
  );
}

function parseSchema(schema: string): Model[] {
  const blocks = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  const tableOf = new Map<string, string>();
  for (const [, name, body] of blocks) {
    tableOf.set(name, body.match(/@@map\("([^"]+)"\)/)?.[1] ?? name);
  }
  const enums = new Map(parseEnums(schema).map((e) => [e.name, e.dbName]));
  return blocks.map(([, name, body]) => {
    const columns: string[] = [];
    const enumColumns: Record<string, string> = {};
    const relationsTo: string[] = [];
    for (const raw of body.split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").trim();
      if (!line || line.startsWith("@@")) continue;
      const field = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
      if (!field) continue;
      const [, fieldName, type, list] = field;
      if (SCALARS.has(type) || enums.has(type)) {
        if (!list) {
          const column = line.match(/@map\("([^"]+)"\)/)?.[1] ?? fieldName;
          columns.push(column);
          if (enums.has(type)) enumColumns[column] = enums.get(type)!;
        }
      } else if (/@relation\([^)]*fields:/.test(line)) {
        relationsTo.push(tableOf.get(type) ?? type);
      }
    }
    return {
      name,
      table: tableOf.get(name)!,
      columns,
      enumColumns,
      relationsTo,
    };
  });
}

function mermaidBlock(markdown: string): string {
  const block = markdown.match(/```mermaid\n([\s\S]*?)```/)?.[1];
  if (!block || !/^\s*erDiagram\b/.test(block))
    throw new Error("no erDiagram block in erd.md");
  return block;
}

/** [type, name] of each attribute line of an entity, or undefined. */
function entityLines(
  block: string,
  table: string,
): [string, string][] | undefined {
  const body = block.match(
    new RegExp(`^\\s*${table}\\s*\\{([\\s\\S]*?)^\\s*\\}`, "m"),
  )?.[1];
  if (body === undefined) return undefined;
  return body
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[0] !== "")
    .map((parts) => [parts[0], parts[1]]);
}

function entityAttributes(block: string, table: string): string[] | undefined {
  return entityLines(block, table)?.map(([, name]) => name);
}

/** erd.md's enum table: database name → values in order. */
function erdEnums(markdown: string): Map<string, string[]> {
  const section = markdown.split(/^## Enums\s*$/m)[1] ?? "";
  const rows = new Map<string, string[]>();
  for (const m of section.matchAll(/^\|\s*`(\w+)`\s*\|\s*(.+?)\s*\|\s*$/gm)) {
    rows.set(
      m[1],
      [...m[2].matchAll(/`([^`]+)`/g)].map((v) => v[1]),
    );
  }
  return rows;
}

/** The Owner cell of a table's row in erd.md's table of tables. */
function ownerOf(markdown: string, table: string): string | undefined {
  return markdown.match(
    new RegExp(`^\\|\\s*\`${table}\`\\s*\\|\\s*([^|]+?)\\s*\\|`, "m"),
  )?.[1];
}

function relationshipLines(block: string): { a: string; b: string }[] {
  return [
    ...block.matchAll(/^\s*(\w+)\s+[|}o][|o]--[|o][|{o]\s+(\w+)\s*:/gm),
  ].map((m) => ({
    a: m[1],
    b: m[2],
  }));
}

const schema = readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");
const erd = readFileSync(
  path.join(ROOT, "docs", "architecture", "erd.md"),
  "utf8",
);
const models = parseSchema(schema);
const enums = parseEnums(schema);
const block = mermaidBlock(erd);

describe("schema parser", () => {
  test("reads the two V1 models and S0.1's three, with their database names", () => {
    expect(models.map((m) => m.table)).toEqual([
      "tracked_cards",
      "price_snapshots",
      "price_history",
      "mtgjson_identifiers",
      "price_sync_runs",
    ]);
    expect(models.find((m) => m.table === "price_history")).toMatchObject({
      columns: ["scryfall_id", "finish", "date", "price_cents", "synced_at"],
      enumColumns: { finish: "card_finish" },
      relationsTo: [],
    });
    expect(
      models.find((m) => m.table === "price_sync_runs")?.enumColumns,
    ).toEqual({ trigger: "price_sync_trigger", status: "price_sync_status" });
    expect(models.find((m) => m.table === "price_snapshots")?.columns).toEqual([
      "id",
      "card_id",
      "timestamp",
      "usd",
      "usd_foil",
      "eur",
      "eur_foil",
      "tix",
    ]);
    expect(
      models.find((m) => m.table === "price_snapshots")?.relationsTo,
    ).toEqual(["tracked_cards"]);
  });

  test("reads the three enums with their database names and values in order", () => {
    expect(enums).toEqual([
      {
        name: "CardFinish",
        dbName: "card_finish",
        values: ["normal", "foil", "etched"],
      },
      {
        name: "PriceSyncTrigger",
        dbName: "price_sync_trigger",
        values: ["cron", "bulk", "identifiers"],
      },
      {
        name: "PriceSyncStatus",
        dbName: "price_sync_status",
        values: ["running", "ok", "source_stale", "budget_stop", "error"],
      },
    ]);
  });

  test("a new model or column would be noticed", () => {
    const extended = `${schema}\nmodel RecommendationLog {\n  id String @id @map("log_id")\n  @@map("recommendation_log")\n}\n`;
    const added = parseSchema(extended).find(
      (m) => m.table === "recommendation_log",
    );
    expect(added?.columns).toEqual(["log_id"]);
    expect(entityAttributes(block, "recommendation_log")).toBeUndefined();
  });

  test("a new enum value would be noticed", () => {
    const extended = schema.replace(
      /(enum CardFinish \{[^}]*?etched)/,
      "$1\n  gilded",
    );
    const finish = parseEnums(extended).find((e) => e.dbName === "card_finish");
    expect(finish?.values).toEqual(["normal", "foil", "etched", "gilded"]);
    expect(erdEnums(erd).get("card_finish")).not.toEqual(finish?.values);
  });
});

describe("docs/architecture/erd.md", () => {
  test.each(models.map((m) => [m.table, m] as const))(
    "has entity %s with every column",
    (table, model) => {
      const attributes = entityAttributes(block, table);
      expect(attributes, `entity ${table} missing from erd.md`).toBeDefined();
      for (const column of model.columns) {
        expect(attributes, `${table}.${column} missing from erd.md`).toContain(
          column,
        );
      }
      expect(attributes).toHaveLength(model.columns.length);
    },
  );

  test("has one relationship line per relation", () => {
    const expected = models
      .flatMap((m) =>
        m.relationsTo.map((to) => [to, m.table].sort().join(" ↔ ")),
      )
      .sort();
    const actual = relationshipLines(block)
      .map(({ a, b }) => [a, b].sort().join(" ↔ "))
      .sort();
    expect(actual).toEqual(expected);
  });

  test.each(enums.map((e) => [e.dbName, e] as const))(
    "lists enum %s with exactly its values in order",
    (dbName, e) => {
      expect(erdEnums(erd).get(dbName)).toEqual(e.values);
    },
  );

  test("lists no enum the schema lacks", () => {
    expect([...erdEnums(erd).keys()].sort()).toEqual(
      enums.map((e) => e.dbName).sort(),
    );
  });

  test.each(
    models.flatMap((m) =>
      Object.entries(m.enumColumns).map(
        ([column, dbName]) => [m.table, column, dbName] as const,
      ),
    ),
  )("%s.%s is typed %s", (table, column, dbName) => {
    const line = entityLines(block, table)?.find(([, name]) => name === column);
    expect(line?.[0]).toBe(dbName);
  });

  test.each(["tracked_cards", "price_snapshots"])(
    '%s is labelled "V1, retained until the contract migration"',
    (table) => {
      expect(ownerOf(erd, table)).toBe(
        "V1, retained until the contract migration",
      );
    },
  );

  test.each(["price_history", "mtgjson_identifiers", "price_sync_runs"])(
    "%s is labelled as S0.1's",
    (table) => {
      expect(ownerOf(erd, table)).toBe("F0 (S0.1, `0001_price_history`)");
    },
  );

  test("has no entity the schema lacks", () => {
    const entities = [...block.matchAll(/^\s*(\w+)\s*\{/gm)]
      .map((m) => m[1])
      .sort();
    expect(entities).toEqual(models.map((m) => m.table).sort());
  });
});
