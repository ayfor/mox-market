// T24 (AC-14): the tracked, placeholder-only .env.example.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");

function entries(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
    map.set(key, value);
  }
  return map;
}

const env = entries(example);

describe(".env.example", () => {
  test("is tracked by git", () => {
    expect(() =>
      execFileSync("git", ["ls-files", "--error-unmatch", ".env.example"], {
        cwd: ROOT,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  test("defines exactly POSTGRES_PRISMA_URL, POSTGRES_URL_NON_POOLING and CRON_SECRET", () => {
    expect([...env.keys()].sort()).toEqual([
      "CRON_SECRET",
      "POSTGRES_PRISMA_URL",
      "POSTGRES_URL_NON_POOLING",
    ]);
  });

  test.each(["POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"])(
    "%s has host localhost",
    (key) => {
      expect(new URL(env.get(key)!).hostname).toBe("localhost");
    },
  );

  test("CRON_SECRET is exactly replace-me, under a generate-command comment", () => {
    expect(env.get("CRON_SECRET")).toBe("replace-me");
    const lines = example.split("\n");
    const at = lines.findIndex((l) => l.startsWith("CRON_SECRET="));
    expect(lines[at - 1]).toMatch(/^#.*Generate:.*openssl rand -hex 32/);
  });

  test("no URL anywhere in the file has a host other than localhost", () => {
    const hosts = [
      ...example.matchAll(/[a-z][a-z0-9+.-]*:\/\/(?:[^@\s"]*@)?([^:/\s"?]+)/gi),
    ].map((m) => m[1]);
    expect(hosts.length).toBeGreaterThan(0);
    expect(new Set(hosts)).toEqual(new Set(["localhost"]));
  });

  test(".gitignore re-includes .env.example after ignoring .env*", () => {
    const lines = readFileSync(path.join(ROOT, ".gitignore"), "utf8")
      .split("\n")
      .map((l) => l.trim());
    const ignore = lines.indexOf(".env*");
    const allow = lines.indexOf("!.env.example");
    expect(ignore).toBeGreaterThanOrEqual(0);
    expect(allow).toBeGreaterThan(ignore);
  });

  test("git ignores a real .env", () => {
    const out = execFileSync("git", ["check-ignore", ".env", ".env.local"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out.trim().split("\n")).toEqual([".env", ".env.local"]);
  });
});
