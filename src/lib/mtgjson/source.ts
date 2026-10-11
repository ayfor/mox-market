// Where MTGJson files come from (S0.2d4; AC-4, AC-5). One interface, three
// implementations: createHttpSource (download from MTGJSON_BASE_URL into the
// gitignored cache, then read from there), createDirSource (--source-dir,
// no network) and createFixtureSource (tests, in memory).
//
// A .gz file is never decompressed to disk: `open` gunzips it as a stream
// each time it is read, and `verify` reads it once end to end into a null
// sink so a truncated or corrupted download fails on its gzip CRC before any
// database connection. The only file writer in this module is `download`.
// fetch decodes any Content-Encoding it is served, so for a .gz file
// `download` refuses every encoding but identity and requires the gzip magic
// bytes before writing, and it gunzips the `.part` end to end before the
// rename, so neither a decompressed copy nor a corrupt file ever replaces a
// good cached one (ADV.3).
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import { MTGJSON_BASE_URL, type MtgjsonFileName } from "./consts";

/** The User-Agent every MTGJson request carries (the app's, as for Scryfall). */
export const MTGJSON_USER_AGENT = "MoxMarket/0.1.0";

/** A download whose body goes quiet this long is aborted. */
export const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

/** A file the source does not hold (exit 2, naming the file). */
export class SourceMissingError extends Error {
  readonly file: string;

  constructor(file: string, where: string) {
    super(`${file} is missing from ${where}`);
    this.name = "SourceMissingError";
    this.file = file;
  }
}

/** A failed download: HTTP status, short body, size mismatch or a stall. */
export class DownloadError extends Error {
  readonly file: string;

  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = "DownloadError";
    this.file = file;
  }
}

export interface MtgjsonSource {
  /** Where the files come from, for the report (never a URL with credentials). */
  readonly description: string;
  /** Makes the named files available: downloads them, or checks they exist. */
  prepare(names: readonly MtgjsonFileName[]): Promise<void>;
  /** A fresh stream of the file's bytes, gunzipped for a .gz file. */
  open(name: MtgjsonFileName): Readable;
  /** Gunzips a .gz file end to end into a null sink; rejects on a bad CRC or a truncation. */
  verify(name: MtgjsonFileName): Promise<void>;
}

export const isGzip = (name: string): boolean => name.endsWith(".gz");

/** A writable that discards everything (the integrity pass's sink). */
const nullSink = () =>
  new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

/** The two bytes every gzip member starts with (RFC 1952). */
export const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

/** Gunzips a file on disk end to end into a null sink (CRC and length). */
const verifyGzipFile = (file: string): Promise<void> =>
  pipeline(createReadStream(file), createGunzip(), nullSink());

/**
 * A raw byte stream, gunzipped when the name ends in .gz. Destroying the
 * returned stream (a reader that stops at meta) destroys the raw one, and a
 * raw-stream error reaches the returned stream.
 */
function decoded(name: string, raw: Readable): Readable {
  if (!isGzip(name)) return raw;
  const gunzip = createGunzip();
  raw.on("error", (error) => gunzip.destroy(error));
  gunzip.on("close", () => raw.destroy());
  raw.pipe(gunzip);
  return gunzip;
}

/** Files already on disk: `--source-dir`, and the http source's cache. */
export function createDirSource(dir: string): MtgjsonSource {
  const fileOf = (name: string) => path.join(dir, name);
  return {
    description: `directory ${dir}`,
    async prepare(names) {
      for (const name of names) {
        const info = await stat(fileOf(name)).catch(() => null);
        if (info === null || !info.isFile()) {
          throw new SourceMissingError(name, dir);
        }
      }
    },
    open(name) {
      return decoded(name, createReadStream(fileOf(name)));
    },
    async verify(name) {
      if (!isGzip(name)) return;
      await verifyGzipFile(fileOf(name));
    },
  };
}

export interface HttpSourceOptions {
  /** The cache directory (the script passes .cache/mtgjson). */
  readonly cacheDir: string;
  readonly fetchImpl?: typeof fetch;
  readonly idleTimeoutMs?: number;
  readonly log?: (line: string) => void;
}

/**
 * Downloads each file from MTGJSON_BASE_URL into `<cacheDir>/<name>.part`,
 * checks the byte count against Content-Length, gunzips a .gz `.part` end to
 * end, then renames it into place (an existing file is replaced only on
 * success). A .gz file must arrive with no Content-Encoding (or identity) and
 * start with the gzip magic bytes, so what is written is the compressed file
 * itself: fetch would otherwise decode it (ADV.3).
 */
export async function download(
  name: MtgjsonFileName,
  {
    cacheDir,
    fetchImpl = fetch,
    idleTimeoutMs = DOWNLOAD_IDLE_TIMEOUT_MS,
    log,
  }: HttpSourceOptions,
): Promise<number> {
  const url = new URL(name, MTGJSON_BASE_URL);
  if (!url.href.startsWith(MTGJSON_BASE_URL) || url.search !== "") {
    throw new DownloadError(name, "refusing a URL outside MTGJSON_BASE_URL");
  }
  const target = path.join(cacheDir, name);
  const part = `${target}.part`;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        controller.abort(
          new DownloadError(name, `no data for ${idleTimeoutMs} ms`),
        ),
      idleTimeoutMs,
    );
  };
  try {
    arm();
    let response: Response;
    try {
      response = await fetchImpl(url.href, {
        // identity: the byte count must match Content-Length, so ask for
        // no transfer compression (a .gz file is compressed already).
        headers: {
          "User-Agent": MTGJSON_USER_AGENT,
          Accept: "*/*",
          "Accept-Encoding": "identity",
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw controller.signal.aborted ? controller.signal.reason : error;
    }
    if (!response.ok) {
      throw new DownloadError(name, `HTTP ${response.status}`);
    }
    if (response.body === null) throw new DownloadError(name, "empty body");
    // Content-Length counts encoded bytes; fetch decodes a compressed
    // transfer, so the count is checked only for an identity body.
    const encoding = (response.headers.get("content-encoding") ?? "identity")
      .trim()
      .toLowerCase();
    const gzip = isGzip(name);
    if (gzip && encoding !== "identity" && encoding !== "") {
      throw new DownloadError(
        name,
        `served with Content-Encoding ${JSON.stringify(encoding.slice(0, 40))}; fetch would decode it, so nothing is written`,
      );
    }
    const header = response.headers.get("content-length");
    const expected =
      header === null || encoding !== "identity" ? null : Number(header);
    let bytes = 0;
    let nextLog = 25_000_000;
    let head = Buffer.alloc(0);
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        if (gzip && head.length < GZIP_MAGIC.length) {
          head = Buffer.concat([head, chunk]).subarray(0, GZIP_MAGIC.length);
          if (!GZIP_MAGIC.subarray(0, head.length).equals(head)) {
            callback(
              new DownloadError(
                name,
                "the body is not gzip data (magic bytes)",
              ),
            );
            return;
          }
        }
        bytes += chunk.length;
        arm();
        if (log && bytes >= nextLog) {
          log(`  ${name}: ${(bytes / 1e6).toFixed(0)} MB`);
          nextLog += 25_000_000;
        }
        callback(null, chunk);
      },
    });
    const body = Readable.fromWeb(response.body as WebReadableStream);
    controller.signal.addEventListener(
      "abort",
      () => body.destroy(controller.signal.reason as Error),
      { once: true },
    );
    await mkdir(cacheDir, { recursive: true });
    await pipeline(body, counter, createWriteStream(part));
    if (bytes === 0) throw new DownloadError(name, "empty body");
    if (expected !== null && Number.isSafeInteger(expected)) {
      if (bytes !== expected) {
        throw new DownloadError(
          name,
          `received ${bytes} bytes, Content-Length ${expected}`,
        );
      }
    }
    if (gzip) {
      if (bytes < GZIP_MAGIC.length) {
        throw new DownloadError(
          name,
          "the body is not gzip data (magic bytes)",
        );
      }
      // The integrity pass runs on the .part, so a bad CRC or a truncation
      // never replaces a good cached file.
      clearTimeout(timer);
      try {
        await verifyGzipFile(part);
      } catch (error) {
        throw new DownloadError(
          name,
          `failed its gzip check (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    await rename(part, target);
    return bytes;
  } catch (error) {
    await unlink(part).catch(() => undefined);
    throw controller.signal.aborted && !(error instanceof DownloadError)
      ? controller.signal.reason
      : error;
  } finally {
    clearTimeout(timer);
  }
}

/** The default source: download into the cache, then read from it. */
export function createHttpSource(options: HttpSourceOptions): MtgjsonSource {
  const dir = createDirSource(options.cacheDir);
  /** Files this source downloaded, whose .part already passed the gzip check. */
  const verified = new Set<string>();
  return {
    description: `MTGJson v5 download, cached in ${options.cacheDir}`,
    async prepare(names) {
      for (const name of names) {
        options.log?.(`downloading ${name}`);
        const bytes = await download(name, options);
        if (isGzip(name)) verified.add(name);
        options.log?.(`  ${name}: ${bytes} bytes`);
      }
    },
    open: (name) => dir.open(name),
    verify: (name) =>
      verified.has(name) ? Promise.resolve() : dir.verify(name),
  };
}

export interface FixtureSource extends MtgjsonSource {
  /** Every name passed to open(), in order (T13: AllPrices is never opened). */
  readonly opened: string[];
}

/**
 * Tests only: files held in memory, .gz ones as gzip bytes. Never touches
 * the network or the cache.
 */
export function createFixtureSource(
  files: Partial<Record<MtgjsonFileName, Buffer | string>>,
): FixtureSource {
  const opened: string[] = [];
  const bytesOf = (name: MtgjsonFileName): Buffer => {
    const value = files[name];
    if (value === undefined) throw new SourceMissingError(name, "the fixtures");
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  };
  const raw = (name: MtgjsonFileName): Readable => {
    const stream = new PassThrough();
    stream.end(bytesOf(name));
    return stream;
  };
  return {
    description: "fixtures",
    opened,
    async prepare(names) {
      for (const name of names) bytesOf(name);
    },
    open(name) {
      opened.push(name);
      return decoded(name, raw(name));
    },
    async verify(name) {
      if (!isGzip(name)) return;
      await pipeline(raw(name), createGunzip(), nullSink());
    },
  };
}
