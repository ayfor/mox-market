// T9 (AC-5): docs/architecture/erd.md reflects prisma/schema.prisma. Keeps the
// ERD living: a migration that adds a model, column or relation fails this
// until the ERD is updated in the same branch.
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
  /** Tables this model points at through a @relation(fields: …) */
  relationsTo: string[];
}

function parseSchema(schema: string): Model[] {
  const blocks = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  const tableOf = new Map<string, string>();
  for (const [, name, body] of blocks) {
    tableOf.set(name, body.match(/@@map\("([^"]+)"\)/)?.[1] ?? name);
  }
  const enums = new Set(
    [...schema.matchAll(/^enum\s+(\w+)/gm)].map((m) => m[1]),
  );
  return blocks.map(([, name, body]) => {
    const columns: string[] = [];
    const relationsTo: string[] = [];
    for (const raw of body.split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").trim();
      if (!line || line.startsWith("@@")) continue;
      const field = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
      if (!field) continue;
      const [, fieldName, type, list] = field;
      if (SCALARS.has(type) || enums.has(type)) {
        if (!list)
          columns.push(line.match(/@map\("([^"]+)"\)/)?.[1] ?? fieldName);
      } else if (/@relation\([^)]*fields:/.test(line)) {
        relationsTo.push(tableOf.get(type) ?? type);
      }
    }
    return { name, table: tableOf.get(name)!, columns, relationsTo };
  });
}

function mermaidBlock(markdown: string): string {
  const block = markdown.match(/```mermaid\n([\s\S]*?)```/)?.[1];
  if (!block || !/^\s*erDiagram\b/.test(block))
    throw new Error("no erDiagram block in erd.md");
  return block;
}

function entityAttributes(block: string, table: string): string[] | undefined {
  const body = block.match(
    new RegExp(`^\\s*${table}\\s*\\{([\\s\\S]*?)^\\s*\\}`, "m"),
  )?.[1];
  if (body === undefined) return undefined;
  return body
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[0] !== "")
    .map((parts) => parts[1]);
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
const block = mermaidBlock(erd);

describe("schema parser", () => {
  test("reads today's two V1 models with their database names", () => {
    expect(models.map((m) => m.table)).toEqual([
      "tracked_cards",
      "price_snapshots",
    ]);
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

  test("a new model or column would be noticed", () => {
    const extended = `${schema}\nmodel PriceHistory {\n  scryfallId String @map("scryfall_id")\n  @@map("price_history")\n}\n`;
    const added = parseSchema(extended).find(
      (m) => m.table === "price_history",
    );
    expect(added?.columns).toEqual(["scryfall_id"]);
    expect(entityAttributes(block, "price_history")).toBeUndefined();
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

  test("has no entity the schema lacks", () => {
    const entities = [...block.matchAll(/^\s*(\w+)\s*\{/gm)]
      .map((m) => m[1])
      .sort();
    expect(entities).toEqual(models.map((m) => m.table).sort());
  });
});
