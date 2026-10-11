// T18 (AC-13; S0.2d25): the MTGJson runbook, the provenance record and the
// README. Path C's preconditions in order, the four-step rollout order with
// both pivots (CRON_SECRET before production deploys resume; 0001 and the
// TLS root after the S0.1 merge), the inline-only opt-in flag, the hidden
// URL prompt, documented commands that use only declared flags, and the
// cache directory gitignored.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { FLAGS } from "../../src/lib/mtgjson/target";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const runbook = read("docs/runbooks/mtgjson-ingest.md");
const provenance = read("docs/architecture/data-provenance.md");
const readme = read("README.md");
const agents = read("AGENTS.md");

/** The body under a heading, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  let fenced = false;
  const isHeading = lines.map((l) => {
    if (/^\s*```/.test(l)) fenced = !fenced;
    return !fenced && /^#{1,6} /.test(l);
  });
  const start = lines.findIndex(
    (l, i) => isHeading[i] && l.replace(/^#+ /, "") === heading,
  );
  if (start === -1) throw new Error(`no "${heading}" heading`);
  const level = lines[start].match(/^#+/)![0].length;
  const end = lines.findIndex(
    (l, i) => i > start && isHeading[i] && l.match(/^#+/)![0].length <= level,
  );
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

/** Numbered list items ("1. …") in order. */
const numbered = (text: string) =>
  text.split("\n").filter((l) => /^\d+\. /.test(l));

describe("the runbook's paths (T18)", () => {
  test.each([
    "Path A: the dry-run",
    "Path B: local Postgres",
    "Path C: production (Josh only)",
    "Identifier refresh (W4)",
  ])("has a %s section", (heading) => {
    expect(section(runbook, heading).trim().length).toBeGreaterThan(0);
  });

  test("says no agent, test or CI job runs path C", () => {
    expect(runbook).toMatch(
      /No agent, test or CI job ever runs path C or passes `--production`/,
    );
  });

  test("documents every exit code", () => {
    const codes = section(runbook, "Exit codes");
    for (const code of ["| 0 |", "| 1 |", "| 2 |", "| 3 |"])
      expect(codes).toContain(code);
    expect(codes).toMatch(/budget_stop[\s\S]*ask Bitey/);
  });
});

describe("path C's preconditions, in order (T18)", () => {
  const items = numbered(section(runbook, "Preconditions, in this order"));
  const expected: [string, RegExp][] = [
    ["sign-off in WORKLOG", /sign-off[\s\S]*docs\/llm\/WORKLOG\.md/],
    [
      "Supabase active (keep-awake, C2-A.2)",
      /Supabase is active[\s\S]*C2-A\.2/,
    ],
    [
      "0001 through README (a)-(d), after the S0.1 merge and S1.1's baseline diff and resolve",
      /`0001_price_history` is applied[\s\S]*README "Production" steps \(a\) to \(d\)[\s\S]*after the S0\.1 merge[\s\S]*S1\.1's baseline diff and resolve/,
    ],
    ["README step (e) done", /README step \(e\) is done/],
    [
      "POSTGRES_SSL_ROOT_CERT in Josh's shell",
      /`POSTGRES_SSL_ROOT_CERT` \(PEM\) is in Josh's shell/,
    ],
    ["a pg_dump", /`pg_dump` is taken/],
    ["340 MB free", /At least 340 MB is free/],
  ];

  test("lists exactly the seven preconditions", () => {
    expect(items).toHaveLength(expected.length);
  });

  test.each(
    expected.map(([label, pattern], i) => [i + 1, label, pattern] as const),
  )("%s. %s", (position, _label, pattern) => {
    expect(items[position - 1]).toMatch(pattern);
  });
});

describe("the production rollout order (T18, AC-13, with both pivots)", () => {
  const rollout = section(runbook, "Production rollout order");
  const steps = numbered(rollout);

  test("step 0 is README Production (a) to (d) and (e), after the S0.1 merge", () => {
    expect(rollout).toMatch(
      /^Step 0, after the S0\.1 merge: README "Production" \(a\) to \(d\)[\s\S]*\(e\)/m,
    );
  });

  test("lists the four steps in order", () => {
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatch(
      /^1\. Set `CRON_SECRET` in Vercel \*\*Production only\*\*, before production deploys resume/,
    );
    expect(steps[1]).toMatch(
      /^2\. .*a production deployment containing `\/api\/prices\/sync-mtgjson` is live/,
    );
    expect(steps[2]).toMatch(
      /^3\. The same UTC day: path C, identifiers then prices/,
    );
    expect(steps[3]).toMatch(
      /^4\. The next day: confirm a cron `ok` run whose `rows_written` is within 10% of the dry-run's rows\/day/,
    );
  });

  test("one sentence after the steps names the snapshot route's Firewall rule, removed after a production deployment without it is live (S0.3 T18)", () => {
    const after = rollout.slice(rollout.indexOf(steps[3]) + steps[3].length);
    const sentence = after.split("\n").find((l) => l.includes("Firewall rule"));
    expect(sentence).toBeDefined();
    expect(sentence).toContain("`/api/prices/snapshot`");
    expect(sentence).toContain(
      "after a production deployment without it is live",
    );
    expect(after.indexOf(sentence!)).toBeLessThan(after.indexOf("```sql"));
  });

  test("never ties CRON_SECRET to S0.3's merge", () => {
    for (const text of [runbook, readme]) {
      expect(text).not.toMatch(/before S0\.3 merges/i);
      expect(text).not.toMatch(/before merging S0\.3/i);
    }
  });
});

describe("the opt-in flag and the URL (T18)", () => {
  test("ALLOW_PROD_INGEST=1 appears only inline on the path C command", () => {
    const lines = runbook
      .split("\n")
      .filter((l) => l.includes("ALLOW_PROD_INGEST=1"));
    expect(lines).toEqual([
      'POSTGRES_URL_NON_POOLING="postgresql://$PGUSER@$PGHOST:5432/postgres" ALLOW_PROD_INGEST=1 npx tsx scripts/ingest-mtgjson-history.ts --production --source-dir .cache/mtgjson',
    ]);
    for (const text of [readme, agents, provenance]) {
      expect(text).not.toContain("ALLOW_PROD_INGEST=1");
    }
  });

  test("says the flag is inline and never stored in any .env* file", () => {
    expect(runbook).toMatch(
      /\*\*inline\*\*[\s\S]*\*\*never stored in any `\.env\*` file\*\*/,
    );
    expect(readme).toMatch(
      /`ALLOW_PROD_INGEST`.*never stored in any `\.env\*` file/,
    );
  });

  test("reads the password at a hidden prompt into PGPASSWORD and unsets everything", () => {
    const pathC = section(runbook, "Steps");
    expect(pathC).toMatch(/^read -rs 'PGPASSWORD\?/m);
    expect(pathC).toMatch(
      /^unset PGHOST PGUSER PGPASSWORD PGPORT PGDATABASE PGSSLMODE PGSSLROOTCERT POSTGRES_SSL_ROOT_CERT$/m,
    );
    expect(pathC).toMatch(/hidden prompt/);
  });
});

/** The path C shell block's lines (comments and blank lines dropped). */
const pathCCommands = () => {
  const steps = section(runbook, "Steps");
  const block = steps.slice(
    steps.indexOf("```bash") + "```bash".length,
    steps.indexOf("```", steps.indexOf("```bash") + 1),
  );
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
};

describe("path C's own production commands (T18, ADV.10, ADV.11)", () => {
  const commands = pathCCommands();

  test("finds the psql and pg_dump lines", () => {
    expect(commands.filter((l) => /^(\S+=\S+ )*psql /.test(l))).toHaveLength(1);
    expect(commands.filter((l) => /\bpg_dump /.test(l))).toHaveLength(1);
  });

  test("the dump goes to an absolute path outside the repository, made first", () => {
    const dump = commands.find((l) => /\bpg_dump /.test(l))!;
    const target = dump.match(/-f "([^"]+)"/)?.[1];
    expect(target).toBeDefined();
    expect(target).toMatch(/^\$HOME\/mox-backups\//);
    expect(target).toMatch(/\.dump$/);
    const mkdir = commands.findIndex(
      (l) => l === 'mkdir -p "$HOME/mox-backups"',
    );
    expect(mkdir).toBeGreaterThan(-1);
    expect(mkdir).toBeLessThan(commands.indexOf(dump));
  });

  test("git ignores *.dump as a backstop (the repository is public)", () => {
    for (const file of ["mox-market-20261011.dump", "scripts/x.dump"]) {
      expect(
        execFileSync("git", ["check-ignore", file], {
          cwd: ROOT,
          encoding: "utf8",
        }).trim(),
      ).toBe(file);
    }
  });

  test("psql and pg_dump verify TLS: PGSSLMODE=verify-full and the pinned root are exported before them", () => {
    const tls = commands.findIndex((l) =>
      /^export PGSSLMODE=verify-full PGSSLROOTCERT="\$HOME\/[^"]+\.crt"(\s+#.*)?$/.test(
        l,
      ),
    );
    expect(tls).toBeGreaterThan(-1);
    for (const [i, line] of commands.entries()) {
      if (/\b(psql|pg_dump) /.test(line)) expect(i).toBeGreaterThan(tls);
    }
    expect(commands).toContain(
      'export POSTGRES_SSL_ROOT_CERT="$(cat "$PGSSLROOTCERT")"',
    );
  });

  test("no command carries a connection string or the password as an argument", () => {
    for (const line of commands) {
      if (/\b(psql|pg_dump) /.test(line)) {
        expect(line).not.toMatch(/postgres(ql)?:\/\//);
        expect(line).not.toMatch(/PROD_DB_URL/);
      }
      expect(line).not.toMatch(/\$\{?PGPASSWORD\b/);
    }
    // The script's URL names host, port and database and carries no password.
    const pathCLine = commands.find((l) => l.includes("--production"))!;
    expect(pathCLine).toMatch(
      /^POSTGRES_URL_NON_POOLING="postgresql:\/\/\$PGUSER@\$PGHOST:5432\/postgres" /,
    );
  });

  test("path C goes on only after a path A that printed warnings: none (ADV.2)", () => {
    const steps = section(runbook, "Steps");
    expect(steps).toMatch(
      /\*\*Stop unless path A printed `warnings: none`\.\*\*/,
    );
    const pathA = commands.findIndex(
      (l) => l === "npx tsx scripts/ingest-mtgjson-history.ts --dry-run",
    );
    const pathC = commands.findIndex((l) => l.includes("--production"));
    expect(pathA).toBeGreaterThan(-1);
    expect(pathA).toBeLessThan(pathC);
  });
});

describe("documented commands use only declared flags (T18)", () => {
  const declared = new Set(Object.keys(FLAGS).map((f) => `--${f}`));
  const commands = [runbook, readme, agents].flatMap((text) =>
    [
      ...text.matchAll(
        /npx tsx scripts\/ingest-mtgjson-history\.ts([^\n`#]*)/g,
      ),
    ].map((m) => m[1]),
  );

  test("finds the commands", () => {
    expect(commands.length).toBeGreaterThanOrEqual(8);
  });

  test.each(commands.map((c) => [c.trim() || "(no flags)"]))("%s", (args) => {
    const flags = args.split(/\s+/).filter((a) => a.startsWith("--"));
    for (const flag of flags) expect(declared, flag).toContain(flag);
  });
});

describe("provenance, README link and the cache (T18)", () => {
  test("data-provenance names MTGJson AllPrices → paper TCGplayer retail USD as the only history series", () => {
    expect(provenance).toMatch(
      /\*\*The only history series is MTGJson AllPrices → paper TCGplayer retail USD\.\*\*/,
    );
    for (const ignored of [
      "Card Kingdom",
      "Cardmarket",
      "Mana Pool",
      "`buylist`",
      "`mtgo`",
      "EUR",
    ]) {
      expect(provenance).toContain(ignored);
    }
    expect(provenance).toMatch(/Scryfall's `prices\.usd`/);
  });

  test("the README links the runbook", () => {
    expect(readme).toContain("](docs/runbooks/mtgjson-ingest.md)");
  });

  test("git ignores the MTGJson cache", () => {
    const out = execFileSync(
      "git",
      ["check-ignore", ".cache/mtgjson/AllPrices.json.gz"],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    expect(out.trim()).toBe(".cache/mtgjson/AllPrices.json.gz");
  });
});
