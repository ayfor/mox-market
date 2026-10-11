#!/usr/bin/env node
// Generates docs/test-report.md from the Vitest suite (S1.1, AC-6 and AC-7).
//
//   npm run test:report
//   node scripts/test-report.mjs [--config <vitest config>] [--out <path>]
//
// Runs Vitest's JSON reporter, groups results by feature (F0 to F5, then
// Unmapped) and by test type (unit / component / integration), and writes a
// committed markdown report. Report-on-red: whenever Vitest leaves its JSON,
// the report is written; the script then exits non-zero unless every check
// passed, so CI can gate on it. Adapted from billd's scripts/test-report.mjs
// (S1.1d13).

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

// --- feature map (S1.1d12) ---------------------------------------------------
// Matched in this order (first match wins); displayed as F0 to F5, then
// Unmapped. Extended per phase.
export const FEATURES = [
  [
    "F0 · Price History",
    [/price-history/i, /price_history/i, /price-sync/i, /mtgjson/i],
  ],
  [
    "F3 · Market Adjustments",
    [
      /src\/lib\/recommendation\/(tier2|tiered|adjust|trend|volatil|shock|liquidity)/,
    ],
  ],
  ["F4 · Card Classification", [/classif/i, /categor/i]],
  [
    "F5 · Recommendation Log",
    [
      /recommendation-log/,
      /log-recommendation/,
      /logRecommendation/,
      /disagree/,
      /src\/lib\/ops\//,
    ],
  ],
  [
    "F2 · Live Evaluation",
    [
      /src\/app\/(\[card\]|evaluate|sample|api\/cards)\//,
      /src\/components\//,
      /src\/lib\/evaluation/,
      /ui-copy/,
      /src\/app\/(layout|page)\.test/,
      // S2.2d13: the legal copy module, the footer contract and the spec
      // reader. `legal` alone, so S1.3's reason copy can still map to F1.
      /src\/lib\/copy\/legal/,
      /site-footer/,
      /attribution/,
      // S2.1d20: the Scryfall client, the default printing and the result
      // surface's labels.
      /src\/lib\/(printings|scryfall)/,
      /src\/lib\/copy\/result-labels/,
      // S2.4d14: the entry points: the link builder, the shared submit path,
      // the landing form and its copy, and the Scryfall error type.
      /src\/lib\/(result-href|entry-submit)/,
      /src\/app\/landing-form/,
      /src\/lib\/copy\/entry-points/,
      /src\/types\/scryfall/,
    ],
  ],
  [
    "F1 · Recommendation Engine",
    [
      /src\/lib\/recommendation\//,
      /src\/lib\/prisma/,
      /prisma\/(migrate-guard|baseline)/,
      /scripts\/test-report/,
      /src\/test\//,
      /tests\/(contract|helpers)\//,
    ],
  ],
];

export const UNMAPPED = "Unmapped";

export const FEATURE_ORDER = [
  ...FEATURES.map(([name]) => name).sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true }),
  ),
  UNMAPPED,
];

const toPosix = (file) => file.replace(/\\/g, "/");

export function featureOf(file) {
  const path = toPosix(file);
  for (const [name, patterns] of FEATURES) {
    if (patterns.some((p) => p.test(path))) return name;
  }
  return UNMAPPED;
}

export function typeOf(file) {
  if (/\.int\.test\.[cm]?[tj]sx?$/.test(file)) return "integration";
  if (/\.tsx$/.test(file)) return "component";
  return "unit";
}

export function envWarnings(env) {
  const warnings = [];
  if (!env.POSTGRES_PRISMA_URL) {
    warnings.push(
      "⚠ POSTGRES_PRISMA_URL not set: the app's Prisma client cannot load.",
    );
  }
  if (!env.POSTGRES_URL_NON_POOLING) {
    warnings.push(
      "⚠ POSTGRES_URL_NON_POOLING not set: integration (.int.test.ts) suites will skip locally and fail in CI.",
    );
  }
  return warnings;
}

// --- normalise and render ----------------------------------------------------
const SKIPPED = ["skipped", "pending", "todo", "disabled"];

function firstLine(text) {
  return String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
}

export function normalise(report, root) {
  return (report?.testResults ?? []).map((suite) => {
    const file = toPosix(relative(root, suite.name ?? ""));
    const assertions = suite.assertionResults ?? [];
    const failedAssertions = assertions.filter((a) => a.status === "failed");
    return {
      file,
      feature: featureOf(file),
      type: typeOf(file),
      total: assertions.length,
      passed: assertions.filter((a) => a.status === "passed").length,
      failed: failedAssertions.length,
      skipped: assertions.filter((a) => SKIPPED.includes(a.status)).length,
      duration: Math.max(0, (suite.endTime ?? 0) - (suite.startTime ?? 0)),
      suiteFailed: suite.status === "failed",
      suiteMessage: firstLine(suite.message),
      failures: failedAssertions.map((a) => a.fullName || a.title),
    };
  });
}

const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0);

/**
 * Renders the report. allGreen needs all four (S1.1d13): no failed assertion,
 * no failed suite (import and collection errors carry zero assertions),
 * report.success !== false, and a Vitest exit code of 0.
 */
export function renderReport(
  report,
  { root = process.cwd(), generatedAt, exitCode = 0 } = {},
) {
  const files = normalise(report, root);
  const totals = {
    files: files.length,
    tests: sum(files, "total"),
    passed: sum(files, "passed"),
    failed: sum(files, "failed"),
    skipped: sum(files, "skipped"),
  };
  const failedSuites = files.filter((f) => f.suiteFailed).length;
  const allGreen =
    totals.failed === 0 &&
    failedSuites === 0 &&
    report?.success !== false &&
    exitCode === 0;
  const stamp =
    generatedAt ??
    new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const fileOk = (f) => f.failed === 0 && !f.suiteFailed;

  const L = [];
  L.push("# Mox Market — Test Report");
  L.push("");
  L.push(
    "> Generated by `npm run test:report` (`scripts/test-report.mjs`). Do not edit by hand.",
  );
  L.push(`> Generated: ${stamp}`);
  L.push("");
  L.push(
    `**${allGreen ? "✅ All green" : "❌ Failures present"}** — ` +
      `${totals.tests} tests across ${totals.files} files · ` +
      `${totals.passed} passed · ${totals.failed} failed · ${totals.skipped} skipped` +
      (failedSuites
        ? ` · ${failedSuites} failed ${failedSuites === 1 ? "suite" : "suites"}`
        : "") +
      (exitCode !== 0 ? ` · vitest exit ${exitCode}` : ""),
  );
  L.push("");
  L.push(
    "_No e2e suite yet; S2.1 and S2.4 added no Playwright (S2.1d17, S2.4d13); entry journeys are covered by RTL and a local production build._",
  );
  L.push("");

  L.push("## By feature");
  L.push("");
  L.push("| Feature | Files | Tests | Passed | Failed | Skipped | Status |");
  L.push("|---------|------:|------:|-------:|-------:|--------:|:------:|");
  for (const name of FEATURE_ORDER) {
    const rows = files.filter((f) => f.feature === name);
    if (!rows.length) continue;
    const ok = rows.every(fileOk);
    L.push(
      `| ${name} | ${rows.length} | ${sum(rows, "total")} | ${sum(rows, "passed")} | ` +
        `${sum(rows, "failed")} | ${sum(rows, "skipped")} | ${ok ? "✅" : "❌"} |`,
    );
  }
  L.push(
    `| **Total** | **${totals.files}** | **${totals.tests}** | **${totals.passed}** | ` +
      `**${totals.failed}** | **${totals.skipped}** | ${allGreen ? "✅" : "❌"} |`,
  );
  L.push("");

  L.push("## By test type");
  L.push("");
  L.push("| Type | Files | Tests |");
  L.push("|------|------:|------:|");
  for (const type of ["unit", "component", "integration"]) {
    const rows = files.filter((f) => f.type === type);
    if (!rows.length) continue;
    L.push(`| ${type} | ${rows.length} | ${sum(rows, "total")} |`);
  }
  L.push("");

  L.push("## Per-file detail");
  L.push("");
  L.push("<details><summary>All test files</summary>");
  L.push("");
  L.push("| File | Feature | Type | Tests | Pass | Fail | Skip | ms |");
  L.push("|------|---------|------|------:|-----:|-----:|-----:|---:|");
  const byFeature = (f) => FEATURE_ORDER.indexOf(f.feature);
  for (const f of [...files].sort(
    (a, b) => byFeature(a) - byFeature(b) || a.file.localeCompare(b.file),
  )) {
    L.push(
      `| \`${f.file}\` | ${f.feature} | ${f.type} | ${f.total} | ${f.passed} | ` +
        `${f.failed} | ${f.skipped} | ${Math.round(f.duration)} |`,
    );
  }
  L.push("");
  L.push("</details>");
  L.push("");

  const failing = files.filter((f) => !fileOk(f));
  if (failing.length || !allGreen) {
    L.push("## ❌ Failures");
    L.push("");
    for (const f of failing) {
      L.push(`- \`${f.file}\``);
      if (f.suiteFailed && f.failures.length === 0) {
        L.push(`  - suite failed: ${f.suiteMessage ?? "no message"}`);
      }
      for (const name of f.failures) L.push(`  - ${name}`);
    }
    if (!failing.length) {
      L.push(
        `- Vitest reported a failure outside any test file (success: ${report?.success}, exit ${exitCode}); see its console output.`,
      );
    }
    L.push("");
  }

  return { markdown: L.join("\n") + "\n", allGreen, totals };
}

export function renderStub({ generatedAt, exitCode }) {
  const stamp =
    generatedAt ??
    new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return [
    "# Mox Market — Test Report",
    "",
    "> Generated by `npm run test:report` (`scripts/test-report.mjs`). Do not edit by hand.",
    `> Generated: ${stamp}`,
    "",
    `**❌ Failures present** — vitest produced no results (exit ${exitCode ?? "unknown"}); see its console output.`,
    "",
  ].join("\n");
}

// --- CLI ---------------------------------------------------------------------
export function parseArgs(argv) {
  const opts = { config: undefined, out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=")
      ? arg.split(/=(.*)/s, 2)
      : [arg, undefined];
    if (flag === "--config" || flag === "--out") {
      const value = inline ?? argv[++i];
      if (!value) throw new Error(`${flag} needs a value`);
      opts[flag.slice(2)] = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

// The env files the Vitest child will see (ADV.7). vitest.config.mts loads
// them itself with Vite's loadEnv in mode "test" (.env, .env.local, .env.test,
// .env.test.local, dotenv parsing and expansion), so this script calls the same
// function only to decide its warnings and never writes process.env: a second,
// hand-written parser could hand the child a different value. With the ""
// prefix, exported variables are included and win over the files.
export function loadEnvFiles(root, mode = "test") {
  return loadEnv(mode, root, "");
}

function main() {
  const root = process.cwd();
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`✖ ${error.message}`);
    process.exit(2);
  }
  const out = resolve(root, opts.out ?? join("docs", "test-report.md"));

  for (const warning of envWarnings(loadEnvFiles(root))) console.warn(warning);

  const workDir = mkdtempSync(join(tmpdir(), "mox-report-"));
  const jsonPath = join(workDir, "vitest.json");
  const vitestArgs = ["run", "--reporter=json", `--outputFile=${jsonPath}`];
  if (opts.config) vitestArgs.push("--config", opts.config);

  const localBin = join(root, "node_modules", "vitest", "vitest.mjs");
  const [cmd, args] = existsSync(localBin)
    ? [process.execPath, [localBin, ...vitestArgs]]
    : ["npx", ["vitest", ...vitestArgs]];

  console.log("▶ running vitest (json reporter)…");
  const run = spawnSync(cmd, args, {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const exitCode = run.status ?? 1;

  let report;
  try {
    report = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    report = undefined;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  mkdirSync(dirname(out), { recursive: true });
  if (!report) {
    writeFileSync(out, renderStub({ exitCode }));
    console.error(
      `✖ vitest produced no JSON results; wrote a stub to ${relative(root, out)}`,
    );
    process.exit(exitCode === 0 ? 1 : exitCode);
  }

  const { markdown, allGreen, totals } = renderReport(report, {
    root,
    exitCode,
  });
  writeFileSync(out, markdown);
  console.log(
    `\n${allGreen ? "✔" : "✖"} wrote ${relative(root, out)} — ${totals.tests} tests, ${totals.failed} failed`,
  );
  process.exit(allGreen ? 0 : 1);
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(resolve(process.argv[1])) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isDirectRun()) main();
