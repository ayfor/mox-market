// T19 (AC-13 harness; S0.3d19): the evidence harness refuses, before it
// connects, every database S0.2's path B guard refuses, and has no
// production flag; redateStream re-dates exactly the quoted dates however the
// input is split.
import { PassThrough, Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { describe, expect, test } from "vitest";
import { createFixtureSource } from "../src/lib/mtgjson/source";
import { IngestRefusedError, UsageError } from "../src/lib/mtgjson/target";
import {
  EVIDENCE_FLAGS,
  parseEvidenceArgs,
  redateStream,
  redatingSource,
  resolveEvidenceTarget,
} from "./sync-evidence";

const LOCAL = "postgresql://postgres@localhost:55432/mox_s03_evidence";

describe("arguments (T19)", () => {
  test("defaults: .cache/mtgjson and day 0 only", () => {
    expect(parseEvidenceArgs([])).toEqual({
      sourceDir: ".cache/mtgjson",
      days: 0,
    });
    expect(
      parseEvidenceArgs(["--source-dir", "/tmp/x", "--days", "7"]),
    ).toEqual({ sourceDir: "/tmp/x", days: 7 });
  });

  test("has no production flag and refuses one", () => {
    expect(Object.keys(EVIDENCE_FLAGS).sort()).toEqual(["days", "source-dir"]);
    for (const argv of [
      ["--production"],
      ["--dry-run"],
      ["--allow-prod-ingest"],
      ["positional"],
    ]) {
      expect(() => parseEvidenceArgs(argv)).toThrow(UsageError);
    }
  });

  test.each([["-1"], ["32"], ["1.5"], ["seven"]])(
    "--days %s is refused",
    (days) => {
      expect(() => parseEvidenceArgs(["--days", days])).toThrow(UsageError);
    },
  );

  test("a URL passed as --source-dir is refused", () => {
    expect(() =>
      parseEvidenceArgs(["--source-dir", "postgresql://u:p@h/db"]),
    ).toThrow(UsageError);
  });
});

describe("the target guard runs before any connection (T19)", () => {
  test("a local URL with port and database is accepted", () => {
    expect(resolveEvidenceTarget({ POSTGRES_URL_NON_POOLING: LOCAL })).toEqual({
      url: LOCAL,
      display: "localhost:55432/mox_s03_evidence",
    });
  });

  test.each([
    ["unset", undefined],
    ["empty", ""],
    ["a remote host", "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres"],
    [
      "the pooler",
      "postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    ],
    ["hostaddr", `${LOCAL}?hostaddr=10.0.0.5`],
    ["a host parameter", `${LOCAL}?host=db.example.invalid`],
    ["a local host parameter", `${LOCAL}?host=localhost`],
    ["::1", "postgresql://u@[::1]:55432/db"],
    ["a socket directory", "postgresql://u@%2Ftmp:55432/db"],
    ["no port", "postgresql://u@localhost/db"],
    ["no database", "postgresql://u@localhost:55432/"],
    ["a port parameter", `${LOCAL}?port=5433`],
    ["a dbname parameter", `${LOCAL}?dbname=postgres`],
    ["an upper-case LOCALHOST", "postgresql://u@LOCALHOST:55432/db"],
    ["not a postgres URL", "mysql://u@localhost:3306/db"],
    ["unparsable", "not a url"],
    [
      "a remote host listed after a local one",
      "postgresql://u@localhost:55432,db.example.invalid:5432/db",
    ],
  ])("%s is refused with IngestRefusedError", (_label, url) => {
    expect(() =>
      resolveEvidenceTarget({ POSTGRES_URL_NON_POOLING: url }),
    ).toThrow(IngestRefusedError);
  });

  test("a remote host is refused even with ALLOW_PROD_INGEST=1 in the environment", () => {
    expect(() =>
      resolveEvidenceTarget({
        POSTGRES_URL_NON_POOLING:
          "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres",
        ALLOW_PROD_INGEST: "1",
      }),
    ).toThrow(IngestRefusedError);
  });
});

/** Runs input through redateStream split into the given chunks. */
async function redate(
  chunks: readonly Buffer[],
  from = "2026-10-10",
  to = "2026-10-17",
): Promise<string> {
  return text(Readable.from(chunks).pipe(redateStream(from, to)));
}

describe("redateStream (T19)", () => {
  const input =
    '{"meta":{"date":"2026-10-10","version":"5.3.0+20261010"},"data":{"u":{"paper":{"tcgplayer":{"retail":{"normal":{"2026-10-10":1.5}}}}},"v":"2026-10-10"}}';
  const expected = input.split('"2026-10-10"').join('"2026-10-17"');

  test("replaces every quoted date in one chunk", async () => {
    expect(await redate([Buffer.from(input)])).toBe(expected);
    expect(expected).toContain('"version":"5.3.0+20261010"');
  });

  test("gives the same output when the input is split at every byte offset", async () => {
    const bytes = Buffer.from(input);
    for (let at = 0; at <= bytes.length; at += 1) {
      const out = await redate([bytes.subarray(0, at), bytes.subarray(at)]);
      expect(out, `split at ${at}`).toBe(expected);
    }
  });

  test("gives the same output one byte at a time", async () => {
    const bytes = Buffer.from(input);
    const chunks = [...bytes].map((b) => Buffer.from([b]));
    expect(await redate(chunks)).toBe(expected);
  });

  test("leaves unquoted, partial and other dates alone", async () => {
    const other =
      '2026-10-10 "2026-10-1" "2026-10-100" x2026-10-10" "2026-10-10T00:00Z" "2026-10-11"';
    expect(await redate([Buffer.from(other)])).toBe(other);
  });

  test("handles input shorter than the needle and empty input", async () => {
    expect(await redate([Buffer.from('"2026')])).toBe('"2026');
    expect(await redate([])).toBe("");
  });

  test("keeps multi-byte characters intact across splits", async () => {
    const accented = 'é"2026-10-10"ü🔑"2026-10-10"';
    const bytes = Buffer.from(accented);
    for (let at = 0; at <= bytes.length; at += 1) {
      const out = await redate([bytes.subarray(0, at), bytes.subarray(at)]);
      expect(out).toBe('é"2026-10-17"ü🔑"2026-10-17"');
    }
  });

  test("refuses anything but two calendar dates", () => {
    expect(() => redateStream("2026-10-10", "2026-02-30")).toThrow(TypeError);
    expect(() => redateStream("x", "2026-10-10")).toThrow(TypeError);
  });

  test("redatingSource re-dates Meta.json and AllPricesToday only, and passes errors through", async () => {
    const source = redatingSource(
      createFixtureSource({
        "Meta.json": '{"meta":{"date":"2026-10-10"},"data":{}}',
        "AllPrices.json.gz": Buffer.alloc(0),
      }),
      "2026-10-10",
      "2026-10-12",
    );
    expect(await text(source.open("Meta.json"))).toBe(
      '{"meta":{"date":"2026-10-12"},"data":{}}',
    );
    expect(source.description).toMatch(/re-dated 2026-10-10 → 2026-10-12/);
    const failing = redatingSource(
      {
        description: "failing",
        prepare: async () => undefined,
        verify: async () => undefined,
        open: () => {
          const stream = new PassThrough();
          setImmediate(() => stream.destroy(new Error("disk gone")));
          return stream;
        },
      },
      "2026-10-10",
      "2026-10-12",
    );
    await expect(text(failing.open("Meta.json"))).rejects.toThrow("disk gone");
  });
});
