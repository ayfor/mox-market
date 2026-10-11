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
