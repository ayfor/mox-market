// The AC-13 evidence harness (S0.3d19, S0.3d20): runDailySync, exactly as the
// route runs it (the same prismaDb adapter over a Prisma client), against a
// LOCAL database and the MTGJson files cached in a directory. Run on Node 22:
//
//   POSTGRES_URL_NON_POOLING=<localhost URL> npx tsx scripts/sync-evidence.ts --source-dir .cache/mtgjson --days 7
//
// Day 0 is the real run (E1): the cached Meta.json and AllPricesToday.json.gz
// as they are, with the clock at the files' date, 17:00 UTC. `--days N` then
// repeats the sync on the next N dates (E2), re-dating both files as they
// stream (redateStream), so no rewritten copy of either file is ever written.
// After each day it prints the run summary, wall time, peak RSS, phase
// timings and price_history's size and tuple counts.
//
// The database is resolved with S0.2's resolveTarget in path B mode only: an
// unset URL, any host but localhost or 127.0.0.1, hostaddr, a host query
// parameter and every other path B refusal stop it before it connects. There
// is no production flag and ALLOW_PROD_INGEST is never read. Nothing here
// calls an HTTP route.
import { Transform, type Readable } from "node:stream";
import { parseArgs } from "node:util";
import {
  ALL_PRICES_TODAY_FILE,
  META_FILE,
  type MtgjsonFileName,
} from "../src/lib/mtgjson/consts";
import { readMeta } from "../src/lib/mtgjson/parse";
import { prismaDb } from "../src/lib/mtgjson/prisma-db";
import { createDirSource, type MtgjsonSource } from "../src/lib/mtgjson/source";
import { errorText, sanitizeErrorMessage } from "../src/lib/mtgjson/store";
import { runDailySync } from "../src/lib/mtgjson/sync";
import {
  IngestRefusedError,
  resolveTarget,
  UsageError,
} from "../src/lib/mtgjson/target";
import { addDays, isCalendarDate } from "../src/lib/mtgjson/transform";

export interface EvidenceOptions {
  readonly sourceDir: string;
  readonly days: number;
}

/** The harness's flags: no production flag, ever. */
export const EVIDENCE_FLAGS = {
  "source-dir": { type: "string" },
  days: { type: "string" },
} as const;

/** Strict argv parse: --source-dir (default .cache/mtgjson) and --days 0-31. */
export function parseEvidenceArgs(argv: readonly string[]): EvidenceOptions {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: EVIDENCE_FLAGS,
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
  const sourceDir =
    typeof values["source-dir"] === "string"
      ? values["source-dir"]
      : ".cache/mtgjson";
  if (sourceDir.trim() === "" || /:\/\/|@/.test(sourceDir)) {
    throw new UsageError("--source-dir takes a directory path");
  }
  const daysText = typeof values.days === "string" ? values.days : "0";
  const days = /^\d+$/.test(daysText) ? Number(daysText) : NaN;
  if (!Number.isSafeInteger(days) || days > 31) {
    throw new UsageError("--days takes an integer from 0 to 31");
  }
  return { sourceDir, days };
}

/**
 * The local target, or IngestRefusedError before any connection: S0.2's
 * path B guard (production off, no inline flag).
 */
export function resolveEvidenceTarget(
  env: Readonly<Record<string, string | undefined>>,
): { readonly url: string; readonly display: string } {
  const target = resolveTarget(
    { dryRun: false, production: false },
    env,
    undefined,
  );
  if (target.kind !== "local") {
    throw new IngestRefusedError("the evidence harness writes only locally");
  }
  return { url: target.url, display: target.display };
}

/**
 * A stream that replaces every quoted `"from"` with `"to"` (both calendar
 * dates), however the input is split: the last needle-length − 1 bytes are
 * carried into the next chunk. Unquoted or partial dates pass unchanged.
 */
export function redateStream(from: string, to: string): Transform {
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    throw new TypeError("redateStream takes two calendar dates");
  }
  const needle = Buffer.from(`"${from}"`);
  const replacement = Buffer.from(`"${to}"`);
  let carry = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
      // A match starting before `cut` ends inside `data`.
      const cut = data.length - Math.min(data.length, needle.length - 1);
      const parts: Buffer[] = [];
      let at = 0;
      let found = data.indexOf(needle, at);
      while (found !== -1 && found < cut) {
        parts.push(data.subarray(at, found), replacement);
        at = found + needle.length;
        found = data.indexOf(needle, at);
      }
      const end = Math.max(at, cut);
      parts.push(data.subarray(at, end));
      carry = Buffer.from(data.subarray(end));
      callback(null, Buffer.concat(parts));
    },
    flush(callback) {
      // The carry is shorter than the needle, so it holds no match.
      callback(null, carry);
    },
  });
}

/** A source whose Meta.json and AllPricesToday read as dated `to`. */
export function redatingSource(
  base: MtgjsonSource,
  from: string,
  to: string,
): MtgjsonSource {
  const redated = new Set<MtgjsonFileName>([META_FILE, ALL_PRICES_TODAY_FILE]);
  return {
    description: `${base.description}, re-dated ${from} → ${to}`,
    prepare: (names) => base.prepare(names),
    verify: (name) => base.verify(name),
    open(name): Readable {
      const input = base.open(name);
      if (!redated.has(name)) return input;
      const output = redateStream(from, to);
      input.on("error", (error) => output.destroy(error));
      output.on("close", () => input.destroy());
      input.pipe(output);
      return output;
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<number> {
  const out = (line: string) => process.stdout.write(`${line}\n`);
  let options: EvidenceOptions;
  let target: { url: string; display: string };
  try {
    options = parseEvidenceArgs(process.argv.slice(2));
    target = resolveEvidenceTarget(process.env);
  } catch (error) {
    process.stderr.write(`${sanitizeErrorMessage(errorText(error))}\n`);
    return 2;
  }
  out(`target database: ${target.display} (local)`);

  const base = createDirSource(options.sourceDir);
  await base.prepare([META_FILE, ALL_PRICES_TODAY_FILE]);
  const meta = await readMeta(base.open(META_FILE), META_FILE);
  if (!isCalendarDate(meta.date)) {
    process.stderr.write("Meta.json has no calendar date\n");
    return 2;
  }
  const fileDate = meta.date;
  out(`source: ${base.description}, Meta.json ${fileDate} ${meta.version}`);

  const { PrismaClient } = await import("../src/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { runtimePoolConfig } = await import("../src/lib/prisma-pool");
  const client = new PrismaClient({
    adapter: new PrismaPg(runtimePoolConfig(target.url)),
  });
  const db = prismaDb(client);
  let failed = false;
  try {
    for (let day = 0; day <= options.days; day += 1) {
      const runDate = addDays(fileDate, day);
      const source = day === 0 ? base : redatingSource(base, fileDate, runDate);
      const now = new Date(`${runDate}T17:00:00.000Z`);
      const t0 = performance.now();
      const result = await runDailySync({ db, source, now: () => now });
      const wallMs = Math.round(performance.now() - t0);
      const peakRssBytes = process.resourceUsage().maxRSS * 1024;
      // Statistics reach pg_stat_user_tables asynchronously.
      await sleep(1_000);
      const [size] = (await client.$queryRawUnsafe(
        `SELECT pg_total_relation_size('price_history')::text AS "total",
  pg_relation_size('price_history')::text AS "heap",
  pg_indexes_size('price_history')::text AS "indexes",
  (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'price_history')::text AS "live",
  (SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'price_history')::text AS "dead",
  (SELECT count(*) FROM price_history)::text AS "rows"`,
      )) as Record<string, string>[];
      const { priceStats, ...summary } = result;
      out(
        JSON.stringify({
          day,
          runDate,
          wallMs,
          peakRssBytes,
          rowsEmitted: priceStats
            ? priceStats.rowsByFinish.normal +
              priceStats.rowsByFinish.foil +
              priceStats.rowsByFinish.etched
            : null,
          scryfallCollisions: priceStats?.scryfallCollisions ?? null,
          ...summary,
          priceHistory: size,
        }),
      );
      if (result.status !== "ok") failed = true;
    }
  } finally {
    await client.$disconnect();
  }
  return failed ? 1 : 0;
}

if (/sync-evidence\.ts$/.test(process.argv[1] ?? "")) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${sanitizeErrorMessage(errorText(error))}\n`);
      process.exitCode = 1;
    },
  );
}
