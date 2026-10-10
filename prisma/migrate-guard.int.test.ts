// T20 (AC-13): prisma.config.ts really calls the guard. Spawns the Prisma CLI
// with a fake Supabase host on port 1, so a broken wiring would fail fast on
// connect instead of reaching anything.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
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
    // A throwaway project dir: a copy of the config, guard and schema, the
    // repo's node_modules linked in, and a .env that tries to set the flag.
    const dir = mkdtempSync(path.join(tmpdir(), "mox-guard-env-"));
    try {
      mkdirSync(path.join(dir, "prisma"));
      copyFileSync(
        path.join(ROOT, "prisma.config.ts"),
        path.join(dir, "prisma.config.ts"),
      );
      copyFileSync(
        path.join(ROOT, "prisma", "migrate-guard.ts"),
        path.join(dir, "prisma", "migrate-guard.ts"),
      );
      copyFileSync(
        path.join(ROOT, "prisma", "schema.prisma"),
        path.join(dir, "prisma", "schema.prisma"),
      );
      symlinkSync(
        path.join(ROOT, "node_modules"),
        path.join(dir, "node_modules"),
        "dir",
      );
      writeFileSync(
        path.join(dir, ".env"),
        `ALLOW_PROD_MIGRATE=1\nPOSTGRES_URL_NON_POOLING=${FAKE_SUPABASE}\n`,
      );
      const { status, output } = prisma(
        ["migrate", "deploy"],
        FAKE_SUPABASE,
        {},
        dir,
      );
      expect(status).not.toBe(0);
      expect(output).toContain("migrate guard: refused");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
