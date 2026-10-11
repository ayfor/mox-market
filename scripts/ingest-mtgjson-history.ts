// The MTGJson bulk history ingest (F0 W1 and W4; S0.2d18). Run on Node 22:
//
//   npx tsx scripts/ingest-mtgjson-history.ts --dry-run              # path A
//   npx tsx scripts/ingest-mtgjson-history.ts --source-dir .cache/mtgjson   # path B
//
// Path C (--production) is Josh's alone, from his laptop, after his
// sign-off: docs/runbooks/mtgjson-ingest.md. No agent, test or CI job runs
// it (S0.2d24).
//
// The first import captures ALLOW_PROD_INGEST before any other module or the
// .env loader runs, so a copy stored in any .env* file never counts (as
// prisma.config.ts does for ALLOW_PROD_MIGRATE). Everything else is runCli
// (src/lib/mtgjson/cli.ts): the guard before any download or connection, a
// report that never prints a URL, a credential or an environment value, and
// the exit codes: 0 ok, 1 run error (an interrupt included), 2 refused before
// any write, 3 budget_stop. The cache and .env resolve from the repository
// root, wherever the script is run from.
//
// organize-imports-ignore: the capture import must stay first, so Prettier's
// import sorting is off for this file.
import { INLINE_ALLOW_PROD_INGEST } from "./capture-inline-flags";

import { config as loadDotenv } from "dotenv";
import { interruptHandler, REPO_DOTENV, runCli } from "../src/lib/mtgjson/cli";
import { EXIT } from "../src/lib/mtgjson/ingest";

const out = (line: string) => process.stdout.write(`${line}\n`);
const err = (line: string) => process.stderr.write(`${line}\n`);

const controller = new AbortController();
let runStarted = false;
const onSignal = interruptHandler({
  controller,
  isRunStarted: () => runStarted,
  err,
  exit: (code) => process.exit(code),
});
process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));

runCli({
  argv: process.argv.slice(2),
  env: process.env,
  inlineAllowProdIngest: INLINE_ALLOW_PROD_INGEST,
  loadEnv: () => {
    loadDotenv({ path: REPO_DOTENV, quiet: true });
  },
  out,
  err,
  signal: controller.signal,
  onRunStarted: () => {
    runStarted = true;
  },
}).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.exitCode = EXIT.error;
  },
);
