// Where MTGJson files come from (S0.2d4; AC-4, AC-5). One interface, three
// implementations: createHttpSource (download from MTGJSON_BASE_URL into the
// gitignored cache, then read from there), createDirSource (--source-dir,
// no network) and createFixtureSource (tests, in memory).
//
// A .gz file is never decompressed to disk: `open` gunzips it as a stream
// each time it is read, and `verify` reads it once end to end into a null
// sink so a truncated or corrupted download fails on its gzip CRC before any
// database connection. The only file writer in this module is `download`,
// whose input is the raw response body (T7).
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
      await pipeline(
        createReadStream(fileOf(name)),
        createGunzip(),
        nullSink(),
      );
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
 * checks the byte count against Content-Length, then renames it into place
 * (an existing file is replaced only on success). The body stream is written
 * as received: compressed bytes for a .gz file.
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
    const header = response.headers.get("content-length");
    const expected =
      header === null || encoding !== "identity" ? null : Number(header);
    let bytes = 0;
    let nextLog = 25_000_000;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
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
  return {
    description: `MTGJson v5 download, cached in ${options.cacheDir}`,
    async prepare(names) {
      for (const name of names) {
        options.log?.(`downloading ${name}`);
        const bytes = await download(name, options);
        options.log?.(`  ${name}: ${bytes} bytes`);
      }
    },
    open: (name) => dir.open(name),
    verify: (name) => dir.verify(name),
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
