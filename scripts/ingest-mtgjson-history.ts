// The MTGJson bulk history ingest (F0 W1 and W4; S0.2d18). Run from the
// repo root on Node 22:
//
//   npx tsx scripts/ingest-mtgjson-history.ts --dry-run              # path A
//   npx tsx scripts/ingest-mtgjson-history.ts --source-dir .cache/mtgjson   # path B
//
// Path C (--production) is Josh's alone, from his laptop, after his
// sign-off: docs/runbooks/mtgjson-ingest.md. No agent, test or CI job runs
// it (S0.2d24).
//
// ALLOW_PROD_INGEST is captured from the environment before .env loads, so a
// copy stored in any .env* file never counts (as prisma.config.ts does for
// ALLOW_PROD_MIGRATE). The target guard runs before any download or
// connection; the report never prints a URL, a credential or an environment
// value. Exit codes: 0 ok, 1 run error, 2 refused before any write (usage,
// guard, version, source, gzip check, budget pre-check), 3 budget_stop.
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { createIngestDb } from "../src/lib/mtgjson/db";
import { EXIT, runBulkIngest } from "../src/lib/mtgjson/ingest";
import { formatReport } from "../src/lib/mtgjson/report";
import { createDirSource, createHttpSource } from "../src/lib/mtgjson/source";
import { errorText, sanitizeErrorMessage } from "../src/lib/mtgjson/store";
import {
  IngestRefusedError,
  parseCliArgs,
  resolveTarget,
  targetLine,
  usage,
  UsageError,
} from "../src/lib/mtgjson/target";

/** Where the default (download) source caches MTGJson's files: gitignored. */
const CACHE_DIR = path.resolve(".cache", "mtgjson");

const inlineAllowProdIngest = process.env.ALLOW_PROD_INGEST;

const out = (line: string) => process.stdout.write(`${line}\n`);
const err = (line: string) => process.stderr.write(`${line}\n`);

async function main(): Promise<number> {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    err(`usage error: ${error instanceof Error ? error.message : error}`);
    err(usage());
    return EXIT.refused;
  }
  if (options.help) {
    out(usage());
    return EXIT.ok;
  }

  // .env is loaded after the flag was captured, and never overrides the shell.
  loadDotenv({ quiet: true });
  const target = resolveTarget(options, process.env, inlineAllowProdIngest);
  out(targetLine(target));

  const source =
    options.sourceDir !== null
      ? createDirSource(path.resolve(options.sourceDir))
      : createHttpSource({ cacheDir: CACHE_DIR, log: err });

  const { exitCode, report } = await runBulkIngest(
    {
      target,
      identifiersOnly: options.identifiersOnly,
      basisSample:
        options.basisSample === null
          ? undefined
          : { size: options.basisSample, seed: options.seed ?? undefined },
    },
    {
      source,
      now: () => new Date(),
      dbFactory: (write) => createIngestDb(write.url, { caCert: write.caCert }),
      log: err,
    },
  );
  out(formatReport(report));
  if (exitCode === EXIT.budgetStop) {
    err(
      "budget_stop: the database passed 450 MB. Earlier chunks are committed and the prune ran. Stop and ask Bitey before any re-run.",
    );
  }
  return exitCode;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof IngestRefusedError || error instanceof UsageError) {
      err(sanitizeErrorMessage(error.message));
      process.exitCode = EXIT.refused;
      return;
    }
    err(
      `run error: ${sanitizeErrorMessage(errorText(error))}. Earlier chunks stay committed; a re-run is safe.`,
    );
    process.exitCode = EXIT.error;
  },
);
