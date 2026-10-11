// T4 (AC-1, AC-5; S0.2d7): the standard fixture end to end through gzip:
// createFixtureSource → parseIdentifiers / parsePrices → the transform. The
// emitted row set equals the hand-written expected set exactly; the same
// content shaped as AllPricesToday (one date) emits only that date's rows,
// which is how S0.3's daily sync reuses the reader.
import { describe, expect, test } from "vitest";
import {
  fixtureFiles,
  NOW,
  RUN_DATE,
  S,
  sortRows,
  STANDARD_ROWS,
} from "./__fixtures__/build";
import {
  ALL_IDENTIFIERS_FILE,
  ALL_PRICES_FILE,
  ALL_PRICES_TODAY_FILE,
  type MtgjsonFileName,
} from "./consts";
import { emptyParseStats, parseIdentifiers, parsePrices } from "./parse";
import { createFixtureSource } from "./source";
import {
  IdentifierIndex,
  PriceTransform,
  utcDateOf,
  type PriceRow,
} from "./transform";

async function emitted(pricesFile: MtgjsonFileName) {
  const source = createFixtureSource(fixtureFiles());
  const stats = emptyParseStats();
  const index = new IdentifierIndex();
  for await (const raw of parseIdentifiers(
    source.open(ALL_IDENTIFIERS_FILE),
    stats,
  )) {
    index.add(raw);
  }
  const transform = new PriceTransform(index, utcDateOf(NOW));
  const rows: PriceRow[] = [];
  for await (const entry of parsePrices(source.open(pricesFile), stats)) {
    rows.push(...transform.rowsFor(entry));
  }
  return { rows: sortRows(rows), stats: transform.finish() };
}

describe("the standard fixture through gzip (T4, AC-1)", () => {
  test("AllPrices emits exactly the expected rows, with no extra key", async () => {
    const { rows, stats } = await emitted(ALL_PRICES_FILE);
    expect(rows).toStrictEqual(STANDARD_ROWS);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "date",
        "finish",
        "priceCents",
        "scryfallId",
      ]);
    }
    expect(stats.unmappedUuids).toBe(1);
    expect(stats.scryfallCollisions).toBe(1);
    expect(stats.gate.dropped).toBe(2);
  });

  test("the same content as AllPricesToday emits only runDate's gated rows", async () => {
    const { rows } = await emitted(ALL_PRICES_TODAY_FILE);
    expect(rows).toStrictEqual(
      STANDARD_ROWS.filter((r) => r.date === RUN_DATE),
    );
    expect(rows.some((r) => r.scryfallId === S.RANK_6000_AT_099)).toBe(false);
  });
});
