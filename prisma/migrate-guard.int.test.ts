// T20 (AC-13): prisma.config.ts really calls the guard. Spawns the Prisma CLI
// with a fake Supabase host on port 1, so a broken wiring would fail fast on
// connect instead of reaching anything.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const PRISMA_CLI = path.join(
  ROOT,
  "node_modules",
  "prisma",
  "build",
  "index.js",
);
const FAKE_SUPABASE =
  "postgresql://guard:guard@guard-check.supabase.co:1/postgres";
const LOCAL = "postgresql://postgres:postgres@localhost:1/mox_market";

function prisma(
  args: string[],
  url: string,
  extra: NodeJS.ProcessEnv = {},
  cwd = ROOT,
) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("VITEST") ||
      key === "ALLOW_PROD_MIGRATE" ||
      key === "DATABASE_URL" ||
      key === "POSTGRES_PRISMA_URL"
    ) {
      delete env[key];
    }
  }
  Object.assign(env, { POSTGRES_URL_NON_POOLING: url, ...extra });
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 50_000,
  });
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

/**
 * A throwaway project dir: a copy of the config (optionally rewritten), guard,
 * schema and migrations, with the repo's node_modules linked in.
 */
function withThrowawayProject<T>(
  fn: (dir: string) => T,
  options: { env?: string; config?: (source: string) => string } = {},
): T {
  const dir = mkdtempSync(path.join(tmpdir(), "mox-guard-"));
  try {
    mkdirSync(path.join(dir, "prisma"));
    const config = readFileSync(path.join(ROOT, "prisma.config.ts"), "utf8");
    writeFileSync(
      path.join(dir, "prisma.config.ts"),
      options.config ? options.config(config) : config,
    );
    copyFileSync(
      path.join(ROOT, "prisma", "migrate-guard.ts"),
      path.join(dir, "prisma", "migrate-guard.ts"),
    );
    copyFileSync(
      path.join(ROOT, "prisma", "schema.prisma"),
      path.join(dir, "prisma", "schema.prisma"),
    );
    cpSync(
      path.join(ROOT, "prisma", "migrations"),
      path.join(dir, "prisma", "migrations"),
      { recursive: true },
    );
    symlinkSync(
      path.join(ROOT, "node_modules"),
      path.join(dir, "node_modules"),
      "dir",
    );
    if (options.env !== undefined)
      writeFileSync(path.join(dir, ".env"), options.env);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("prisma.config.ts wiring", () => {
  test("`migrate deploy` against a Supabase host is refused before connecting", () => {
    const { status, output } = prisma(["migrate", "deploy"], FAKE_SUPABASE);
    expect(status).not.toBe(0);
    expect(output).toContain("ALLOW_PROD_MIGRATE");
    expect(output).toContain("guard-check.supabase.co");
    expect(output).not.toContain("guard:guard");
  });

  test("`validate` with the same env exits 0 (exempt: never connects)", () => {
    const { status, output } = prisma(["validate"], FAKE_SUPABASE);
    expect(status, output).toBe(0);
  });

  test("`db push --url=<supabase>` with a localhost env is refused", () => {
    const { status, output } = prisma(
      ["db", "push", `--url=${FAKE_SUPABASE}`],
      LOCAL,
    );
    expect(status).not.toBe(0);
    expect(output).toContain("ALLOW_PROD_MIGRATE");
  });

  test("ALLOW_PROD_MIGRATE=1 saved in .env does not unlock the guard (inline only, AC-12)", () => {
    withThrowawayProject(
      (dir) => {
        const { status, output } = prisma(
          ["migrate", "deploy"],
          FAKE_SUPABASE,
          {},
          dir,
        );
        expect(status).not.toBe(0);
        expect(output).toContain("migrate guard: refused");
      },
      {
        env: `ALLOW_PROD_MIGRATE=1\nPOSTGRES_URL_NON_POOLING=${FAKE_SUPABASE}\n`,
      },
    );
  });

  // ADV.1: Prisma's schema engine connects to ?host= over the URL hostname.
  test("`migrate status` with a localhost URL whose ?host= is Supabase is refused", () => {
    const { status, output } = prisma(
      ["migrate", "status"],
      "postgresql://guard:guard@localhost:1/postgres?host=guard-check.supabase.co",
    );
    expect(status).not.toBe(0);
    expect(output).toContain("migrate guard: refused");
    expect(output).toContain("ALLOW_PROD_MIGRATE");
    expect(output).toContain("guard-check.supabase.co");
    expect(output).not.toContain("guard:guard");
  });

  // CODEX.1: a host parameter naming any remote host is refused, and the inline
  // flag does not unlock it. `.invalid` never resolves and port 1 fails fast,
  // so a broken wiring could not reach anything either.
  test.each([
    ["without the flag", {}],
    ["with inline ALLOW_PROD_MIGRATE=1", { ALLOW_PROD_MIGRATE: "1" }],
  ])(
    "`migrate status` with a localhost URL whose ?host= is a remote host is refused %s",
    (_label, extra) => {
      const { status, output } = prisma(
        ["migrate", "status"],
        "postgresql://guard:guard@localhost:1/postgres?host=guard-check.example.invalid",
        extra,
      );
      expect(status).not.toBe(0);
      expect(output).toContain("migrate guard: refused");
      expect(output).toContain("host query parameter");
      expect(output).toContain("guard-check.example.invalid");
      expect(output).not.toContain("guard:guard");
    },
  );

  // ADV.3: the inline flag reaches the guard through prisma.config.ts. `--help`
  // after a command is guarded (D4), and Prisma prints help before it loads
  // the datasource, so nothing connects either way.
  test("inline ALLOW_PROD_MIGRATE=1 unlocks `migrate deploy --help` against a Supabase host", () => {
    const { status, output } = prisma(
      ["migrate", "deploy", "--help"],
      FAKE_SUPABASE,
      { ALLOW_PROD_MIGRATE: "1" },
    );
    expect(status, output).toBe(0);
    expect(output).not.toContain("migrate guard: refused");
    expect(output).toMatch(/migrate deploy/);
  });

  test("without the flag, `migrate deploy --help` against a Supabase host is refused", () => {
    const { status, output } = prisma(
      ["migrate", "deploy", "--help"],
      FAKE_SUPABASE,
    );
    expect(status).not.toBe(0);
    expect(output).toContain("migrate guard: refused");
  });
});

// ADV.2: one datasource object feeds both the guard and Prisma, so a
// shadowDatabaseUrl added to it later is checked for the commands that use it.
describe("shadow database wiring (ADV.2)", () => {
  const DATASOURCE_LINE =
    "const datasource: { url?: string; shadowDatabaseUrl?: string } = { url };";

  test("prisma.config.ts passes its datasource's url and shadowDatabaseUrl to the guard and to Prisma", () => {
    const config = readFileSync(path.join(ROOT, "prisma.config.ts"), "utf8");
    expect(config).toContain(DATASOURCE_LINE);
    expect(config).toMatch(/url:\s*datasource\.url,/);
    expect(config).toMatch(/shadowUrl:\s*datasource\.shadowDatabaseUrl,/);
    expect(config).toMatch(
      /defineConfig\(\{[\s\S]*^\s*datasource,\s*$[\s\S]*\}\);/m,
    );
    expect(config.match(/assertMigrateAllowed\(/g)).toHaveLength(1);
  });

  const withShadow = (source: string) => {
    expect(source).toContain(DATASOURCE_LINE);
    return source.replace(
      DATASOURCE_LINE,
      "const datasource: { url?: string; shadowDatabaseUrl?: string } = { url, shadowDatabaseUrl: process.env.MOX_GUARD_SHADOW_URL };",
    );
  };

  test.each([
    [
      "migrate diff --from-migrations",
      [
        "migrate",
        "diff",
        "--from-migrations",
        "prisma/migrations",
        "--to-schema",
        "prisma/schema.prisma",
      ],
    ],
    ["migrate dev", ["migrate", "dev"]],
  ])("`%s` with a Supabase shadow URL is refused", (_label, args) => {
    withThrowawayProject(
      (dir) => {
        const { status, output } = prisma(
          args,
          LOCAL,
          { MOX_GUARD_SHADOW_URL: FAKE_SUPABASE },
          dir,
        );
        expect(status).not.toBe(0);
        expect(output).toContain("migrate guard: refused");
        expect(output).toContain("its shadow database");
        expect(output).not.toContain("guard:guard");
      },
      { config: withShadow },
    );
  });

  test("`migrate diff --from-migrations` with no shadow URL is not refused by the guard", () => {
    withThrowawayProject(
      (dir) => {
        const { output } = prisma(
          [
            "migrate",
            "diff",
            "--from-migrations",
            "prisma/migrations",
            "--to-schema",
            "prisma/schema.prisma",
          ],
          LOCAL,
          {},
          dir,
        );
        expect(output).not.toContain("migrate guard: refused");
        expect(output).toMatch(/shadowDatabaseUrl/);
      },
      { config: withShadow },
    );
  });
});
