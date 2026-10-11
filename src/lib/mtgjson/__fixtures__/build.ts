// MTGJson fixtures built from small typed tables (S0.2d21): every value a
// reviewer needs is in this file, and the documents are rendered in MTGJson
// v5's shapes (meta first, data keyed by UUID, paper.tcgplayer.retail beside
// the providers, lists and mtgo F0 ignores), then gzipped in memory. No test
// touches the network or .cache/.
//
// Clock: NOW = 2026-10-05T18:00:00Z, so runDate = 2026-10-05, the window is
// 2026-09-05 … 2026-10-05 and runDate − 31 = 2026-09-04.
import { gzipSync } from "node:zlib";
import {
  ALL_IDENTIFIERS_FILE,
  ALL_PRICES_FILE,
  ALL_PRICES_TODAY_FILE,
  META_FILE,
  type MtgjsonFileName,
} from "../consts";
import type { IdentifierRow, PriceRow } from "../transform";

export const NOW = new Date("2026-10-05T18:00:00.000Z");
export const RUN_DATE = "2026-10-05";
export const WINDOW_START = "2026-09-05";
/** runDate − 31: the newest date a prune deletes. */
export const BEFORE_WINDOW = "2026-09-04";
export const AFTER_RUN_DATE = "2026-10-06";
export const PREV_DATE = "2026-10-04";

export const META = { date: "2026-10-05", version: "5.3.0+20261005" } as const;

/** An MTGJson UUID and a Scryfall id per fixture card (lower-case, fixed). */
const uuid = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sid = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const U = {
  RANK_4000_AT_020: uuid(1),
  RANK_6000_AT_100: uuid(2),
  UNRANKED_AT_100: uuid(3),
  RANK_6000_AT_099: uuid(4),
  RANK_5000_AT_010: uuid(5),
  RANK_5001_AT_099: uuid(6),
  ETCHED: uuid(7),
  FACE_A: uuid(8),
  FACE_B: uuid(9),
  UNMAPPED: uuid(10),
} as const;

export const S = {
  RANK_4000_AT_020: sid(1),
  RANK_6000_AT_100: sid(2),
  UNRANKED_AT_100: sid(3),
  RANK_6000_AT_099: sid(4),
  RANK_5000_AT_010: sid(5),
  RANK_5001_AT_099: sid(6),
  ETCHED: sid(7),
  /** Both faces of one double-faced printing share this Scryfall id. */
  FACE: sid(8),
} as const;

export type FixtureFinish = "normal" | "foil" | "etched";

export interface CardFixture {
  readonly uuid: string;
  readonly scryfallId?: unknown;
  readonly side?: unknown;
  readonly edhrecRank?: unknown;
  /** TCGplayer retail series by finish: date key → price. */
  readonly retail?: Partial<Record<FixtureFinish, Record<string, unknown>>>;
  /** The TCGplayer block's currency (MTGJson writes USD). */
  readonly currency?: string;
  /** Leave the entry out of AllIdentifiers (an unmapped UUID). */
  readonly unmapped?: boolean;
  /** Leave the entry out of AllPrices. */
  readonly unpriced?: boolean;
}

/** A calendar date plus `days`, in UTC. */
export function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The same price on runDate − 31, the window start (runDate − 30),
 * runDate − 1, runDate and runDate + 1.
 */
export function series(
  price: unknown,
  runDate: string = RUN_DATE,
): Record<string, unknown> {
  return Object.fromEntries(
    [-31, -30, -1, 0, 1].map((days) => [shift(runDate, days), price]),
  );
}

/** The window dates series() writes, which a kept series emits. */
export const seriesWindowDates = (runDate: string = RUN_DATE): string[] => [
  shift(runDate, -30),
  shift(runDate, -1),
  runDate,
];
export const SERIES_WINDOW_DATES = seriesWindowDates(RUN_DATE);

/**
 * The standard fixture (AC-1, AC-3): the gate's six boundary cases, an
 * etched series, a double-faced printing whose face b comes first with a
 * different price, and a UUID AllIdentifiers does not know. Dated around
 * `runDate` (the CLI tests use today's UTC date; the rest use RUN_DATE).
 */
export function standardCards(runDate: string = RUN_DATE): CardFixture[] {
  const at = (price: number) => series(price, runDate);
  return [
    {
      uuid: U.RANK_4000_AT_020,
      scryfallId: S.RANK_4000_AT_020,
      edhrecRank: 4000,
      retail: { normal: at(0.2) },
    },
    {
      uuid: U.RANK_6000_AT_100,
      scryfallId: S.RANK_6000_AT_100,
      edhrecRank: 6000,
      retail: { normal: at(1.0), foil: at(4.35) },
    },
    {
      uuid: U.UNRANKED_AT_100,
      scryfallId: S.UNRANKED_AT_100,
      retail: { normal: at(1.0) },
    },
    {
      uuid: U.RANK_6000_AT_099,
      scryfallId: S.RANK_6000_AT_099,
      edhrecRank: 6000,
      retail: { normal: at(0.99) },
    },
    {
      uuid: U.RANK_5000_AT_010,
      scryfallId: S.RANK_5000_AT_010,
      edhrecRank: 5000,
      retail: { normal: at(0.1) },
    },
    {
      uuid: U.RANK_5001_AT_099,
      scryfallId: S.RANK_5001_AT_099,
      edhrecRank: 5001,
      retail: { normal: at(0.99) },
    },
    {
      uuid: U.ETCHED,
      scryfallId: S.ETCHED,
      edhrecRank: 120,
      retail: { etched: at(12.63) },
    },
    // Face b first in both files, with a different price: side a must win.
    {
      uuid: U.FACE_B,
      scryfallId: S.FACE,
      side: "b",
      edhrecRank: 300,
      retail: { normal: at(3.0) },
    },
    {
      uuid: U.FACE_A,
      scryfallId: S.FACE,
      side: "a",
      edhrecRank: 300,
      retail: { normal: at(2.0) },
    },
    {
      uuid: U.UNMAPPED,
      unmapped: true,
      retail: { normal: at(5.0) },
    },
  ];
}

export const STANDARD_CARDS: readonly CardFixture[] = standardCards();

/** Exactly the price rows standardCards(runDate) emits on runDate, sorted. */
export function standardRows(runDate: string = RUN_DATE): PriceRow[] {
  const rows = (
    scryfallId: string,
    finish: FixtureFinish,
    priceCents: number,
  ): PriceRow[] =>
    seriesWindowDates(runDate).map((date) => ({
      scryfallId,
      finish,
      date,
      priceCents,
    }));
  return sortRows([
    ...rows(S.RANK_4000_AT_020, "normal", 20),
    ...rows(S.RANK_6000_AT_100, "normal", 100),
    ...rows(S.RANK_6000_AT_100, "foil", 435),
    ...rows(S.UNRANKED_AT_100, "normal", 100),
    ...rows(S.RANK_5000_AT_010, "normal", 10),
    ...rows(S.ETCHED, "etched", 1263),
    ...rows(S.FACE, "normal", 200),
  ]);
}

export const STANDARD_ROWS: readonly PriceRow[] = standardRows();

/** Exactly the mtgjson_identifiers rows STANDARD_CARDS stores, sorted by UUID. */
export const STANDARD_IDENTIFIERS: readonly IdentifierRow[] =
  STANDARD_CARDS.filter((c) => !c.unmapped)
    .map((c) => ({
      mtgjsonUuid: c.uuid,
      scryfallId: c.scryfallId as string,
      side: (c.side as string | undefined) ?? null,
      edhrecRank: (c.edhrecRank as number | undefined) ?? null,
    }))
    .sort((a, b) => (a.mtgjsonUuid < b.mtgjsonUuid ? -1 : 1));

/** Rows sorted by Scryfall id, finish, date (the tests' canonical order). */
export function sortRows<T extends PriceRow>(list: readonly T[]): T[] {
  const key = (r: PriceRow) => `${r.scryfallId}|${r.finish}|${r.date}`;
  return [...list].sort((a, b) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
  );
}

/** One AllIdentifiers entry, with the card fields F0 never reads around it. */
function identifierEntry(card: CardFixture): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    artist: "Fixture Artist",
    foreignData: [
      {
        identifiers: { scryfallId: "30000000-0000-4000-8000-000000000000" },
        language: "French",
        uuid: "30000000-0000-4000-8000-000000000001",
      },
    ],
    identifiers: {
      mtgjsonV4Id: "40000000-0000-4000-8000-000000000000",
      ...(card.scryfallId === undefined ? {} : { scryfallId: card.scryfallId }),
      tcgplayerProductId: "1435",
    },
    legalities: { commander: "Legal" },
    name: `Card ${card.uuid.slice(-2)}`,
    uuid: card.uuid,
  };
  if (card.side !== undefined) entry.side = card.side;
  if (card.edhrecRank !== undefined) entry.edhrecRank = card.edhrecRank;
  return entry;
}

/** One AllPrices entry: TCGplayer retail plus everything F0 must ignore. */
function priceEntry(card: CardFixture): Record<string, unknown> {
  const decoy = { normal: series(999.99), foil: series(999.99) };
  return {
    mtgo: { cardhoarder: { currency: "USD", retail: { normal: series(0.5) } } },
    paper: {
      cardkingdom: { buylist: decoy, currency: "USD", retail: decoy },
      cardmarket: { buylist: {}, currency: "EUR", retail: decoy },
      manapool: { currency: "USD", retail: decoy },
      tcgplayer: {
        buylist: decoy,
        currency: card.currency ?? "USD",
        retail: card.retail ?? {},
      },
    },
  };
}

export interface FixtureDocs {
  meta?: { date: unknown; version: unknown };
  identifiersMeta?: { date: unknown; version: unknown };
  pricesMeta?: { date: unknown; version: unknown };
}

/** A whole document with `meta` first, as MTGJson writes it. */
function doc(meta: unknown, data: Record<string, unknown>): string {
  return JSON.stringify({ meta, data });
}

export function metaJson(meta: unknown = META): string {
  return JSON.stringify({ meta, data: meta });
}

export function allIdentifiersJson(
  cards: readonly CardFixture[],
  meta: unknown = META,
): string {
  return doc(
    meta,
    Object.fromEntries(
      cards.filter((c) => !c.unmapped).map((c) => [c.uuid, identifierEntry(c)]),
    ),
  );
}

export function allPricesJson(
  cards: readonly CardFixture[],
  meta: unknown = META,
): string {
  return doc(
    meta,
    Object.fromEntries(
      cards.filter((c) => !c.unpriced).map((c) => [c.uuid, priceEntry(c)]),
    ),
  );
}

/** AllPricesToday: AllPrices' shape with each series cut to one date. */
export function allPricesTodayJson(
  cards: readonly CardFixture[],
  date: string = RUN_DATE,
  meta: unknown = META,
): string {
  const today = cards.map((card) => ({
    ...card,
    retail: Object.fromEntries(
      Object.entries(card.retail ?? {}).map(([finish, prices]) => [
        finish,
        date in prices ? { [date]: prices[date] } : {},
      ]),
    ),
  }));
  return allPricesJson(today, meta);
}

export const gz = (text: string): Buffer => gzipSync(Buffer.from(text));

/** The three bulk files (and AllPricesToday), ready for createFixtureSource. */
export function fixtureFiles(
  cards: readonly CardFixture[] = STANDARD_CARDS,
  docs: FixtureDocs = {},
  runDate: string = RUN_DATE,
): Record<MtgjsonFileName, Buffer> {
  return {
    [META_FILE]: Buffer.from(metaJson(docs.meta ?? META)),
    [ALL_IDENTIFIERS_FILE]: gz(
      allIdentifiersJson(cards, docs.identifiersMeta ?? META),
    ),
    [ALL_PRICES_FILE]: gz(allPricesJson(cards, docs.pricesMeta ?? META)),
    [ALL_PRICES_TODAY_FILE]: gz(
      allPricesTodayJson(cards, runDate, docs.pricesMeta ?? META),
    ),
  };
}

/**
 * `count` ranked cards (rank 10, so every series is kept), each with one
 * normal series of `dates` consecutive window dates from the window start
 * at $1.00: count × dates price rows. UUIDs and Scryfall ids from 1001 up.
 */
export function manyCards(count: number, dates: number): CardFixture[] {
  return Array.from({ length: count }, (_, i) => ({
    uuid: uuid(1001 + i),
    scryfallId: sid(1001 + i),
    edhrecRank: 10,
    retail: {
      normal: Object.fromEntries(
        Array.from({ length: dates }, (_, d) => [shift(WINDOW_START, d), 1.0]),
      ),
    },
  }));
}
