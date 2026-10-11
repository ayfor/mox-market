// T22 (AC-12, AC-15) and T23 (AC-14, AC-15): the README's database flow,
// Getting started order, and the V1 text it must no longer carry. S0.1 T14
// (S0.1d14): Josh's production steps, with 0001_price_history after the merge.
import { readFileSync } from "node:fs";
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

  test("lists Josh's four steps in order: baseline-era diff, resolve, deploy, status", () => {
    const step = (pattern: RegExp) =>
      commands.findIndex((l) => pattern.test(l));
    const diffBaseline = step(
      /migrate diff --from-config-datasource --to-schema "\$\{TMPDIR:-\/tmp\}\/schema-0000\.prisma"$/,
    );
    const resolve = step(/migrate resolve --applied 0000_baseline$/);
    const deploy = step(/migrate deploy$/);
    const status = step(/migrate status$/);
    const diffCurrent = step(
      /migrate diff --from-config-datasource --to-schema prisma\/schema\.prisma$/,
    );
    expect(diffBaseline).toBe(0);
    expect([resolve, deploy, status, diffCurrent]).toEqual([1, 2, 3, 4]);
    expect(commands).toHaveLength(5);
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
    expect(production).toMatch(/no `pg_dump`/);
    expect(production).toMatch(
      /after the S0\.1 merge and before production deploys resume/,
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
