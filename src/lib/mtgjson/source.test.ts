// T16 (AC-4, AC-5; S0.2d4): downloads land as .part, are size-checked, then
// renamed; failures leave no final file and no .part; only MTGJSON_BASE_URL
// is requested, with the User-Agent; the cache holds only Meta.json and .gz
// files; the integrity pass catches truncation and a flipped CRC byte. fetch
// is a stub and the cache is a temp directory: no network.
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { metaJson } from "./__fixtures__/build";
import {
  ALL_IDENTIFIERS_FILE,
  ALL_PRICES_FILE,
  META_FILE,
  MTGJSON_BASE_URL,
} from "./consts";
import {
  createDirSource,
  createFixtureSource,
  createHttpSource,
  download,
  DownloadError,
  MTGJSON_USER_AGENT,
  SourceMissingError,
} from "./source";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mtgjson-source-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const GZ = gzipSync(
  Buffer.from('{"meta":{"date":"2026-10-05","version":"5.3.0"},"data":{}}'),
);

/** A stub fetch that answers each file from a table and records requests. */
function stubFetch(answers: Record<string, () => Response>): {
  fetchImpl: typeof fetch;
  requests: { url: string; headers: Headers }[];
} {
  const requests: { url: string; headers: Headers }[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    const name = url.slice(MTGJSON_BASE_URL.length);
    const answer = answers[name];
    if (!answer) return new Response("not found", { status: 404 });
    return answer();
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const ok = (body: Buffer, length: number | null = body.length) =>
  new Response(body, {
    status: 200,
    headers: length === null ? {} : { "content-length": String(length) },
  });

describe("a .gz download never writes a decoded or corrupt file over the cache (T16, ADV.3)", () => {
  const JSON_BODY =
    '{"meta":{"date":"2026-10-05","version":"5.3.0"},"data":{"a":1}}';

  /** A good cached AllPrices.json.gz; returns its bytes. */
  const seedCache = () => {
    writeFileSync(path.join(dir, ALL_PRICES_FILE), GZ);
    return GZ;
  };

  test.each(["gzip", "br", "deflate", "x-gzip"])(
    "a Content-Encoding %s is refused before anything is written, and the cached file stays",
    async (encoding) => {
      const good = seedCache();
      const { fetchImpl } = stubFetch({
        [ALL_PRICES_FILE]: () =>
          new Response(JSON_BODY, {
            headers: { "content-encoding": encoding },
          }),
      });
      const error = await download(ALL_PRICES_FILE, {
        cacheDir: dir,
        fetchImpl,
      }).catch((e) => e);
      expect(error).toBeInstanceOf(DownloadError);
      expect(error.message).toMatch(
        /served with Content-Encoding .*; fetch would decode it, so nothing is written/,
      );
      expect(readdirSync(dir)).toEqual([ALL_PRICES_FILE]);
      expect(readFileSync(path.join(dir, ALL_PRICES_FILE))).toEqual(good);
    },
  );

  test("Meta.json (not gzip at rest) may still arrive transfer-compressed", async () => {
    const { fetchImpl } = stubFetch({
      [META_FILE]: () =>
        new Response(metaJson(), { headers: { "content-encoding": "gzip" } }),
    });
    await download(META_FILE, { cacheDir: dir, fetchImpl });
    expect(readFileSync(path.join(dir, META_FILE), "utf8")).toBe(metaJson());
  });

  test("an identity body that is not gzip (no 1f 8b) is refused, and the cached file stays", async () => {
    const good = seedCache();
    const { fetchImpl } = stubFetch({
      [ALL_PRICES_FILE]: () => ok(Buffer.from(JSON_BODY)),
    });
    await expect(
      download(ALL_PRICES_FILE, { cacheDir: dir, fetchImpl }),
    ).rejects.toThrow(/the body is not gzip data \(magic bytes\)/);
    expect(readdirSync(dir)).toEqual([ALL_PRICES_FILE]);
    expect(readFileSync(path.join(dir, ALL_PRICES_FILE))).toEqual(good);
  });

  test("the magic bytes are checked across chunk boundaries", async () => {
    const { fetchImpl } = stubFetch({
      [ALL_PRICES_FILE]: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([0x1f]));
              controller.enqueue(new Uint8Array([0x00, 0x01]));
              controller.close();
            },
          }),
        ),
    });
    await expect(
      download(ALL_PRICES_FILE, { cacheDir: dir, fetchImpl }),
    ).rejects.toThrow(/magic bytes/);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a full-length body with a flipped CRC byte fails its gzip check on the .part, and the cached file stays", async () => {
    const good = seedCache();
    const bad = Buffer.from(GZ);
    bad[bad.length - 6] ^= 0xff;
    const { fetchImpl } = stubFetch({ [ALL_PRICES_FILE]: () => ok(bad) });
    const error = await download(ALL_PRICES_FILE, {
      cacheDir: dir,
      fetchImpl,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(error.message).toMatch(/failed its gzip check/);
    expect(readdirSync(dir)).toEqual([ALL_PRICES_FILE]);
    expect(readFileSync(path.join(dir, ALL_PRICES_FILE))).toEqual(good);
  });

  test("a truncated body with no Content-Length fails its gzip check, and nothing is left", async () => {
    const { fetchImpl } = stubFetch({
      [ALL_PRICES_FILE]: () => ok(GZ.subarray(0, GZ.length - 8), null),
    });
    await expect(
      download(ALL_PRICES_FILE, { cacheDir: dir, fetchImpl }),
    ).rejects.toThrow(/failed its gzip check/);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("the http source skips the second integrity pass for a file it just verified", async () => {
    const { fetchImpl } = stubFetch({
      [META_FILE]: () => ok(Buffer.from(metaJson())),
      [ALL_PRICES_FILE]: () => ok(GZ),
    });
    const source = createHttpSource({ cacheDir: dir, fetchImpl });
    await source.prepare([META_FILE, ALL_PRICES_FILE]);
    // Corrupt the cached copy behind the source's back: verify() trusts the
    // pass the .part already made in this process, so it does not re-read.
    writeFileSync(path.join(dir, ALL_PRICES_FILE), Buffer.from("not gzip"));
    await expect(source.verify(ALL_PRICES_FILE)).resolves.toBeUndefined();
    // A directory source always re-reads.
    await expect(
      createDirSource(dir).verify(ALL_PRICES_FILE),
    ).rejects.toThrow();
  });
});

describe("download (T16)", () => {
  test("writes <name>.part, checks the byte count, then renames", async () => {
    const { fetchImpl, requests } = stubFetch({
      [ALL_PRICES_FILE]: () => ok(GZ),
    });
    const bytes = await download(ALL_PRICES_FILE, { cacheDir: dir, fetchImpl });
    expect(bytes).toBe(GZ.length);
    expect(readdirSync(dir)).toEqual([ALL_PRICES_FILE]);
    expect(readFileSync(path.join(dir, ALL_PRICES_FILE))).toEqual(GZ);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`${MTGJSON_BASE_URL}${ALL_PRICES_FILE}`);
    expect(requests[0].headers.get("user-agent")).toBe(MTGJSON_USER_AGENT);
    expect(requests[0].headers.get("accept-encoding")).toBe("identity");
  });

  test("a short body (Content-Length mismatch) rejects and leaves no final file and no .part", async () => {
    const { fetchImpl } = stubFetch({
      [ALL_PRICES_FILE]: () => ok(GZ, GZ.length + 100),
    });
    await expect(
      download(ALL_PRICES_FILE, { cacheDir: dir, fetchImpl }),
    ).rejects.toThrow(/received \d+ bytes, Content-Length \d+/);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a transfer-compressed body is not held to Content-Length", async () => {
    const { fetchImpl } = stubFetch({
      [META_FILE]: () =>
        new Response(metaJson(), {
          headers: { "content-length": "86", "content-encoding": "br" },
        }),
    });
    await download(META_FILE, { cacheDir: dir, fetchImpl });
    expect(readFileSync(path.join(dir, META_FILE), "utf8")).toBe(metaJson());
  });

  test.each([404, 500])(
    "HTTP %s rejects, naming the file and the status",
    async (status) => {
      const { fetchImpl } = stubFetch({
        [ALL_PRICES_FILE]: () => new Response("x", { status }),
      });
      const error = await download(ALL_PRICES_FILE, {
        cacheDir: dir,
        fetchImpl,
      }).catch((e) => e);
      expect(error).toBeInstanceOf(DownloadError);
      expect(error.message).toBe(`${ALL_PRICES_FILE}: HTTP ${status}`);
      expect(readdirSync(dir)).toEqual([]);
    },
  );

  test("a body that stalls past the idle timeout aborts", async () => {
    const { fetchImpl } = stubFetch({
      [ALL_PRICES_FILE]: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(GZ.subarray(0, 10)));
              // never closes
            },
          }),
          { headers: { "content-length": String(GZ.length) } },
        ),
    });
    const error = await download(ALL_PRICES_FILE, {
      cacheDir: dir,
      fetchImpl,
      idleTimeoutMs: 50,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(error.message).toMatch(/no data for 50 ms/);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("an existing final file is replaced only on success", async () => {
    writeFileSync(path.join(dir, ALL_PRICES_FILE), "old");
    const bad = stubFetch({
      [ALL_PRICES_FILE]: () => new Response("x", { status: 500 }),
    });
    await expect(
      download(ALL_PRICES_FILE, { cacheDir: dir, fetchImpl: bad.fetchImpl }),
    ).rejects.toThrow();
    expect(readFileSync(path.join(dir, ALL_PRICES_FILE), "utf8")).toBe("old");
    const good = stubFetch({ [ALL_PRICES_FILE]: () => ok(GZ) });
    await download(ALL_PRICES_FILE, {
      cacheDir: dir,
      fetchImpl: good.fetchImpl,
    });
    expect(readFileSync(path.join(dir, ALL_PRICES_FILE))).toEqual(GZ);
  });

  test("an empty body is refused", async () => {
    const { fetchImpl } = stubFetch({
      [ALL_PRICES_FILE]: () => ok(Buffer.alloc(0), null),
    });
    await expect(
      download(ALL_PRICES_FILE, { cacheDir: dir, fetchImpl }),
    ).rejects.toThrow(/empty body/);
  });
});

describe("createHttpSource (T16)", () => {
  test("requests only MTGJSON_BASE_URL, and the cache holds only Meta.json and .gz files", async () => {
    const { fetchImpl, requests } = stubFetch({
      [META_FILE]: () => ok(Buffer.from(metaJson())),
      [ALL_IDENTIFIERS_FILE]: () => ok(GZ),
      [ALL_PRICES_FILE]: () => ok(GZ),
    });
    const source = createHttpSource({ cacheDir: dir, fetchImpl });
    await source.prepare([META_FILE, ALL_IDENTIFIERS_FILE, ALL_PRICES_FILE]);
    await source.verify(ALL_PRICES_FILE);
    const chunks: Buffer[] = [];
    for await (const chunk of source.open(ALL_PRICES_FILE))
      chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toContain('"meta"');
    expect(requests.every((r) => r.url.startsWith(MTGJSON_BASE_URL))).toBe(
      true,
    );
    expect(
      requests.every((r) => r.headers.get("user-agent") === MTGJSON_USER_AGENT),
    ).toBe(true);
    const files = readdirSync(dir).sort();
    expect(files).toEqual(
      [ALL_IDENTIFIERS_FILE, ALL_PRICES_FILE, META_FILE].sort(),
    );
    expect(files.every((f) => f === META_FILE || f.endsWith(".gz"))).toBe(true);
    expect(source.description).not.toMatch(/:\/\//);
  });
});

describe("createDirSource and verifyGzip (T16)", () => {
  test("a missing file rejects with SourceMissingError naming it", async () => {
    writeFileSync(path.join(dir, META_FILE), metaJson());
    const source = createDirSource(dir);
    const error = await source
      .prepare([META_FILE, ALL_PRICES_FILE])
      .catch((e) => e);
    expect(error).toBeInstanceOf(SourceMissingError);
    expect(error.file).toBe(ALL_PRICES_FILE);
    expect(error.message).toContain(ALL_PRICES_FILE);
  });

  test("verify passes a good file", async () => {
    writeFileSync(path.join(dir, ALL_PRICES_FILE), GZ);
    await expect(
      createDirSource(dir).verify(ALL_PRICES_FILE),
    ).resolves.toBeUndefined();
  });

  test("verify rejects a truncated file", async () => {
    writeFileSync(
      path.join(dir, ALL_PRICES_FILE),
      GZ.subarray(0, GZ.length - 8),
    );
    await expect(
      createDirSource(dir).verify(ALL_PRICES_FILE),
    ).rejects.toMatchObject({
      code: "Z_BUF_ERROR",
    });
  });

  test("verify rejects a flipped CRC byte", async () => {
    const bad = Buffer.from(GZ);
    bad[bad.length - 6] ^= 0xff;
    writeFileSync(path.join(dir, ALL_PRICES_FILE), bad);
    await expect(
      createDirSource(dir).verify(ALL_PRICES_FILE),
    ).rejects.toMatchObject({
      code: "Z_DATA_ERROR",
    });
  });

  test("verify and open never write a decompressed copy", async () => {
    writeFileSync(path.join(dir, ALL_PRICES_FILE), GZ);
    const source = createDirSource(dir);
    await source.verify(ALL_PRICES_FILE);
    for await (const chunk of source.open(ALL_PRICES_FILE)) void chunk;
    expect(readdirSync(dir)).toEqual([ALL_PRICES_FILE]);
  });

  test("the fixture source records what it opened and rejects a missing file", async () => {
    const source = createFixtureSource({ [META_FILE]: metaJson() });
    await expect(
      source.prepare([META_FILE, ALL_PRICES_FILE]),
    ).rejects.toBeInstanceOf(SourceMissingError);
    for await (const chunk of source.open(META_FILE)) void chunk;
    expect(source.opened).toEqual([META_FILE]);
  });
});
