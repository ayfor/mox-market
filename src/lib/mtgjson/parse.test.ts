// T6 (AC-5, AC-4; S0.2d5, S0.2d7): the parsers stream. The first entry is
// yielded while its source is still open, through gzip too; readMeta stops
// at meta; a bad shape fails before any item; malformed JSON and broken gzip
// fail after the items already yielded.
import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { constants, createGunzip, createGzip, gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { META, RUN_DATE } from "./__fixtures__/build";
import {
  emptyParseStats,
  parseIdentifiers,
  parsePrices,
  readMeta,
  SourceFormatError,
} from "./parse";

const U1 = "10000000-0000-4000-8000-000000000001";
const U2 = "10000000-0000-4000-8000-000000000002";
const S1 = "20000000-0000-4000-8000-000000000001";

const priceValue = (price: number) => ({
  paper: {
    tcgplayer: { currency: "USD", retail: { normal: { [RUN_DATE]: price } } },
  },
});
const identifierValue = (scryfallId: string) => ({
  identifiers: { scryfallId },
  edhrecRank: 12,
  side: "a",
});

/** A document split after its first entry: [head, rest]. */
function split(first: unknown, second: unknown): [string, string] {
  const head = `{"meta":${JSON.stringify(META)},"data":{"${U1}":${JSON.stringify(first)}`;
  const rest = `,"${U2}":${JSON.stringify(second)}}}`;
  return [head, rest];
}

const readers = [
  {
    name: "parseIdentifiers",
    first: identifierValue(S1),
    second: identifierValue(S1.toUpperCase()),
    read: (input: Readable) => parseIdentifiers(input, emptyParseStats()),
  },
  {
    name: "parsePrices (AllPrices)",
    first: priceValue(1.15),
    second: priceValue(2),
    read: (input: Readable) => parsePrices(input, emptyParseStats()),
  },
  {
    name: "parsePrices (AllPricesToday)",
    first: priceValue(0.29),
    second: {
      paper: {
        tcgplayer: { currency: "USD", retail: { foil: { [RUN_DATE]: 4.35 } } },
      },
    },
    read: (input: Readable) =>
      parsePrices(input, emptyParseStats(), "AllPricesToday"),
  },
] as const;

describe("streaming (T6, AC-5)", () => {
  test.each(readers)(
    "$name yields the first entry while the source is still open",
    async (reader) => {
      const source = new PassThrough();
      const [head, rest] = split(reader.first, reader.second);
      source.write(head);
      const iterator = reader.read(source)[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      expect((first.value as { uuid: string }).uuid).toBe(U1);
      expect(source.writableEnded).toBe(false);
      source.end(rest);
      const second = await iterator.next();
      expect((second.value as { uuid: string }).uuid).toBe(U2);
      expect((await iterator.next()).done).toBe(true);
    },
  );

  test.each(readers)(
    "$name streams through gunzip with Z_SYNC_FLUSH partial writes",
    async (reader) => {
      const [head, rest] = split(reader.first, reader.second);
      const gzip = createGzip();
      const compressed: Buffer[] = [];
      gzip.on("data", (chunk: Buffer) => compressed.push(chunk));
      gzip.write(head);
      await new Promise<void>((resolve) =>
        gzip.flush(constants.Z_SYNC_FLUSH, () => resolve()),
      );
      const raw = new PassThrough();
      const gunzip = createGunzip();
      raw.pipe(gunzip);
      raw.write(Buffer.concat(compressed.splice(0)));
      const iterator = reader.read(gunzip)[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect((first.value as { uuid: string }).uuid).toBe(U1);
      expect(raw.writableEnded).toBe(false);
      const ended = once(gzip, "end");
      gzip.end(rest);
      await ended;
      raw.end(Buffer.concat(compressed));
      const second = await iterator.next();
      expect((second.value as { uuid: string }).uuid).toBe(U2);
      expect((await iterator.next()).done).toBe(true);
    },
  );

  test("readMeta returns after the meta object and destroys its source having read a small part of it", async () => {
    // A 64 MB document produced lazily in 64 KB chunks, one per macrotask,
    // as a file read stream delivers them.
    const entry = `,"k":${JSON.stringify(priceValue(1))}`;
    const filler = entry.repeat(Math.ceil(65_536 / entry.length));
    const CHUNKS = 1_000;
    const total = CHUNKS * filler.length;
    let pulled = 0;
    let sent = 0;
    const source = new Readable({
      read() {
        setImmediate(() => {
          if (sent === 0) {
            const head = `{"meta":${JSON.stringify(META)},"data":{"first":{}`;
            pulled += head.length;
            this.push(head);
          } else if (sent <= CHUNKS) {
            pulled += filler.length;
            this.push(filler);
          } else {
            this.push("}}");
            this.push(null);
          }
          sent += 1;
        });
      },
    });
    const meta = await readMeta(source, "AllPrices", { requireData: true });
    expect(meta).toEqual({ date: META.date, version: META.version });
    expect(source.destroyed).toBe(true);
    expect(pulled).toBeLessThan(total / 100);
  });

  test("identifiers come back lower-cased with their raw fields", async () => {
    const source = new PassThrough();
    source.end(
      JSON.stringify({
        meta: META,
        data: {
          [U1.toUpperCase()]: {
            ...identifierValue(S1.toUpperCase()),
            foreignData: [{ uuid: "x" }],
          },
        },
      }),
    );
    const out = [];
    for await (const item of parseIdentifiers(source, emptyParseStats()))
      out.push(item);
    expect(out).toEqual([
      { uuid: U1, scryfallId: S1, side: "a", edhrecRank: 12 },
    ]);
  });
});

describe("unhappy paths (T6, AC-4, AC-5)", () => {
  const collect = async (text: string | Buffer, label = "AllPrices") => {
    const source = new PassThrough();
    source.end(text);
    const items: unknown[] = [];
    try {
      for await (const item of parsePrices(source, emptyParseStats(), label))
        items.push(item);
      return { items, error: null as unknown };
    } catch (error) {
      return { items, error };
    }
  };

  test.each([
    [
      "data before meta",
      `{"data":{"${U1}":${JSON.stringify(priceValue(1))}},"meta":${JSON.stringify(META)}}`,
    ],
    ["a missing meta", `{"data":{"${U1}":${JSON.stringify(priceValue(1))}}}`],
    ["an empty object", "{}"],
    ["a top-level array", `[{"meta":${JSON.stringify(META)}}]`],
    ["a top-level string", '"meta"'],
  ])(
    "%s rejects with SourceFormatError before any item",
    async (_label, text) => {
      const { items, error } = await collect(text);
      expect(items).toEqual([]);
      expect(error).toBeInstanceOf(SourceFormatError);
    },
  );

  test.each([
    ["data before meta", `{"data":{},"meta":${JSON.stringify(META)}}`],
    ["a missing meta", `{"data":{}}`],
    ["a meta that is not an object", `{"meta":"5.3.0","data":{}}`],
  ])("readMeta: %s rejects with SourceFormatError", async (_label, text) => {
    const source = new PassThrough();
    source.end(text);
    await expect(readMeta(source, "Meta.json")).rejects.toBeInstanceOf(
      SourceFormatError,
    );
  });

  test.each([
    [
      "no data key at all",
      `{"meta":${JSON.stringify(META)}}`,
      /AllPrices: no data object$/,
    ],
    [
      "data after another key",
      `{"meta":${JSON.stringify(META)},"other":1,"data":{}}`,
      /AllPrices: no data object after meta \(found "other"\)/,
    ],
    [
      "a nested data only",
      `{"meta":${JSON.stringify({ ...META, data: {} })}}`,
      /AllPrices: no data object$/,
    ],
  ])(
    "readMeta with requireData: %s rejects (ADV.1)",
    async (_label, text, why) => {
      const source = new PassThrough();
      source.end(text);
      await expect(
        readMeta(source, "AllPrices", { requireData: true }),
      ).rejects.toThrow(why);
    },
  );

  test("readMeta without requireData accepts a file that is meta alone (Meta.json)", async () => {
    const source = new PassThrough();
    source.end(JSON.stringify({ meta: META }));
    await expect(readMeta(source, "Meta.json")).resolves.toEqual({
      date: META.date,
      version: META.version,
    });
  });

  test("readMeta with requireData returns as soon as data follows meta", async () => {
    const source = new PassThrough();
    source.write(`{"meta":${JSON.stringify(META)},"data":{`);
    // The rest never arrives: readMeta must not wait for it.
    await expect(
      readMeta(source, "AllPrices", { requireData: true }),
    ).resolves.toEqual({ date: META.date, version: META.version });
    expect(source.destroyed).toBe(true);
  });

  test.each([
    ["no data key", `{"meta":${JSON.stringify(META)}}`],
    ["a meta-only file with a nested data", `{"meta":{"data":{}}}`],
  ])(
    "the full readers reject %s at the top level's close (ADV.1)",
    async (_label, text) => {
      for (const label of ["AllPrices", "AllIdentifiers"]) {
        const source = new PassThrough();
        source.end(text);
        const read = async () => {
          const reader =
            label === "AllPrices"
              ? parsePrices(source, emptyParseStats(), label)
              : parseIdentifiers(source, emptyParseStats(), label);
          for await (const _item of reader) void _item;
        };
        await expect(read()).rejects.toThrow(`${label}: no data object`);
      }
    },
  );

  test("malformed JSON after the first entry rejects after yielding it", async () => {
    const [head] = split(priceValue(1), priceValue(2));
    const source = new PassThrough();
    source.write(head);
    const iterator = parsePrices(source, emptyParseStats())[
      Symbol.asyncIterator
    ]();
    expect(((await iterator.next()).value as { uuid: string }).uuid).toBe(U1);
    source.end(`,"${U2}":{"paper":}}}`);
    const error = await iterator.next().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SourceFormatError);
    expect((error as Error).message).toMatch(/^AllPrices: malformed JSON/);
  });

  test("a truncated gzip rejects with Z_BUF_ERROR after the entries it held", async () => {
    const [head, rest] = split(priceValue(1), priceValue(2));
    const whole = gzipSync(head + rest);
    const raw = new PassThrough();
    const gunzip = createGunzip();
    raw.pipe(gunzip);
    raw.end(whole.subarray(0, whole.length - 12));
    const items: unknown[] = [];
    const error = await (async () => {
      try {
        for await (const item of parsePrices(gunzip, emptyParseStats()))
          items.push(item);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect((error as { code?: string }).code).toBe("Z_BUF_ERROR");
  });

  test("a corrupted gzip rejects with Z_DATA_ERROR", async () => {
    const [head, rest] = split(priceValue(1), priceValue(2));
    const whole = Buffer.from(gzipSync(head + rest));
    whole[whole.length - 6] ^= 0xff; // the CRC32 trailer
    const raw = new PassThrough();
    const gunzip = createGunzip();
    raw.pipe(gunzip);
    raw.end(whole);
    const error = await (async () => {
      try {
        for await (const item of parsePrices(gunzip, emptyParseStats()))
          void item;
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect((error as { code?: string }).code).toBe("Z_DATA_ERROR");
  });

  test("an entry whose value is not an object is skipped and counted", async () => {
    const source = new PassThrough();
    source.end(
      JSON.stringify({
        meta: META,
        data: { [U1]: 5, [U2]: priceValue(1), x: null, y: [1] },
      }),
    );
    const stats = emptyParseStats();
    const out = [];
    for await (const item of parsePrices(source, stats)) out.push(item.uuid);
    expect(out).toEqual([U2]);
    expect(stats.nonObjectEntries).toBe(3);
  });

  test("an identifier entry that is not an object is skipped and counted", async () => {
    const source = new PassThrough();
    source.end(
      JSON.stringify({
        meta: META,
        data: { [U1]: "x", [U2]: identifierValue(S1) },
      }),
    );
    const stats = emptyParseStats();
    const out = [];
    for await (const item of parseIdentifiers(source, stats))
      out.push(item.uuid);
    expect(out).toEqual([U2]);
    expect(stats.nonObjectEntries).toBe(1);
  });

  test("an early break destroys the source", async () => {
    const source = new PassThrough();
    const [head] = split(priceValue(1), priceValue(2));
    source.write(head);
    for await (const item of parsePrices(source, emptyParseStats())) {
      void item;
      break;
    }
    expect(source.destroyed).toBe(true);
  });
});
