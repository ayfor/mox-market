// T22 (AC-12, AC-15) and T23 (AC-14, AC-15): the README's database flow,
// Getting started order, and the V1 text it must no longer carry.
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
