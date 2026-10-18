// T22 (AC-12, AC-15) and T23 (AC-14, AC-15): the README's database flow,
// Getting started order, and the V1 text it must no longer carry. S0.1 T14
// (S0.1d14): Josh's production steps, with 0001_price_history after the merge.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");

/** Body of a heading of the given level up to the next heading of the same or a higher level. */
/** Lines inside fenced code blocks are never headings (a shell `# comment` is not one). */
function section(markdown: string, heading: string, level: number): string {
  const lines = markdown.split("\n");
  let fenced = false;
  const isHeading = lines.map((l) => {
    if (/^\s*```/.test(l)) fenced = !fenced;
    return !fenced && /^#{1,6} /.test(l);
  });
  const start = lines.findIndex(
    (l, i) => isHeading[i] && l === `${"#".repeat(level)} ${heading}`,
  );
  if (start === -1) throw new Error(`no "${heading}" heading`);
  const sameOrHigher = new RegExp(`^#{1,${level}} `);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeading[i] && sameOrHigher.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

describe("README database flow (T22)", () => {
  const database = section(readme, "Database and migrations", 2);

  test("documents migrate deploy and Josh's two production commands", () => {
    expect(database).toContain("npx prisma migrate deploy");
    expect(database).toContain(
      "ALLOW_PROD_MIGRATE=1 npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma",
    );
    expect(database).toContain(
      "ALLOW_PROD_MIGRATE=1 npx prisma migrate resolve --applied 0000_baseline",
    );
  });

  test("says the flag is set inline and never stored in an .env* file", () => {
    expect(database).toMatch(/inline/i);
    expect(database).toMatch(/never stored in any `\.env\*` file/);
  });

  test("Getting started → Database migrates instead of pushing", () => {
    expect(section(readme, "Database", 3)).toContain(
      "npx prisma migrate deploy",
    );
  });

  test("contains no db push anywhere", () => {
    expect(readme).not.toMatch(/db\s+push/);
  });
});

describe("README production steps (S0.1 T14)", () => {
  const production = section(
    readme,
    "Production (Josh only, after the S0.1 merge, before production deploys resume)",
    3,
  );
  const commands = production
    .split("\n")
    .filter((l) => /^\S.*npx prisma /.test(l));

  test("lists Josh's steps in order: baseline-era diff, resolve, status pre-check, deploy, status, diff", () => {
    const step = (pattern: RegExp, from = 0) =>
      commands.findIndex((l, i) => i >= from && pattern.test(l));
    const diffBaseline = step(
      /migrate diff --from-config-datasource --to-schema "\$\{TMPDIR:-\/tmp\}\/schema-0000\.prisma"$/,
    );
    const resolve = step(/migrate resolve --applied 0000_baseline$/);
    const statusBefore = step(/migrate status$/);
    const deploy = step(/migrate deploy$/);
    const statusAfter = step(/migrate status$/, deploy);
    const diffCurrent = step(
      /migrate diff --from-config-datasource --to-schema prisma\/schema\.prisma$/,
    );
    expect(diffBaseline).toBe(0);
    expect([resolve, statusBefore, deploy, statusAfter, diffCurrent]).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(commands).toHaveLength(6);
    expect(production).toContain(
      'git show 9a2837b:prisma/schema.prisma > "${TMPDIR:-/tmp}/schema-0000.prisma"',
    );
    expect(
      production.indexOf("git show 9a2837b:prisma/schema.prisma"),
    ).toBeLessThan(production.indexOf(commands[0]));
  });

  test("every production command sets the flag inline and reads the hidden-prompt URL", () => {
    expect(production).toMatch(/^read -rs 'PROD_DB_URL\?/m);
    for (const line of commands) {
      expect(line).toMatch(
        /^POSTGRES_URL_NON_POOLING="\$PROD_DB_URL" ALLOW_PROD_MIGRATE=1 npx prisma /,
      );
    }
    expect(production).toMatch(/^unset PROD_DB_URL$/m);
    expect(production).toMatch(/inline/);
    expect(production).toMatch(/hidden prompt/);
  });

  test("says 0001 is additive, applied after the S0.1 merge and before production deploys resume", () => {
    expect(production).toMatch(/`0001` is additive/);
    expect(production).toMatch(/so `0001` needs no `pg_dump`/);
    expect(production).toMatch(
      /after the S0\.1 merge and before production deploys resume/,
    );
  });

  // S0.1 ADV.9: deploy applies whatever is pending, so the steps pin the
  // checkout and stop unless 0001 is the only migration in it.
  describe("the pre-check before step (c) (ADV.9)", () => {
    const check = production
      .split("\n")
      .find((l) => l.startsWith('test "$(ls -1 prisma/migrations'));
    const run = (cwd: string) =>
      execFileSync("sh", ["-c", check!], { cwd, encoding: "utf8" }).trim();

    test("sits after resolve and before deploy, from the S0.1 merge commit", () => {
      expect(check).toBeDefined();
      const at = production.indexOf(check!);
      expect(at).toBeGreaterThan(
        production.indexOf("migrate resolve --applied"),
      );
      expect(at).toBeLessThan(production.indexOf("npx prisma migrate deploy"));
      expect(production).toMatch(
        /git switch --detach <the S0\.1 merge commit>/,
      );
      expect(production).toMatch(
        /0001_price_history as the only migration not yet applied/,
      );
    });

    test("passes on this checkout", () => {
      expect(run(ROOT)).toBe("migrations: OK");
    });

    test("stops when a later migration (a planted 0002) is present", () => {
      const dir = mkdtempSync(path.join(tmpdir(), "mox-readme-"));
      try {
        cpSync(
          path.join(ROOT, "prisma", "migrations"),
          path.join(dir, "prisma", "migrations"),
          { recursive: true },
        );
        mkdirSync(path.join(dir, "prisma", "migrations", "0002_drop_v1"));
        expect(run(dir)).toBe("STOP: this checkout has other migrations");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test("keeps the dump rule for every later migration and the failure path", () => {
      expect(production).toMatch(
        /any later migration that drops, renames or rewrites anything needs a manual `pg_dump` first/,
      );
      expect(production).toMatch(/\*\*If step \(c\) fails:\*\*/);
      expect(production).toMatch(
        /`migrate resolve --rolled-back 0001_price_history`/,
      );
    });
  });

  // S0.1 ADV.1: the CLI steps do not prove the runtime path; step (e) does.
  test("step (e) checks the runtime read path and names POSTGRES_SSL_ROOT_CERT", () => {
    expect(production).toMatch(
      /\*\*\(e\) Runtime read path, before production deploys resume\.\*\*/,
    );
    expect(production).toContain("POSTGRES_SSL_ROOT_CERT");
    expect(production).toContain("No price history yet for this printing.");
    expect(production).toContain("TlsConnectionError");
    expect(section(readme, "Environment", 3)).toContain(
      "`POSTGRES_SSL_ROOT_CERT`",
    );
  });
});

describe("README Getting started (T23)", () => {
  test("has Prerequisites, Install, Environment, Database, Run, Troubleshooting in order", () => {
    const gettingStarted = section(readme, "Getting started", 2);
    const headings = [...gettingStarted.matchAll(/^### (.+)$/gm)].map(
      (m) => m[1],
    );
    expect(headings).toEqual([
      "Prerequisites",
      "Install",
      "Environment",
      "Database",
      "Run",
      "Troubleshooting",
    ]);
  });

  test("each step carries its command", () => {
    expect(section(readme, "Install", 3)).toMatch(
      /nvm install[\s\S]*nvm use[\s\S]*npm ci/,
    );
    expect(section(readme, "Environment", 3)).toContain("cp .env.example .env");
    expect(section(readme, "Database", 3)).toMatch(
      /docker compose up -d --wait db[\s\S]*npx prisma migrate deploy/,
    );
    expect(section(readme, "Run", 3)).toContain("npm run dev");
  });

  test.each([
    "Watchlist",
    "Decklist Import",
    "Multi-Currency",
    "Price Dashboard",
    "Export / Import",
    "Fuzzy search powered by Scryfall autocomplete",
    "Zustand",
    "Recharts",
    "Headless UI** for accessible component primitives",
  ])("has none of the V1 feature text: %s", (text) => {
    expect(readme).not.toContain(text);
  });
});

// The every-session routine for any Postgres setup (Docker Compose, Supabase
// CLI or native), added after a dev server ran with no database configured.
describe("README Local startup", () => {
  const startup = section(readme, "Local startup", 2);

  test("sits right after Getting started", () => {
    const topLevel = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    const at = topLevel.indexOf("Getting started");
    expect(topLevel[at + 1]).toBe("Local startup");
  });

  test("runs Node, Postgres, the migration check, the app and the history check in order", () => {
    const order = [
      "nvm use",
      "docker compose up -d --wait db",
      "npx prisma migrate status",
      "npm run dev",
      "/Esper%20Sentinel?price=74.99",
    ].map((step) => startup.indexOf(step));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("gives a start and a stop command for each setup", () => {
    for (const command of [
      "docker compose up -d --wait db",
      "docker compose stop db",
      "supabase start",
      "supabase stop",
      "pg_ctl -D ~/.mox-market/pgdata -l ~/.mox-market/pg.log start",
      "pg_ctl -D ~/.mox-market/pgdata stop",
    ]) {
      expect(startup).toContain(command);
    }
  });

  test("warns that a native data directory under /tmp is lost", () => {
    expect(startup).toMatch(/must not be under `\/tmp` or `\/private\/tmp`/);
  });

  test("checks the cache's date before path B, so an old cache is never reloaded alone", () => {
    expect(startup).toContain(
      'grep -oE \'"date": *"[0-9-]+"\' .cache/mtgjson/Meta.json',
    );
    expect(startup).toContain("Never run path B alone on an older cache");
  });

  test("names the log line a missing .env produces", () => {
    expect(startup).toContain(
      "[evaluation] history_read_failed: Error [POSTGRES_PRISMA_URL_UNSET]",
    );
  });

  test("native first time: initdb, start, createdb, then migrate deploy, in order", () => {
    const native = section(readme, "Native Postgres, first time", 3);
    const order = [
      "initdb -D ~/.mox-market/pgdata",
      "pg_ctl -D ~/.mox-market/pgdata -l ~/.mox-market/pg.log start",
      "createdb -h localhost -U postgres mox_market",
      "npx prisma migrate deploy",
    ].map((step) => native.indexOf(step));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

// S0.3 T18 (AC-12; S0.3d18): the README documents the daily sync, its
// fail-closed guard, CRON_SECRET in Production only, the Firewall rule by
// purpose, and the rollout as step 0 plus the runbook's four steps, with the
// runbook as the canonical order.
describe("README Daily price sync (S0.3 T18)", () => {
  const sync = section(readme, "Daily price sync", 2);
  const rollout = section(readme, "Production rollout (Josh only)", 3);
  const runbook = readFileSync(
    path.join(ROOT, "docs", "runbooks", "mtgjson-ingest.md"),
    "utf8",
  );
  const runbookSteps = (() => {
    const lines = runbook.split("\n");
    const start = lines.indexOf("### Production rollout order");
    const end = lines.findIndex((l, i) => i > start && /^#{1,3} /.test(l));
    return lines
      .slice(start + 1, end === -1 ? undefined : end)
      .filter((l) => /^\d+\. /.test(l));
  })();
  const readmeSteps = rollout.split("\n").filter((l) => /^\d+\. /.test(l));

  test("names the route and its schedule", () => {
    expect(sync).toContain("/api/prices/sync-mtgjson");
    expect(sync).toContain("`0 17 * * *`");
  });

  test("states the guard: 500 when CRON_SECRET is unset, 401 on a wrong header", () => {
    expect(sync).toMatch(/`CRON_SECRET` unset[^\n]*\*\*500\*\*/);
    expect(sync).toMatch(
      /wrong `Authorization: Bearer <CRON_SECRET>` header: \*\*401\*\*/,
    );
  });

  test("CRON_SECRET in Vercel Production only, never Preview or Development, because previews share the production database", () => {
    expect(sync).toMatch(
      /`CRON_SECRET` goes in Vercel \*\*Production only\*\*, never Preview or Development, because previews share the production database/,
    );
  });

  test("the Firewall rule stays until a production deployment without the V1 route is live, then is removed; the runbook names the path", () => {
    expect(rollout).toMatch(
      /Firewall rule[^\n]*stays in place until a production deployment without that route is live[^\n]*then Josh removes it[^\n]*runbook names the path/,
    );
    expect(readme).not.toContain(["prices", "snapshot"].join("/"));
  });

  test("links the runbook as the canonical order and duplicates no path C command", () => {
    expect(rollout).toMatch(
      /canonical order is the runbook's \[production rollout order\]\(docs\/runbooks\/mtgjson-ingest\.md#production-rollout-order\)/,
    );
    expect(rollout).not.toContain("--production");
    expect(sync).not.toContain("--production");
    expect(readme).not.toMatch(/before merging S0\.3|before S0\.3 merges/i);
    expect(rollout).toContain("before production deploys resume");
  });

  test("step 0 is README Production (a) to (e), POSTGRES_SSL_ROOT_CERT included, before the first production deploy", () => {
    const step0 = rollout.split("\n").find((l) => l.startsWith("0. "));
    expect(step0).toMatch(
      /^0\. Before the first production deploy: README "Production" steps \(a\) to \(d\), then step \(e\), `POSTGRES_SSL_ROOT_CERT`/,
    );
    expect(rollout.indexOf("0. ")).toBeLessThan(rollout.indexOf("1. "));
  });

  test("lists the runbook's four steps in the same order with the same key phrases", () => {
    expect(runbookSteps).toHaveLength(4);
    expect(readmeSteps.map((l) => l.slice(0, 2))).toEqual([
      "0.",
      "1.",
      "2.",
      "3.",
      "4.",
    ]);
    const keyPhrases: string[][] = [
      [
        "Set `CRON_SECRET` in Vercel **Production only**, before production deploys resume",
      ],
      [
        "Resume production deploys after S0.3 is merged and Josh signs off",
        "a production deployment containing `/api/prices/sync-mtgjson` is live",
      ],
      ["The same UTC day: path C, identifiers then prices"],
      [
        "The next day: confirm a cron `ok` run whose `rows_written` is within 10% of the dry-run's rows/day",
      ],
    ];
    keyPhrases.forEach((phrases, i) => {
      for (const phrase of phrases) {
        expect(runbookSteps[i], `runbook step ${i + 1}`).toContain(phrase);
        expect(readmeSteps[i + 1], `README step ${i + 1}`).toContain(phrase);
      }
    });
  });

  test("the env table's CRON_SECRET row names the route and the fail-closed rule", () => {
    const row = section(readme, "Environment", 3)
      .split("\n")
      .find((l) => l.startsWith("| `CRON_SECRET` |"));
    expect(row).toContain("/api/prices/sync-mtgjson");
    expect(row).toMatch(
      /fails closed: 500 while it is unset[^|]*401 on a missing or wrong/,
    );
    expect(row).toMatch(/\*\*Production only\*\*/);
  });

  // S0.3 ADV.3 and ADV.7: the format rule, the non-local refusal and the
  // host checks before a local trigger.
  test("states the secret's format rule and the non-local database refusal", () => {
    expect(sync).toMatch(
      /surrounding whitespace[^\n]*printable ASCII[^\n]*fewer than 32 characters\): \*\*500\*\*/,
    );
    expect(sync).toMatch(
      /Outside Vercel Production \(`VERCEL_ENV` is not `production`\)[^\n]*`localhost` or `127\.0\.0\.1`[^\n]*\*\*500\*\* before the database client loads/,
    );
    const step1 = rollout.split("\n").find((l) => l.startsWith("1. "));
    expect(step1).toMatch(/at least 32 printable ASCII characters/);
    expect(step1).toMatch(
      /no trailing newline[^\n]*`printf '%s'`, never `echo`/,
    );
  });

  test("runs AGENTS.md's two host checks before the local trigger", () => {
    const block = sync.slice(sync.indexOf("```bash"));
    const hostCheck = block.indexOf("sed -E 's#^[^@]*@##; s#[:/?].*##'");
    const hostParam = block.indexOf("grep -oiE '[?&]host(addr)?=[^&#]*'");
    expect(hostCheck).toBeGreaterThan(-1);
    expect(hostParam).toBeGreaterThan(-1);
    expect(hostCheck).toBeLessThan(block.indexOf("npm run start"));
    expect(hostParam).toBeLessThan(block.indexOf("npm run start"));
  });

  test("never tells anyone to call the route on a deployed URL", () => {
    expect(sync).toMatch(/Never call the route on a deployed URL/);
    const curl = sync.split("\n").filter((l) => l.startsWith("curl "));
    expect(curl).toHaveLength(1);
    expect(curl[0]).toContain("http://localhost:3000/api/prices/sync-mtgjson");
  });
});
