// Streaming readers for MTGJson v5 files (S0.2d5, S0.2d7; AC-4, AC-5).
//
// stream-json 3's parser → a top-level shape check → pick("data") →
// streamObject(), wired with stream-chain and consumed with `for await`, so
// each MTGJson entry (one card's prices or identifiers) is assembled alone
// and backpressure follows the consumer (the database writes). Nothing here
// holds a whole file, and no code path calls JSON.parse on one (T7).
//
// Shape (S0.2d5): the top level must be an object whose first key is
// `meta`. MTGJson writes meta before data, and requiring it lets a file's
// version be checked before its first row. A violation rejects with
// SourceFormatError before any item. A JSON syntax error rejects with
// SourceFormatError after the items already yielded; gzip errors (Z_BUF_ERROR,
// Z_DATA_ERROR) and I/O errors pass through with their own codes.
//
// stream-json is built for trusted input (its README); MTGJson is the one
// source, fetched over https from MTGJSON_BASE_URL only.
import type { Readable } from "node:stream";
import { chainUnchecked } from "stream-chain";
import { parser } from "stream-json";
import { pick } from "stream-json/filters/pick.js";
import { streamObject } from "stream-json/streamers/stream-object.js";
import { streamValues } from "stream-json/streamers/stream-values.js";

/** A file whose structure or JSON is not what MTGJson v5 writes. */
export class SourceFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceFormatError";
  }
}

/** A file's meta object: MTGJson's publish date and schema version. */
export interface MtgjsonMeta {
  readonly date: string | null;
  readonly version: string | null;
}

/** Counts the parsers keep; the transform and the report read them. */
export interface ParseStats {
  /** Entries under `data` whose value is not an object: skipped. */
  nonObjectEntries: number;
}

export const emptyParseStats = (): ParseStats => ({ nonObjectEntries: 0 });

/** One AllIdentifiers entry, raw: the transform validates every field. */
export interface RawIdentifier {
  /** The entry's key, lower-cased (MTGJson's UUID). */
  readonly uuid: string;
  readonly scryfallId: unknown;
  readonly side: unknown;
  readonly edhrecRank: unknown;
}

/** The three finishes F0 stores, in TCGplayer retail's own key names. */
export const RETAIL_FINISHES = ["normal", "foil", "etched"] as const;
export type RetailFinish = (typeof RETAIL_FINISHES)[number];

/** One retail series: date key → price, both unvalidated. */
export interface RawSeries {
  readonly finish: RetailFinish;
  readonly prices: Readonly<Record<string, unknown>>;
}

/**
 * One AllPrices or AllPricesToday entry, reduced to paper TCGplayer retail
 * USD (F0 Filter): `series` is empty when the entry has none.
 * `nonUsdCurrency` is true when its TCGplayer block names another currency
 * (then no series is read).
 */
export interface PriceEntry {
  readonly uuid: string;
  readonly series: readonly RawSeries[];
  readonly nonUsdCurrency: boolean;
}

type Token = { name: string; value?: unknown };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A chain stage that passes tokens through unchanged while checking the
 * document's top level: an object whose first key is `meta`. With
 * `streamValues: false` the parser emits one packed `keyValue` per key.
 */
function topLevelShape(label: string): (token: Token) => Token {
  let depth = 0;
  let keys = 0;
  let started = false;
  return (token) => {
    if (!started) {
      started = true;
      if (token.name !== "startObject") {
        throw new SourceFormatError(`${label}: the top level is not an object`);
      }
    }
    switch (token.name) {
      case "startObject":
      case "startArray":
        depth += 1;
        break;
      case "endObject":
      case "endArray":
        depth -= 1;
        if (depth === 0 && keys === 0) {
          throw new SourceFormatError(`${label}: no meta object`);
        }
        break;
      case "keyValue":
        if (depth === 1) {
          keys += 1;
          if (keys === 1 && token.value !== "meta") {
            throw new SourceFormatError(
              `${label}: meta must be the first key (found ${JSON.stringify(
                String(token.value).slice(0, 40),
              )})`,
            );
          }
        }
        break;
      default:
        if (depth === 0) {
          throw new SourceFormatError(
            `${label}: unexpected data after the top level`,
          );
        }
    }
    return token;
  };
}

/** Rethrows a stream error, wrapping JSON syntax errors as SourceFormatError. */
function sourceError(label: string, error: unknown): Error {
  if (error instanceof SourceFormatError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") return error as Error; // zlib, fs, fetch
  const message = error instanceof Error ? error.message : String(error);
  return new SourceFormatError(`${label}: malformed JSON (${message})`);
}

/**
 * The `data` object's entries as `{ key, value }`, one at a time. The input
 * is a decompressed byte stream; it is destroyed when the iteration ends
 * early or fails.
 */
async function* dataEntries(
  input: Readable,
  label: string,
): AsyncGenerator<{ key: string; value: unknown }> {
  const pipeline = chainUnchecked<unknown, { key: string; value: unknown }>([
    input,
    parser({ streamValues: false }),
    topLevelShape(label),
    pick({ filter: "data" }),
    streamObject(),
  ]);
  let sawEnd = false;
  try {
    for await (const item of pipeline) yield item;
    sawEnd = true;
  } catch (error) {
    throw sourceError(label, error);
  } finally {
    if (!sawEnd) {
      pipeline.destroy();
      input.destroy();
    }
  }
}

/**
 * Reads a file's `meta` object and stops (AC-4): the source is destroyed as
 * soon as meta closes, so a 2 GB file costs a few bytes. The file must start
 * with `{"meta": {...}`; anything else rejects with SourceFormatError.
 */
export async function readMeta(
  input: Readable,
  label: string,
): Promise<MtgjsonMeta> {
  const pipeline = chainUnchecked<unknown, { value: unknown }>([
    input,
    parser({ streamValues: false }),
    topLevelShape(label),
    pick({ filter: "meta", once: true }),
    streamValues(),
  ]);
  try {
    for await (const item of pipeline) {
      const meta = item.value;
      if (!isObject(meta)) {
        throw new SourceFormatError(`${label}: meta is not an object`);
      }
      return {
        date: typeof meta.date === "string" ? meta.date : null,
        version: typeof meta.version === "string" ? meta.version : null,
      };
    }
  } catch (error) {
    throw sourceError(label, error);
  } finally {
    pipeline.destroy();
    input.destroy();
  }
  throw new SourceFormatError(`${label}: no meta object`);
}

/**
 * AllIdentifiers' entries: the key (a UUID, lower-cased) with the three
 * fields F0 stores, unvalidated (the transform owns the rules).
 */
export async function* parseIdentifiers(
  input: Readable,
  stats: ParseStats,
  label = "AllIdentifiers",
): AsyncGenerator<RawIdentifier> {
  for await (const { key, value } of dataEntries(input, label)) {
    if (!isObject(value)) {
      stats.nonObjectEntries += 1;
      continue;
    }
    const identifiers = isObject(value.identifiers) ? value.identifiers : {};
    yield {
      uuid: key.toLowerCase(),
      scryfallId:
        typeof identifiers.scryfallId === "string"
          ? identifiers.scryfallId.toLowerCase()
          : identifiers.scryfallId,
      side: value.side,
      edhrecRank: value.edhrecRank,
    };
  }
}

/**
 * AllPrices' (and AllPricesToday's, the same shape) entries reduced to
 * `paper.tcgplayer.retail.{normal,foil,etched}` in USD. Other providers,
 * `buylist` and `mtgo` are never read (F0 Filter).
 */
export async function* parsePrices(
  input: Readable,
  stats: ParseStats,
  label = "AllPrices",
): AsyncGenerator<PriceEntry> {
  for await (const { key, value } of dataEntries(input, label)) {
    if (!isObject(value)) {
      stats.nonObjectEntries += 1;
      continue;
    }
    const paper = isObject(value.paper) ? value.paper : {};
    const tcgplayer = isObject(paper.tcgplayer) ? paper.tcgplayer : null;
    const series: RawSeries[] = [];
    let nonUsdCurrency = false;
    if (tcgplayer !== null) {
      if (tcgplayer.currency !== "USD") {
        nonUsdCurrency = true;
      } else if (isObject(tcgplayer.retail)) {
        for (const finish of RETAIL_FINISHES) {
          const prices = tcgplayer.retail[finish];
          if (isObject(prices)) series.push({ finish, prices });
        }
      }
    }
    yield { uuid: key.toLowerCase(), series, nonUsdCurrency };
  }
}
